// Nexus × OpenCode Bridge
// Calls opencode CLI (v1.14.27) as subprocess for code generation/execution

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

// Resolve opencode binary — check OPENCODE_BIN_PATH env or node_modules
function resolveOpenCodeBin(): string {
  if (process.env.OPENCODE_BIN_PATH) return process.env.OPENCODE_BIN_PATH;

  // Try node_modules lookup
  const nm = require.resolve("opencode-ai/package.json", { paths: [process.cwd()] });
  const base = nm.replace("/package.json", "");
  const platformMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, string> = { x64: "x64", arm64: "arm64" };
  const platform = platformMap[process.platform] || process.platform;
  const arch = archMap[process.arch] || process.arch;
  const binary = platform === "windows" ? "opencode.exe" : "opencode";
  return `${base}/opencode-${platform}-${arch}/bin/${binary}`;
}

export interface OpenCodeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface OpenCodeServeConfig {
  port?: number;
  hostname?: string;
  printLogs?: boolean;
  logLevel?: "DEBUG" | "INFO" | "WARN" | "ERROR";
  pure?: boolean;
}

export interface OpenCodeMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Three modes: run, serve, acp
export class OpenCodeBridge extends EventEmitter {
  private binaryPath: string;

  constructor(binaryPath?: string) {
    super();
    this.binaryPath = binaryPath || resolveOpenCodeBin();
  }

  // Mode 1: one-shot command execution
  async run(message: string, options: { cwd?: string; timeout?: number } = {}): Promise<OpenCodeResult> {
    const start = Date.now();
    const { cwd = process.cwd(), timeout = 120000 } = options;

    return new Promise((resolve) => {
      const args = ["run", message, "--print-logs"];
      const p = spawn(this.binaryPath, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, OPENCODE_BIN_PATH: this.binaryPath },
        timeout,
      });

      let stdout = "";
      let stderr = "";

      p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      p.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 0, duration: Date.now() - start });
      });
      p.on("error", (err) => {
        resolve({ stdout, stderr: err.message, exitCode: 1, duration: Date.now() - start });
      });

      setTimeout(() => {
        p.kill("SIGKILL");
        resolve({ stdout, stderr: "timeout", exitCode: 124, duration: Date.now() - start });
      }, timeout);
    });
  }

  // Mode 2: headless server (returns base URL)
  async serve(config: OpenCodeServeConfig = {}): Promise<{ baseUrl: string; stop: () => void }> {
    const { port = 0, hostname = "127.0.0.1", printLogs = false, logLevel = "INFO", pure = false } = config;

    const args = [
      "serve",
      "--port", String(port),
      "--hostname", hostname,
      "--log-level", logLevel,
    ];
    if (printLogs) args.push("--print-logs");
    if (pure) args.push("--pure");

    return new Promise((resolve, reject) => {
      const p = spawn(this.binaryPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, OPENCODE_BIN_PATH: this.binaryPath },
      });

      let stdout = "";
      let stderr = "";
      let resolved = false;

      p.stdout?.on("data", (d: Buffer) => {
        const line = d.toString();
        stdout += line;
        // Parse port from "server started on http://127.0.0.1:PORT"
        if (!resolved && line.includes("started on")) {
          const match = line.match(/https?:\/\/[0-9.]+:\d+/);
          if (match) {
            resolved = true;
            resolve({
              baseUrl: match[0],
              stop: () => p.kill("SIGTERM"),
            });
          }
        }
      });

      p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      p.on("error", (err) => {
        if (!resolved) reject(err);
      });

      // Fallback timeout
      setTimeout(() => {
        if (!resolved) {
          p.kill("SIGTERM");
          reject(new Error(`opencode serve timed out. stderr: ${stderr.slice(-500)}`));
        }
      }, 30000);
    });
  }

  // Mode 3: acp (Agent Client Protocol) — interactive session
  async acp(cwd: string, onLine?: (line: string) => void): Promise<{ write: (msg: string) => void; stop: () => void }> {
    const p = spawn(this.binaryPath, ["acp", "--cwd", cwd], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, OPENCODE_BIN_PATH: this.binaryPath },
    });

    if (onLine) {
      p.stdout?.on("data", (d: Buffer) => {
        onLine(d.toString());
      });
    }

    return {
      write: (msg) => p.stdin?.write(msg + "\n"),
      stop: () => p.kill("SIGTERM"),
    };
  }
}

// Singleton instance
let _instance: OpenCodeBridge | null = null;

export function getOpenCodeBridge(): OpenCodeBridge {
  if (!_instance) {
    _instance = new OpenCodeBridge();
  }
  return _instance;
}
