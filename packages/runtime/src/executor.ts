// Nexus Runtime — Code Execution Engine (cross-platform)
// Uses Node.js child_process — works on Win/Mac/Linux

import { Effect } from "effect";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify((cmd: string, args: string[], opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
  const p = spawn(cmd, args, opts as Parameters<typeof spawn>[2]);
  let stdout = "";
  let stderr = "";
  p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
  p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
  p.on("close", (code) => cb(null, stdout, stderr));
  p.on("error", (err) => cb(err as Error, "", ""));
});

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

function getCmd(lang: string): string {
  switch (lang) {
    case "python": case "py": return "python3";
    case "javascript": case "js": return "node";
    case "bash": case "sh": return "bash";
    case "typescript": case "ts": return "bun";
    case "typescript": case "ts": return process.env.NEXUS_TS_RUNTIME || "bun";
    default: throw new Error(`Unsupported language: ${lang}`);
  }
}

function getArgs(lang: string, code: string): string[] {
  switch (lang) {
    case "python": case "py": return ["-c", code];
    case "javascript": case "js": return ["-e", code];
    case "bash": case "sh": return ["-c", code];
    case "typescript": case "ts": return ["-e", code];
    default: return [code];
  }
}

export function makeCodeExecutor(): CodeExecutor {
  return {
    execute(code, lang, timeout = 30000) {
      return Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const cmd = getCmd(lang);
          const args = getArgs(lang, code);

          const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
            const p = spawn(cmd, args, { timeout, stdio: ["pipe", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";
            let settled = false;

            p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
            p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

            const cleanup = () => {
              if (!settled) { settled = true; }
            };

            p.on("close", (code) => {
              cleanup();
              resolve({ stdout, stderr, exitCode: code ?? 0 });
            });
            p.on("error", (err) => {
              cleanup();
              reject(err);
            });

            // Force kill on timeout
            setTimeout(() => {
              if (!settled) {
                p.kill("SIGKILL");
                reject(new Error(`Execution timeout after ${timeout}ms`));
              }
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
          const ext = filePath.split(".").pop()?.toLowerCase();
          let cmd = "node";
          if (ext === "py") cmd = "python3";
          else if (ext === "ts") cmd = "bun";
          else if (ext === "sh") cmd = "bash";

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
