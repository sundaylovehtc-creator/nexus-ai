// Nexus Brain — Memory Manager (完整版)
// Port of Hermes memory_tool.py + session_search
// 4层记忆：working → recent → archive → persistent

import { Effect, Context, Chunk } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

export interface MemoryEntry {
  key: string;
  value: string;
  timestamp: number;
  tags?: string[];
  accessCount?: number;
  lastAccess?: number;
}

// 4层记忆结构
export interface MemoryLayers {
  working: MemoryEntry[];   // 当前会话，内存级
  recent: MemoryEntry[];     // 最近7天
  archive: MemoryEntry[];    // 历史存档
  persistent: MemoryEntry[]; // 持久记忆（MEMORY.md）
}

export class MemoryNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Memory key not found: ${key}`);
    this.name = "MemoryNotFoundError";
  }
}

export class MemoryWriteError extends Error {
  constructor(public readonly key: string, public readonly cause: unknown) {
    super(`Failed to write memory: ${key}`);
    this.name = "MemoryWriteError";
  }
}

export interface MemoryManager {
  readonly remember: (key: string, value: string, tags?: string[]) => Effect.Effect<void, MemoryWriteError>;
  readonly recall: (key: string) => Effect.Effect<string, MemoryNotFoundError>;
  readonly forget: (key: string) => Effect.Effect<void, MemoryNotFoundError>;
  readonly searchMemory: (query: string) => Effect.Effect<MemoryEntry[]>;
  readonly getRecentMemories: (days?: number) => Effect.Effect<MemoryEntry[]>;
  readonly savePersistent: () => Effect.Effect<void, MemoryWriteError>;
  readonly loadPersistent: () => Effect.Effect<void>;
  readonly consolidateSession: (sessionId: string, entries: MemoryEntry[]) => Effect.Effect<void>;
  readonly getAllLayers: () => Effect.Effect<MemoryLayers>;
  readonly pruneOldEntries: (maxAgeDays: number) => Effect.Effect<number>;
}

export const MemoryManager = Context.GenericTag<MemoryManager>("MemoryManager");

import os from "node:os";
const DEFAULT_MEMORY_DIR = path.join(os.homedir(), ".nexus", "memory");
const RECENT_DAYS = 7;

function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${Date.now()}`);
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

function parseMarkdownEntries(content: string): MemoryEntry[] {
  if (!content.trim()) return [];
  const entries: MemoryEntry[] = [];
  const lines = content.split("\n");
  let current: Partial<MemoryEntry> = {};
  let inEntry = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inEntry && current.key) {
        entries.push(current as MemoryEntry);
      }
      current = { key: line.slice(3).trim(), timestamp: Date.now() };
      inEntry = true;
    } else if (line.startsWith("timestamp:") && inEntry) {
      current.timestamp = parseInt(line.slice(10).trim(), 10) || Date.now();
    } else if (line.startsWith("tags:") && inEntry) {
      current.tags = line.slice(5).split(",").map(t => t.trim()).filter(Boolean);
    } else if (line.startsWith("accessCount:") && inEntry) {
      current.accessCount = parseInt(line.slice(12).trim(), 10) || 0;
    } else if (inEntry) {
      current.value = (current.value || "") + line + "\n";
    }
  }
  if (inEntry && current.key) {
    entries.push(current as MemoryEntry);
  }
  return entries;
}

function serializeEntries(entries: MemoryEntry[]): string {
  return entries.map(e => {
    let s = `## ${e.key}\ntimestamp: ${e.timestamp}\n`;
    if (e.tags?.length) s += `tags: ${e.tags.join(", ")}\n`;
    if (e.accessCount) s += `accessCount: ${e.accessCount}\n`;
    s += `\n${e.value.trim()}\n`;
    return s;
  }).join("\n");
}

