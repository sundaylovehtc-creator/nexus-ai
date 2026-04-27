// Nexus × OpenClaw Bridge
// Reads/writes OpenClaw cron jobs and agent memory without running OpenClaw

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import os from "node:os";
function getHome(): string { return os.homedir(); }
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || `${getHome()}/.openclaw`;

// ─── Job Schema (matches OpenClaw jobs.json structure) ──────────────────────

export interface CronSchedule {
  kind: "cron";
  expr: string;        // cron expression e.g. "30 22 * * 1-5"
  tz?: string;         // timezone e.g. "Asia/Shanghai"
}

export interface AgentTurnPayload {
  kind: "agentTurn";
  message: string;
  timeoutSeconds: number;
}

export interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  createdAtMs: number;
  schedule: CronSchedule;
  sessionTarget: "isolated" | "shared";
  wakeMode: "now" | "defer";
  payload: AgentTurnPayload;
  delivery: {
    mode: "announce" | "silent";
    channel: "telegram" | "local";
    to?: string;
    accountId?: string;
  };
  state: Record<string, unknown>;
}

// ─── Cron Job Management ────────────────────────────────────────────────────

function getJobsPath(): string {
  return join(OPENCLAW_HOME, "cron", "jobs.json");
}

export interface JobsFile {
  version: number;
  jobs: CronJob[];
}

export function readJobs(): JobsFile {
  const path = getJobsPath();
  if (!existsSync(path)) return { version: 1, jobs: [] };

  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as JobsFile;
  } catch {
    return { version: 1, jobs: [] };
  }
}

export function writeJobs(data: JobsFile): void {
  const path = getJobsPath();
  const bak = `${path}.bak.${Date.now()}`;

  // Backup before write
  if (existsSync(path)) {
    try {
      writeFileSync(bak, readFileSync(path), "utf-8");
    } catch { /* ignore */ }
  }

  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

export function getJob(id: string): CronJob | undefined {
  const { jobs } = readJobs();
  return jobs.find((j) => j.id === id);
}

export function upsertJob(job: CronJob): void {
  const data = readJobs();
  const idx = data.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    data.jobs[idx] = job;
  } else {
    data.jobs.push(job);
  }
  writeJobs(data);
}

export function deleteJob(id: string): boolean {
  const data = readJobs();
  const before = data.jobs.length;
  data.jobs = data.jobs.filter((j) => j.id !== id);
  if (data.jobs.length < before) {
    writeJobs(data);
    return true;
  }
  return false;
}

export function enableJob(id: string, enabled: boolean): boolean {
  const data = readJobs();
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return false;
  job.enabled = enabled;
  writeJobs(data);
  return true;
}

export function listJobs(): CronJob[] {
  return readJobs().jobs;
}

// ─── Agent Memory Read (shared memory between OpenClaw agents) ───────────────

export function readAgentMemory(agentName: string, filename: string): string {
  const base = join(OPENCLAW_HOME, "workspace", agentName, "memory");
  const path = join(base, filename);
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export function writeAgentMemory(agentName: string, filename: string, content: string): void {
  const base = join(OPENCLAW_HOME, "workspace", agentName, "memory");
  // Ensure directory exists
  const { mkdirSync } = require("node:fs");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, filename), content, "utf-8");
}

export function readSharedMemory(filename: string): string {
  const path = join(OPENCLAW_HOME, "workspace", "SHARED", filename);
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export function writeSharedMemory(filename: string, content: string): void {
  const base = join(OPENCLAW_HOME, "workspace", "SHARED");
  const { mkdirSync } = require("node:fs");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, filename), content, "utf-8");
}

// ─── OpenClaw Config Reader ─────────────────────────────────────────────────

export function readOpenClawConfig(): Record<string, unknown> {
  const path = join(OPENCLAW_HOME, "openclaw.json");
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// ─── Bootstrap Reader ────────────────────────────────────────────────────────

export function readAgentBootstrap(agentName: string): string {
  const path = join(OPENCLAW_HOME, "agents", agentName, "agent", "bootstrap.md");
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}
