// Token Budget — Built-in enforcement (not an afterthought)
// Inspired by Hermes usage_pricing.py + context_compressor.py

import { Effect, Context } from "effect";

// Model pricing (USD per 1M tokens)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-7": { input: 0.8, output: 4 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  // Google
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  // Cheap compression model (the ONLY model used for compression)
  "haiku-32k": { input: 0.05, output: 0.2 },
};

// Default budget limits (per user per day)
export const DEFAULT_BUDGET = {
  conversation: 100_000,   // 100k tokens
  memory: 20_000,           // 20k tokens
  dreaming: 5_000,          // 5k tokens (default ON)
  skillGeneration: 5_000,   // 5k per event
  maxSkillGenPerDay: 3,     // max 3 skill generations per day
};

// Compression settings (from Hermes context_compressor.py)
export const COMPRESSION = {
  ratio: 0.20,              // keep 20% of content
  maxOutputTokens: 2000,    // hard ceiling
  summaryModel: "gpt-4o-mini", // cheap model for compression ONLY
};

// Track token usage per user
export interface TokenUsage {
  conversation: number;
  memory: number;
  dreaming: number;
  skillGeneration: number;
  skillGenCount: number;
  lastReset: number; // unix timestamp
}

export class TokenBudgetError extends Error {
  constructor(
    public readonly budgetType: keyof typeof DEFAULT_BUDGET,
    public readonly limit: number,
    public readonly used: number
  ) {
    super(`Token budget exceeded: ${budgetType} (${used}/${limit})`);
    this.name = "TokenBudgetError";
  }
}

export interface TokenBudget {
  readonly check: (type: keyof typeof DEFAULT_BUDGET, tokens: number) => Effect.Effect<void, TokenBudgetError>;
  readonly deduct: (type: keyof typeof DEFAULT_BUDGET, tokens: number) => Effect.Effect<void, TokenBudgetError>;
  readonly getUsage: () => Effect.Effect<TokenUsage>;
  readonly resetIfNewDay: () => Effect.Effect<void>;
  readonly getCost: (model: string, inputTokens: number, outputTokens: number) => number;
}

export const TokenBudget = Context.GenericTag<TokenBudget>("TokenBudget");

export function makeTokenBudget(initialUsage?: Partial<TokenUsage>): TokenBudget {
  let usage: TokenUsage = {
    conversation: 0,
    memory: 0,
    dreaming: 0,
    skillGeneration: 0,
    skillGenCount: 0,
    lastReset: Date.now(),
    ...initialUsage,
  };

  function isNewDay(): boolean {
    const last = new Date(usage.lastReset);
    const now = new Date();
    return (
      last.getFullYear() !== now.getFullYear() ||
      last.getMonth() !== now.getMonth() ||
      last.getDate() !== now.getDate()
    );
  }

  function getLimit(type: keyof typeof DEFAULT_BUDGET): number {
    if (type === "maxSkillGenPerDay") return DEFAULT_BUDGET.maxSkillGenPerDay;
    return DEFAULT_BUDGET[type];
  }

  return {
    check(type, tokens) {
      if (isNewDay()) {
        return Effect.void;
      }
      const limit = getLimit(type);
      const current = type === "maxSkillGenPerDay" ? usage.skillGenCount : usage[type as keyof TokenUsage] as number;
      if (current + tokens > limit) {
        return Effect.fail(new TokenBudgetError(type, limit, current));
      }
      return Effect.void;
    },

    deduct(type, tokens) {
      if (isNewDay()) {
        usage = {
          conversation: 0,
          memory: 0,
          dreaming: 0,
          skillGeneration: 0,
          skillGenCount: 0,
          lastReset: Date.now(),
        };
      }

      const limit = getLimit(type);
      const current = type === "maxSkillGenPerDay" ? usage.skillGenCount : usage[type as keyof TokenUsage] as number;

      if (type === "maxSkillGenPerDay") {
        usage.skillGenCount = current + 1;
      } else {
        (usage[type as keyof TokenUsage] as number) = current + tokens;
      }

      return Effect.void;
    },

    getUsage() {
      if (isNewDay()) {
        usage = {
          conversation: 0,
          memory: 0,
          dreaming: 0,
          skillGeneration: 0,
          skillGenCount: 0,
          lastReset: Date.now(),
        };
      }
      return Effect.succeed({ ...usage });
    },

    resetIfNewDay() {
      if (isNewDay()) {
        usage = {
          conversation: 0,
          memory: 0,
          dreaming: 0,
          skillGeneration: 0,
          skillGenCount: 0,
          lastReset: Date.now(),
        };
      }
      return Effect.void;
    },

    getCost(model: string, inputTokens: number, outputTokens: number): number {
      const pricing = MODEL_PRICING[model];
      if (!pricing) {
        // Unknown model, assume gpt-4o-mini pricing
        return (inputTokens * 0.15 + outputTokens * 0.6) / 1_000_000;
      }
      return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
    },
  };
}

// Compress conversation context using cheap model
// NEVER uses main model — this is a critical security constraint
export async function compressContext(
  messages: Array<{ role: string; content: string }>,
  budget: TokenBudget,
  compressFn: (messages: Array<{ role: string; content: string }>, ratio: number) => Promise<string>
): Promise<{ compressed: string; usedTokens: number }> {
  const originalTokens = estimateTokens(messages);
  const targetTokens = Math.min(
    Math.floor(originalTokens * COMPRESSION.ratio),
    COMPRESSION.maxOutputTokens
  );

  const summary = await compressFn(messages, COMPRESSION.ratio);
  const summaryTokens = estimateTokenCount(summary);

  return {
    compressed: summary,
    usedTokens: summaryTokens,
  };
}

function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  return estimateTokenCount(text);
}

function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 chars per token for English, ~2 for Chinese
  return Math.ceil(text.length / 3);
}
