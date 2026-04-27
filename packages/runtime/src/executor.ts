// Nexus Runtime — Code Execution Engine (cross-platform)
// Works on Win/Mac/Linux via Node.js child_process

import { Effect } from "effect";
import { spawn } from "node:child_process";

const IS_WIN = process.platform === "win32";

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface CodeExecutor {
  readonly execute: (code: string, lang: string, timeout?: number) => Effect.Effect<ExecutionResult, Error>;
  readonly executeFile: (path: string, args?: string[]) => Effect.Effect<ExecutionResult, Error>;
}

function resolveCmd(lang: string): string {
  switch (lang) {
    case "python": case "py":
      return IS_WIN ? "python" : "python3";
    case "javascript": case "js":
      return "node";
    case "bash": case "sh":
      // Prefer bash on Unix, cmd.exe on Windows for .sh (git bash works too)
      return IS_WIN ? "bash" : "bash";
    case "typescript": case "ts": {
      // Try bun > tsx > node
      if (!IS_WIN) return "bun";
      return "node";
    }
    default:
      throw new Error(`Unsupported language: ${lang}`);
  }
}

function getArgs(lang: string, code: string): string[] {
  switch (lang) {
    case "python": case "py": return ["-c", code];
    case "javascript": case "js": return ["-e", code];
    case "bash": case "sh": return ["-c", code];
    case "typescript": case "ts": return ["-e", code];
    default: return ["-e", code];
  }
}

function resolveExtCmd(ext: string): string {
  switch (ext) {
    case "py": return IS_WIN ? "python" : "python3";
    case "js": case "mjs": return "node";
    case "ts": return IS_WIN ? "node" : "bun";
    case "sh": return "bash";
    default: return "node";
  }
}

export function makeCodeExecutor(): CodeExecutor {
  return {
    execute(code, lang, timeout = 30000) {
      return Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const cmd = resolveCmd(lang);
          const args = getArgs(lang, code);

          const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
            const p = spawn(cmd, args, { timeout, stdio: ["pipe", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";

            p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
            p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

            p.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
            p.on("error", (err) => reject(err));

            setTimeout(() => {
              p.kill("SIGKILL");
              reject(new Error(`Execution timeout after ${timeout}ms`));
            }, timeout);
          });

          return { ...result, duration: Date.now() - start };
        },
        catch: (e) => e as Error,
      });
    },

    executeFile(filePath, args = []) {
      return Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
          const cmd = resolveExtCmd(ext);

          const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
            const p = spawn(cmd, [filePath, ...args], { stdio: ["pipe", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";
            p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
            p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
            p.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
            p.on("error", (err) => reject(err));
          });

          return { ...result, duration: Date.now() - start };
        },
        catch: (e) => e as Error,
      });
    },
  };
}
