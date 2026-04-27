// Nexus × Hermes Memory Bridge
// Calls real Hermes Python memory_tool.py as subprocess

import { spawn } from "node:child_process";
import os from "node:os";

function getHome(): string { return os.homedir(); }
const HERMES_HOME = process.env.HERMES_HOME || `${getHome()}/.hermes`;
const IS_WIN = process.platform === "win32";
const PYTHON_BIN = IS_WIN
  ? `${HERMES_HOME}/hermes-agent/venv/Scripts/python.exe`
  : `${HERMES_HOME}/hermes-agent/venv/bin/python3`;
const MEMORY_TOOL_PY = `${HERMES_HOME}/hermes-agent/tools/memory_tool.py`;

export interface MemoryAction {
  action: "add" | "replace" | "remove" | "read";
  target: "memory" | "user";
  content?: string;
  old_text?: string;
}

export interface MemoryResult {
  success: boolean;
  output: string;
  error?: string;
}

export async function callHermesMemoryTool(action: MemoryAction): Promise<MemoryResult> {
  const jsonArgs = JSON.stringify(action);

  return new Promise((resolve) => {
    const p = spawn(PYTHON_BIN, [
      "-c",
      `import sys; sys.path.insert(0, '${MEMORY_TOOL_PY}'.rsplit('/', 1)[0]); from memory_tool import memory_tool; print(memory_tool(**${jsonArgs}))`,
    ], { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    p.on("close", (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: code !== 0 ? (stderr.trim() || `exit ${code}`) : undefined,
      });
    });
    p.on("error", (err) => {
      resolve({ success: false, output: "", error: err.message });
    });

    setTimeout(() => {
      p.kill("SIGKILL");
      resolve({ success: false, output: "", error: "timeout after 15s" });
    }, 15000);
  });
}

export async function readMemorySnapshot(target: "memory" | "user" = "memory"): Promise<string> {
  try {
    const result = await callHermesMemoryTool({ action: "read", target });
    if (result.success) return result.output;
  } catch { /* Hermes not available */ }
  return "";
}
