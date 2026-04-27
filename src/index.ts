#!/usr/bin/env bun
// Nexus CLI entry point
import { Effect } from "effect";
import { makeTelegramChannel, runTelegramPolling } from "../packages/channels/src/telegram.js";
import { makeMemoryStore } from "../packages/brain/src/memory/memory-store.js";
import { makeTokenBudget } from "../packages/core/src/effects/nexus-context.js";
import { makeNexusAgent } from "../packages/core/src/agent.js";

const mockProvider = {
  generate(messages: Array<{role: string; content: string}>) {
    const last = messages.at(-1);
    return Promise.resolve({
      content: `[Nexus] Echo: ${last?.content.slice(0, 80)}...`,
      usage: { input: 100, output: 50 },
      model: "mock",
    });
  },
};

async function main() {
  console.log("🚀 Nexus starting...");
  const memory = makeMemoryStore();
  const budget = makeTokenBudget();
  const tools: Array<{name: string; description: string; execute: (a: Record<string, unknown>) => Promise<string>}> = [];
  const agent = makeNexusAgent(mockProvider as any, tools, {
    model: "gpt-4o-mini",
    compressionModel: "gpt-4o-mini",
    maxContextTokens: 100_000,
    temperature: 0.7,
  }, budget);
  const tgToken = process.env.NEXUS_TELEGRAM_TOKEN;
  if (!tgToken) {
    console.log("⚠️  Set NEXUS_TELEGRAM_TOKEN env var, then: bun run src/index.ts");
    return;
  }
  const tg = makeTelegramChannel({ token: tgToken });
  console.log("📡 Telegram polling started");
  try {
    await Effect.runPromise(
      runTelegramPolling(tg, (msg) =>
        Effect.gen(function* () {
          console.log(`💬 ${msg.username || msg.firstName}: ${msg.text}`);
          yield* tg.sendMessage(msg.chatId, "Nexus online!");
        })
      )
    );
  } catch (e) {
    console.error("Fatal:", e);
  }
}
main().catch(console.error);
