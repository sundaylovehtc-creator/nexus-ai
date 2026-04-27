#!/usr/bin/env bun
// Nexus entry point
import { Effect } from "effect";
import { makeTelegramChannel, runTelegramPolling } from "./channels/telegram.js";
import { makeMemoryStore } from "./brain/memory-store.js";
import { makeTokenBudget, DEFAULT_BUDGET } from "./core/token-budget.js";
import { makeNexusAgent } from "./core/agent.js";

// Mock LLM provider
const mockProvider = {
  generate(messages: Array<{role: string; content: string}>) {
    const last = messages[messages.length - 1];
    return Promise.resolve({
      content: `[Nexus] Echo: ${last.content.slice(0, 80)}...`,
      usage: { input: 100, output: 50 },
      model: "mock",
    });
  },
};

async function main() {
  console.log("🚀 Nexus starting...");

  const memory = makeMemoryStore();
  const budget = makeTokenBudget();
  const tools: Array<{name: string; description: string; execute: (args: Record<string, unknown>) => Promise<string>}> = [];

  const agent = makeNexusAgent(mockProvider as any, tools, {
    model: "gpt-4o-mini",
    compressionModel: "gpt-4o-mini",
    maxContextTokens: 100_000,
    temperature: 0.7,
  }, budget);

  const tgToken = process.env.NEXUS_TELEGRAM_TOKEN;
  if (!tgToken) {
    console.log("⚠️  NEXUS_TELEGRAM_TOKEN not set. Set: export NEXUS_TELEGRAM_TOKEN=xxx");
    console.log("   Then: bun run src/index.ts");
    return;
  }

  const tg = makeTelegramChannel({ token: tgToken });
  console.log("📡 Telegram polling started");

  try {
    await Effect.runPromise(
      runTelegramPolling(tg, (msg) =>
        Effect.gen(function* () {
          console.log(`💬 ${msg.username || msg.firstName}: ${msg.text}`);
          yield* tg.sendMessage(msg.chatId, "Nexus is online! 🚀");
        })
      )
    );
  } catch (e) {
    console.error("Fatal:", e);
  }
}

main().catch(console.error);
