// Nexus Runtime — OpenCode CLI Engine v1
// Wraps opencode-ai CLI (MIT licensed) as Nexus code execution engine
// Three modes: run / serve (HTTP) / acp (RPC)

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";

export interface OpenCodeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

function findOpenCodeBin(): string {
  const bin = join(process.cwd(), "node_modules", ".bin", "opencode");
  try { require("fs").accessSync(bin); return bin; }
  catch { return "opencode"; }
}

const OPENCODE = findOpenCodeBin();

// Mode 1: opencode run [message..]
export async function openCodeRun(
  message: string,
  opts: { cwd?: string; timeout?: number } = {}
): Promise<OpenCodeResult> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const proc = spawn(OPENCODE, ["run", ...message.split(" ")], {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "", done = false;
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { err += d.toString(); });
    proc.on("close", (c) => { if (!done) { done = true; resolve({ stdout: out, stderr: err, exitCode: c ?? 0, duration: Date.now() - start }); } });
    proc.on("error", (e) => { if (!done) { done = true; reject(e); } });
    setTimeout(() => { if (!done) { done = true; proc.kill("SIGKILL"); reject(new Error("timeout")); } }, opts.timeout ?? 120000);
  });
}

// Mode 2: opencode serve (HTTP API)
class OpenCodeServe extends EventEmitter {
  private proc: ChildProcess | null = null;
  public baseUrl = "";
  public sessionId = "";

  constructor(
    public readonly port = 0,
    public readonly hostname = "127.0.0.1",
    public readonly cwd = process.cwd()
  ) { super(); }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(OPENCODE, ["serve", "--port", String(this.port), "--hostname", this.hostname], {
        cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"],
      });
      let ok = false;
      this.proc.stderr?.on("data", (d: Buffer) => {
        const l = d.toString();
        if (!ok) {
          const m = l.match(/listening on (http:\/\/[^\s]+)/);
          if (m) { this.baseUrl = m[1]; ok = true; resolve(this.baseUrl); }
        }
        this.emit("log", l);
      });
      this.proc.on("error", (e) => { if (!ok) reject(e); });
      setTimeout(() => { if (!ok) { this.proc?.kill(); reject(new Error("serve start timeout")); } }, 30000);
    });
  }

  async createSession(): Promise<string> {
    const r = await fetch(`${this.baseUrl}/session`, { method: "POST" });
    const d = await r.json() as { id?: string };
    if (!d.id) throw new Error("create session failed");
    this.sessionId = d.id;
    return d.id;
  }

  async send(msg: string): Promise<string> {
    const r = await fetch(`${this.baseUrl}/session/${this.sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, stream: false }),
    });
    const d = await r.json() as { message?: string; content?: string };
    return (d.message ?? d.content ?? "").toString();
  }

  stop(): void { this.proc?.kill(); this.proc = null; }
}

export function makeOpenCodeServe(opts: { port?: number; hostname?: string; cwd?: string } = {}) {
  const s = new OpenCodeServe(opts.port ?? 0, opts.hostname ?? "127.0.0.1", opts.cwd ?? process.cwd());
  return {
    start: () => s.start(),
    createSession: () => s.createSession(),
    send: (m: string) => s.send(m),
    stop: () => s.stop(),
  };
}

// Mode 3: opencode acp
class OpenCodeACP extends EventEmitter {
  private proc: ChildProcess | null = null;
  private connected = false;

  constructor(public readonly cwd = process.cwd()) { super(); }

  async start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(OPENCODE, ["acp", "--port", String(port)], { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
      let ok = false, actualPort = port;
      this.proc.stderr?.on("data", (d: Buffer) => {
        const l = d.toString();
        if (!ok && port === 0) {
          const m = l.match(/port[:\s]+(\d+)/i);
          if (m) { actualPort = parseInt(m[1]); ok = true; this.connected = true; resolve(actualPort); }
        }
        this.emit("log", l);
      });
      this.proc.on("error", (e) => { if (!ok) reject(e); });
      this.proc.on("close", () => { this.connected = false; this.emit("close"); });
      if (port > 0) { this.connected = true; resolve(port); }
      setTimeout(() => { if (!ok) { this.proc?.kill(); reject(new Error("acp start timeout")); } }, 30000);
    });
  }

  async cmd(c: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.proc) { reject(new Error("not connected")); return; }
      let out = "", done = false;
      this.proc.stdout?.on("data", (d) => { out += d.toString(); if (!done) { done = true; resolve(out.trim()); } });
      this.proc.stderr?.on("data", (d) => this.emit("log", d.toString()));
      this.proc.stdin?.write(c + "\n");
      setTimeout(() => { if (!done) { done = true; resolve(out || ""); } }, 60000);
    });
  }

  stop(): void { this.proc?.kill(); this.proc = null; this.connected = false; }
}

export function makeOpenCodeACP(cwd?: string) {
  const a = new OpenCodeACP(cwd);
  return { start: (p?: number) => a.start(p ?? 0), cmd: (c: string) => a.cmd(c), stop: () => a.stop() };
}

// Unified Nexus Code Executor
export interface NexusCodeExecutor {
  run(code: string): Promise<OpenCodeResult>;
  serve(opts?: { port?: number; hostname?: string; cwd?: string }): ReturnType<typeof makeOpenCodeServe>;
  acp(cwd?: string): ReturnType<typeof makeOpenCodeACP>;
}

export function makeNexusCodeExecutor(cwd?: string): NexusCodeExecutor {
  return {
    async run(code: string) {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const proc = spawn(OPENCODE, ["run", code], { cwd: cwd ?? process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
        let out = "", err = "", done = false;
        proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
        proc.stderr?.on("data", (d: Buffer) => { err += d.toString(); });
        proc.on("close", (c) => { if (!done) { done = true; resolve({ stdout: out, stderr: err, exitCode: c ?? 0, duration: Date.now() - start }); } });
        proc.on("error", (e) => { if (!done) { done = true; reject(e); } });
        setTimeout(() => { if (!done) { done = true; proc.kill("SIGKILL"); reject(new Error("timeout")); } }, 120000);
      });
    },
    serve(opts) { return makeOpenCodeServe({ ...opts, cwd }); },
    acp(cwdOverride) { return makeOpenCodeACP(cwdOverride ?? cwd ?? process.cwd()); },
  };
}
