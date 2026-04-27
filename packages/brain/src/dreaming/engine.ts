// Nexus Brain — Dreaming Engine
// 后台记忆巩固：Token预算控制，默认开启
// 灵感来自 OpenClaw REM 睡眠记忆 + Hermes context compressor

import { Effect, Context } from "effect";
import type { MemoryEntry } from "../memory/manager.js";

export interface DreamConfig {
  enabled: boolean;
  maxDreamTokensPerRun: number;   // 硬上限，默认 5000
  consolidationThreshold: number;  // 触发巩固的记忆条目数
  dreamModel: string;            // 用哪个模型做dreaming，默认 haiku
  apiKey?: string;
  apiBase?: string;
}

export const DEFAULT_DREAM_CONFIG: DreamConfig = {
  enabled: true,
  maxDreamTokensPerRun: 5000,
  consolidationThreshold: 10,
  dreamModel: "anthropic/claude-haiku",
};

export class DreamingNotEnabledError extends Error {
  constructor() {
    super("Dreaming is not enabled");
    this.name = "DreamingNotEnabledError";
  }
}

export class DreamingBudgetExceededError extends Error {
  constructor(public readonly used: number, public readonly limit: number) {
    super(`Dreaming budget exceeded: ${used}/${limit} tokens`);
    this.name = "DreamingBudgetExceededError";
  }
}

// Dreaming result
export interface DreamResult {
  consolidated: MemoryEntry[];
  patterns: string[];      // 发现的高频模式
  insights: string[];      // 记忆中的洞察
  tokensUsed: number;
}

// Dreaming effect interface
export interface DreamingEngine {
  readonly dream: (recentMemories: MemoryEntry[], dailyBudget: number) => Effect.Effect<DreamResult, DreamingNotEnabledError | DreamingBudgetExceededError>;
  readonly checkBudget: (dailyBudget: number) => Effect.Effect<boolean>;
  readonly getConfig: () => DreamConfig;
}

export const DreamingEngine = Context.GenericTag<DreamingEngine>("DreamingEngine");

// Consolidation: compress related memories into patterns
function consolidateMemories(memories: MemoryEntry[]): { patterns: string[], insights: string[] } {
  // 按 tags 分组找共性
  const tagGroups = new Map<string, MemoryEntry[]>();
  for (const m of memories) {
    for (const tag of (m.tags || [])) {
      if (!tagGroups.has(tag)) tagGroups.set(tag, []);
      tagGroups.get(tag)!.push(m);
    }
  }

  const patterns: string[] = [];
  const insights: string[] = [];

  for (const [tag, entries] of tagGroups) {
    if (entries.length >= 2) {
      patterns.push(`${tag}: ${entries.length} related memories`);
    }
  }

  // 按时间聚类：同一小时内的记忆标记为"经验组"
  const timeGroups = new Map<number, MemoryEntry[]>();
  for (const m of memories) {
    const hour = Math.floor(m.timestamp / (60 * 60 * 1000));
    if (!timeGroups.has(hour)) timeGroups.set(hour, []);
    timeGroups.get(hour)!.push(m);
  }
  for (const [, entries] of timeGroups) {
    if (entries.length >= 3) {
      const keys = entries.slice(0, 3).map(e => e.key).join(", ");
      insights.push(`经验组: ${keys} (${entries.length}条)`);
    }
  }

  return { patterns, insights };
}

// LLM-based dreaming (mock — real impl calls haiku)
async function callDreamingModel(
  prompt: string,
  config: DreamConfig
): Promise<{ patterns: string[], insights: string[], tokensUsed: number }> {
  // 如果没有API key，返回基于规则的 consolidation
  if (!config.apiKey) {
    return { patterns: [], insights: [], tokensUsed: 0 };
  }

  const body = JSON.stringify({
    model: config.dreamModel,
    messages: [{ role: "user", content: prompt }],
    max_tokens: Math.min(config.maxDreamTokensPerRun, 500),
  });

  try {
    const res = await fetch(`${config.apiBase || "https://openrouter.ai/api/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) throw new Error(`Dreaming API error: ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || "";
    const tokensUsed = Math.ceil(content.length / 4); // rough estimate
    const lines = content.split("\n").filter(Boolean);
    const patterns: string[] = [];
    const insights: string[] = [];
    let mode: "patterns" | "insights" = "patterns";
    for (const line of lines) {
      if (line.includes("## Patterns") || line.includes("**Patterns**")) { mode = "patterns"; continue; }
      if (line.includes("## Insights") || line.includes("**Insights**")) { mode = "insights"; continue; }
      if (line.startsWith("- ")) {
        if (mode === "patterns") patterns.push(line.slice(2));
        else insights.push(line.slice(2));
      }
    }
    return { patterns, insights, tokensUsed };
  } catch {
    return { patterns: [], insights: [], tokensUsed: 0 };
  }
}

export function makeDreamingEngine(config: DreamConfig = DEFAULT_DREAM_CONFIG): DreamingEngine {
  let dailyUsed = 0;
  let lastReset = Date.now();

  function resetIfNewDay() {
    const today = new Date().setHours(0, 0, 0, 0);
    if (lastReset < today) {
      dailyUsed = 0;
      lastReset = today;
    }
  }

  return {
    dream(recentMemories, dailyBudget) {
      return Effect.gen(function* () {
        if (!config.enabled) return yield* Effect.fail(new DreamingNotEnabledError());
        resetIfNewDay();

        const { patterns: rulePatterns, insights: ruleInsights } = consolidateMemories(recentMemories);
        const tokensUsed = Math.ceil(recentMemories.reduce((s, m) => s + m.value.length, 0) / 4);

        if (tokensUsed > config.maxDreamTokensPerRun) {
          return yield* Effect.fail(new DreamingBudgetExceededError(tokensUsed, config.maxDreamTokensPerRun));
        }
        if (dailyUsed + tokensUsed > dailyBudget) {
          return yield* Effect.fail(new DreamingBudgetExceededError(dailyUsed + tokensUsed, dailyBudget));
        }

        // LLM dreaming if api key available
        const summary = recentMemories
          .slice(0, 20)
          .map(m => `[${m.key}]: ${m.value.slice(0, 200)}`)
          .join("\n");

        const prompt = `你是 Nexus Dreaming Engine。分析以下记忆，发现模式并提炼洞察。\n\n${summary}\n\n## Patterns\n- 列出发现的主题模式\n\n## Insights\n- 列出关键洞察`;
        const llmResult = yield* Effect.promise(() => callDreamingModel(prompt, config));

        dailyUsed += tokensUsed + llmResult.tokensUsed;

        return {
          consolidated: recentMemories,
          patterns: [...rulePatterns, ...llmResult.patterns],
          insights: [...ruleInsights, ...llmResult.insights],
          tokensUsed,
        };
      });
    },

    checkBudget(dailyBudget) {
      return Effect.sync(() => {
        resetIfNewDay();
        return dailyUsed < dailyBudget;
      });
    },

    getConfig() {
      return { ...config };
    },
  };
}
