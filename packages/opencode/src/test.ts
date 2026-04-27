// Quick test for OpenCode bridge
import { OpenCodeBridge } from "./index.js";

async function main() {
  console.log("Testing OpenCode bridge...");
  const bridge = new OpenCodeBridge();

  console.log("Mode 1: run command...");
  const result = await bridge.run("say hello in python: print('hello from opencode')", { timeout: 60000 });
  console.log("exitCode:", result.exitCode);
  console.log("stdout (first 500 chars):", result.stdout.slice(0, 500));
  console.log("stderr (first 200 chars):", result.stderr.slice(0, 200));
  console.log("duration:", result.duration, "ms");
}

main().catch(console.error);
