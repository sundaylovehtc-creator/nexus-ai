#!/usr/bin/env bun
// Nexus CLI entry point
import { Effect } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { makeTelegramChannel, runTelegramPolling } from "../packages/channels/src/telegram.js";
import { makeMemoryStore } from "../packages/brain/src/memory/memory-store.js";
import { makeTokenBudget } from "../packages/core/src/effects/nexus-context.js";
import { makeNexusAgent } from "../packages/core/src/agent.js";
import { makeOpenRouterProvider, OPENROUTER_MODELS } from "../packages/runtime/src/openrouter-provider.js";

interface InMemorySkill {
  name: string;
  description: string;
  trigger: string[];
  content: string;
  compactContent: string;
  lastUsed: number;
  useCount: number;
  budget: { priority: "high" | "medium" | "low"; tokensPerUse: number; dailyLimit: number };
}

const inMemorySkills: Map<string, InMemorySkill> = new Map();

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const k = line.slice(0, colonIdx).trim();
    const v = line.slice(colonIdx + 1).trim();
    if (k) meta[k] = v;
  }
  return { meta, body: match[2] };
}

function loadSkillsFromDir(skillsDir: string): number {
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
    console.log(`📁 Created skills directory: ${skillsDir}`);
    return 0;
  }

  let count = 0;
  for (const file of fs.readdirSync(skillsDir)) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(skillsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(content);

    if (!meta.name || !meta.description) {
      console.warn(`⚠️  Skipping invalid skill: ${file}`);
      continue;
    }

    const triggers = typeof meta.triggers === "string"
      ? meta.triggers.split(",").map((t: string) => t.trim()).filter(Boolean)
      : [];
    const budgetStr = typeof meta.budget === "string" ? meta.budget : "2/1500/50";
    const [p, tpu, dl] = budgetStr.split("/").map(Number);

    inMemorySkills.set(String(meta.name), {
      name: String(meta.name),
      description: String(meta.description),
      trigger: triggers,
      content: body,
      compactContent: body.split("\n").slice(0, 20).join("\n").slice(0, 500),
      lastUsed: Number(meta.lastUsed) || 0,
      useCount: Number(meta.useCount) || 0,
      budget: {
        priority: (["high", "medium", "low"][(p || 2) - 1] as "high" | "medium" | "low") || "medium",
        tokensPerUse: tpu || 1500,
        dailyLimit: dl || 50,
      },
    });
    count++;
  }
  return count;
}

function matchSkillsByQuery(query: string): InMemorySkill[] {
  const lower = query.toLowerCase();
  const matched: Array<{ skill: InMemorySkill; score: number }> = [];

  for (const skill of inMemorySkills.values()) {
    let score = 0;
    for (const trigger of skill.trigger) {
      if (lower.includes(trigger.toLowerCase())) {
        score += trigger.length;
      }
    }
    if (score > 0) {
      matched.push({ skill, score });
    }
  }

  return matched.sort((a, b) => b.score - a.score).slice(0, 3).map(m => m.skill);
}

function buildSystemPrompt(): string {
  const skillDescs = Array.from(inMemorySkills.values())
    .map(s => `  - ${s.name}: ${s.description} (triggers: ${s.trigger.join(", ")})`)
    .join("\n");
  return `You are Nexus, an AI agent.

Available skills:
${skillDescs}

Rules:
- Match user queries to relevant skills automatically
- When a skill matches, use its workflow to guide your response
- Be concise and practical
- Respect token budget
- Skills are stored in ~/.nexus/skills/ and auto-loaded on startup`;
}

async function main() {
  console.log("🚀 Nexus starting...");

  // Load skills from ~/.nexus/skills/
  const skillsDir = path.join(os.homedir(), ".nexus", "skills");
  const loadedCount = loadSkillsFromDir(skillsDir);
  console.log(`✅ Loaded ${loadedCount} skills from ${skillsDir}`);

  const memory = makeMemoryStore();
  const budget = makeTokenBudget();

  // Get API key
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    console.log("❌ OPENROUTER_API_KEY not set. Copy .env.example to .env and add your key.");
    return;
  }

  // Create provider
  const defaultModel = process.env.NEXUS_DEFAULT_MODEL || "anthropic/claude-3-haiku";
  const provider = makeOpenRouterProvider({
    apiKey: openRouterKey,
    defaultModel,
  });
  console.log(`✅ OpenRouter provider initialized with model: ${defaultModel}`);

  const agent = makeNexusAgent(
    provider as any,
    [],
    {
      model: defaultModel,
      compressionModel: process.env.NEXUS_COMPRESSION_MODEL || "openai/gpt-4o-mini",
      maxContextTokens: Number(process.env.NEXUS_MAX_CONTEXT_TOKENS) || 100_000,
      temperature: Number(process.env.NEXUS_TEMPERATURE) || 0.7,
    },
    budget
  );

  // Check Telegram token
  const tgToken = process.env.NEXUS_TELEGRAM_TOKEN;
  if (!tgToken) {
    console.log("⚠️  NEXUS_TELEGRAM_TOKEN not set — running without Telegram");
    console.log("   Set it in .env or export NEXUS_TELEGRAM_TOKEN=...");
    // Continue anyway for testing
  } else {
    const tg = makeTelegramChannel({ token: tgToken });
    console.log("📡 Telegram polling started");

    try {
      await Effect.runPromise(
        runTelegramPolling(tg, (msg) =>
          Effect.gen(function* () {
            console.log(`💬 ${msg.username || msg.firstName}: ${msg.text}`);

            // Match skills
            const matchedSkills = matchSkillsByQuery(msg.text);
            let skillContext = "";
            if (matchedSkills.length > 0) {
              skillContext = `\n\nRelevant skills for your query:\n${matchedSkills.map(s =>
                `## ${s.name}\n${s.content}`
              ).join("\n\n")}`;
            }

            // Build messages with skills
            const systemMsg = {
              id: "system",
              role: "system" as const,
              content: buildSystemPrompt(),
              timestamp: Date.now(),
            };
            const userMsg = {
              id: msg.id,
              role: "user" as const,
              content: msg.text + skillContext,
              timestamp: Date.now(),
            };

            // Run agent
            const session = {
              id: msg.chatId,
              userId: String(msg.chatId),
              messages: [userMsg],
              createdAt: Date.now(),
              updatedAt: Date.now(),
              contextTokens: 0,
            };

            try {
              const result = yield* agent.run(session, msg.text + skillContext);
              yield* tg.sendMessage(msg.chatId, result);
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              console.error(`Agent error: ${errMsg}`);
              yield* tg.sendMessage(msg.chatId, `Error: ${errMsg}`);
            }
          })
        )
      );
    } catch (e) {
      console.error("Telegram polling error:", e);
    }
  }
}

main().catch(console.error);
