// Nexus Brain — Memory Store (TS port of Hermes memory_tool.py)
// File-based, atomic writes, zero-cost

import { Effect, Context } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

export interface MemoryEntry {
  key: string;
  value: string;
  timestamp: number;
  tags?: string[];
}

// Memory types (from Hermes: MEMORY.md and USER.md separation)
export type MemoryType = "memory" | "user" | "skills" | "context";

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

export interface MemoryStore {
  readonly read: (key: string, memoryType?: MemoryType) => Effect.Effect<string, MemoryNotFoundError>;
  readonly write: (key: string, value: string, memoryType?: MemoryType) => Effect.Effect<void, MemoryWriteError>;
  readonly delete: (key: string, memoryType?: MemoryType) => Effect.Effect<void, MemoryNotFoundError>;
  readonly list: (memoryType?: MemoryType) => Effect.Effect<MemoryEntry[]>;
  readonly search: (query: string, memoryType?: MemoryType) => Effect.Effect<MemoryEntry[]>;
  readonly getMemoryPath: (memoryType: MemoryType) => string;
}

export const MemoryStore = Context.GenericTag<MemoryStore>("MemoryStore");

// Default memory directory
import os from "node:os";
const DEFAULT_MEMORY_DIR = path.join(os.homedir(), ".nexus", "memory");

export function makeMemoryStore(memoryDir: string = DEFAULT_MEMORY_DIR): MemoryStore {
  function getFilePath(type: MemoryType): string {
    return path.join(memoryDir, `${type}.md`);
  }

  function ensureDir(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
      }
    });
  }

  // Atomic write: write to temp file, then rename
  function atomicWrite(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    const tempPath = path.join(dir, `.${basename}.tmp.${Date.now()}`);
    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, filePath);
  }

  function parseMemoryFile(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const lines = content.split("\n");
    let currentKey = "";
    let currentValue = "";
    let currentTimestamp = Date.now();
    let currentTags: string[] = [];
    let inEntry = false;

    for (const line of lines) {
      if (line.startsWith("## ")) {
        if (inEntry && currentKey) {
          entries.push({
            key: currentKey,
            value: currentValue.trim(),
            timestamp: currentTimestamp,
            tags: currentTags,
          });
        }
        currentKey = line.slice(3).trim();
        currentValue = "";
        currentTimestamp = Date.now();
        currentTags = [];
        inEntry = true;
      } else if (line.startsWith("tags:") && inEntry) {
        currentTags = line.slice(5).split(",").map((t) => t.trim()).filter(Boolean);
      } else if (line.startsWith("timestamp:") && inEntry) {
        currentTimestamp = parseInt(line.slice(10).trim(), 10) || Date.now();
      } else if (inEntry) {
        currentValue += line + "\n";
      }
    }

    if (inEntry && currentKey) {
      entries.push({
        key: currentKey,
        value: currentValue.trim(),
        timestamp: currentTimestamp,
        tags: currentTags,
      });
    }

    return entries;
  }

  function serializeMemoryFile(entries: MemoryEntry[]): string {
    return entries
      .map((e) => {
        let s = `## ${e.key}\ntimestamp: ${e.timestamp}\n`;
        if (e.tags && e.tags.length > 0) {
          s += `tags: ${e.tags.join(", ")}\n`;
        }
        s += `\n${e.value}\n`;
        return s;
      })
      .join("\n");
  }

  function readEntries(type: MemoryType): MemoryEntry[] {
    const filePath = getFilePath(type);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return parseMemoryFile(content);
  }

  return {
    read(key, type = "memory") {
      return Effect.gen(function* () {
        const entries = readEntries(type);
        const entry = entries.find((e) => e.key === key);
        if (!entry) {
          return yield* Effect.fail(new MemoryNotFoundError(key));
        }
        return entry.value;
      });
    },

    write(key, value, type = "memory") {
      return Effect.gen(function* () {
        yield* ensureDir();
        const filePath = getFilePath(type);
        const entries = readEntries(type);
        const existingIndex = entries.findIndex((e) => e.key === key);

        const newEntry: MemoryEntry = {
          key,
          value,
          timestamp: Date.now(),
        };

        if (existingIndex >= 0) {
          entries[existingIndex] = newEntry;
        } else {
          entries.push(newEntry);
        }

        try {
          atomicWrite(filePath, serializeMemoryFile(entries));
        } catch (err) {
          return yield* Effect.fail(new MemoryWriteError(key, err));
        }
      });
    },

    delete(key, type = "memory") {
      return Effect.gen(function* () {
        const filePath = getFilePath(type);
        const entries = readEntries(type);
        const filtered = entries.filter((e) => e.key !== key);
        if (filtered.length === entries.length) {
          return yield* Effect.fail(new MemoryNotFoundError(key));
        }
        atomicWrite(filePath, serializeMemoryFile(filtered));
      });
    },

    list(type = "memory") {
      return Effect.sync(() => readEntries(type));
    },

    search(query, type = "memory") {
      return Effect.sync(() => {
        const entries = readEntries(type);
        const lowerQuery = query.toLowerCase();
        return entries.filter(
          (e) =>
            e.key.toLowerCase().includes(lowerQuery) ||
            e.value.toLowerCase().includes(lowerQuery)
        );
      });
    },

    getMemoryPath(type) {
      return getFilePath(type);
    },
  };
}