function ensureDir(dir: string): Effect.Effect<void> {
  return Effect.sync(() => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

export function makeMemoryManager(memoryDir: string = DEFAULT_MEMORY_DIR): MemoryManager {
  const working: MemoryEntry[] = [];
  const recentFile = path.join(memoryDir, "recent.md");
  const archiveFile = path.join(memoryDir, "archive.md");
  const persistentFile = path.join(memoryDir, "memory.md");

  function loadRecent(): MemoryEntry[] {
    if (!fs.existsSync(recentFile)) return [];
    return parseMarkdownEntries(fs.readFileSync(recentFile, "utf-8"));
  }

  function loadArchive(): MemoryEntry[] {
    if (!fs.existsSync(archiveFile)) return [];
    return parseMarkdownEntries(fs.readFileSync(archiveFile, "utf-8"));
  }

  function loadPersistent(): MemoryEntry[] {
    if (!fs.existsSync(persistentFile)) return [];
    return parseMarkdownEntries(fs.readFileSync(persistentFile, "utf-8"));
  }

  function saveRecent(entries: MemoryEntry[]): void {
    atomicWrite(recentFile, serializeEntries(entries));
  }

  function saveArchive(entries: MemoryEntry[]): void {
    atomicWrite(archiveFile, serializeEntries(entries));
  }

  function savePersistentToFile(entries: MemoryEntry[]): void {
    atomicWrite(persistentFile, serializeEntries(entries));
  }

  function ageEntries(entries: MemoryEntry[], maxAgeMs: number): { kept: MemoryEntry[], old: MemoryEntry[] } {
    const now = Date.now();
    const kept: MemoryEntry[] = [];
    const old: MemoryEntry[] = [];
    for (const e of entries) {
      if (now - e.timestamp < maxAgeMs) {
        kept.push(e);
      } else {
        old.push(e);
      }
    }
    return { kept, old };
  }

  return {
    remember(key, value, tags) {
      return Effect.gen(function* () {
        yield* ensureDir(memoryDir);
        const entry: MemoryEntry = { key, value, timestamp: Date.now(), tags, accessCount: 0 };
        const idx = working.findIndex(e => e.key === key);
        if (idx >= 0) {
          working[idx] = entry;
        } else {
          working.push(entry);
        }
        const recent = loadRecent();
        const rIdx = recent.findIndex(e => e.key === key);
        if (rIdx >= 0) recent[rIdx] = entry; else recent.unshift(entry);
        saveRecent(recent);
      });
    },

    recall(key) {
      return Effect.gen(function* () {
        // working first
        const w = working.find(e => e.key === key);
        if (w) {
          w.accessCount = (w.accessCount || 0) + 1;
          w.lastAccess = Date.now();
          return w.value;
        }
        // recent
        const recent = loadRecent();
        const r = recent.find(e => e.key === key);
        if (r) {
          r.accessCount = (r.accessCount || 0) + 1;
          r.lastAccess = Date.now();
          // promote to working
          working.push({ ...r });
          saveRecent(recent);
          return r.value;
        }
        // archive
        const archive = loadArchive();
        const a = archive.find(e => e.key === key);
        if (a) {
          return a.value;
        }
        // persistent
        const persistent = loadPersistent();
        const p = persistent.find(e => e.key === key);
        if (p) return p.value;
        return yield* Effect.fail(new MemoryNotFoundError(key));
      });
    },

    forget(key) {
      return Effect.gen(function* () {
        const wIdx = working.findIndex(e => e.key === key);
        if (wIdx >= 0) working.splice(wIdx, 1);
        const recent = loadRecent().filter(e => e.key !== key);
        saveRecent(recent);
        const archive = loadArchive().filter(e => e.key !== key);
        saveArchive(archive);
      });
    },

    searchMemory(query) {
      return Effect.sync(() => {
        const lower = query.toLowerCase();
        const results: MemoryEntry[] = [];
        const seen = new Set<string>();
        const addIfNew = (entries: MemoryEntry[]) => {
          for (const e of entries) {
            if (!seen.has(e.key) && (e.key.toLowerCase().includes(lower) || e.value.toLowerCase().includes(lower))) {
              seen.add(e.key);
              results.push(e);
            }
          }
        };
        addIfNew(working);
        addIfNew(loadRecent());
        addIfNew(loadArchive());
        addIfNew(loadPersistent());
        return results;
      });
    },

    getRecentMemories(days = RECENT_DAYS) {
      return Effect.sync(() => {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        return loadRecent().filter(e => e.timestamp >= cutoff);
      });
    },

    savePersistent() {
      return Effect.gen(function* () {
        yield* ensureDir(memoryDir);
        const persistent = loadPersistent();
        // merge working and recent into persistent
        const merged = new Map<string, MemoryEntry>();
        for (const e of persistent) merged.set(e.key, e);
        for (const e of working) merged.set(e.key, e);
        for (const e of loadRecent()) merged.set(e.key, e);
        savePersistentToFile(Array.from(merged.values()));
      });
    },

    loadPersistent() {
      return Effect.gen(function* () {
        yield* ensureDir(memoryDir);
        const entries = loadPersistent();
        for (const e of entries) {
          if (!working.some(w => w.key === e.key)) {
            working.push(e);
          }
        }
      });
    },

    consolidateSession(sessionId, entries) {
      return Effect.gen(function* () {
        yield* ensureDir(memoryDir);
        const recent = loadRecent();
        const archive = loadArchive();
        // age recent → archive
        const { kept, old } = ageEntries(recent, RECENT_DAYS * 24 * 60 * 60 * 1000);
        for (const e of old) {
          if (!archive.some(a => a.key === e.key)) archive.unshift(e);
        }
        // add session entries to recent
        for (const e of entries) {
          const idx = kept.findIndex(r => r.key === e.key);
          if (idx >= 0) kept[idx] = e; else kept.unshift(e);
        }
        saveRecent(kept);
        saveArchive(archive);
      });
    },

    getAllLayers() {
      return Effect.sync(() => ({
        working: [...working],
        recent: loadRecent(),
        archive: loadArchive(),
        persistent: loadPersistent(),
      }));
    },

    pruneOldEntries(maxAgeDays) {
      return Effect.gen(function* () {
        const archive = loadArchive();
        const { kept, old } = ageEntries(archive, maxAgeDays * 24 * 60 * 60 * 1000);
        saveArchive(kept);
        return old.length;
      });
    },
  };
}
