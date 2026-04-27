// Nexus Runtime — Code Execution Engine
import { Effect } from "effect";

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

export function makeCodeExecutor(): CodeExecutor {
  return {
    execute(code, lang, timeout = 30000) {
      return Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const encoded = Buffer.from(code).toString("base64");
          let cmd = "";
          let args: string[] = [];

          switch (lang) {
            case "python":
            case "py":
              cmd = "python3";
              args = ["-c", code];
              break;
            case "javascript":
            case "js":
              cmd = "node";
              args = ["-e", code];
              break;
            case "bash":
            case "sh":
              cmd = "bash";
              args = ["-c", code];
              break;
            case "typescript":
            case "ts":
              cmd = "bun";
              args = ["-e", code];
              break;
            default:
              throw new Error(`Unsupported language: ${lang}`);
          }

          const proc = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
          // Use Bun's subprocess - simplified
          const p = Bun.spawn([cmd, ...args], { timeout, stdout: "pipe", stderr: "pipe" });
          const [stdout, stderr] = await Promise.all([
            new Response(p.stdout).text(),
            new Response(p.stderr).text(),
          ]);
          const exitCode = await p.exitCode;
          return { stdout, stderr, exitCode, duration: Date.now() - start };
        },
        catch: (e) => e as Error,
      });
    },
    executeFile(filePath, args = []) {
      return Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const p = Bun.spawn(["bun", filePath, ...args], { stdout: "pipe", stderr: "pipe" });
          const [stdout, stderr] = await Promise.all([
            new Response(p.stdout).text(),
            new Response(p.stderr).text(),
          ]);
          const exitCode = await p.exitCode;
          return { stdout, stderr, exitCode, duration: Date.now() - start };
        },
        catch: (e) => e as Error,
      });
    },
  };
}
