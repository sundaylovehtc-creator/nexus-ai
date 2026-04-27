// Nexus Brain — Skill Registry (Skill 存储 + 加载)
// YAML frontmatter 验证 + 三级降级 + 动态加载

import { Effect, Context } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Skill } from "./budget.js";
import { compactSkill, getSkillAtTier } from "./budget.js";

export interface SkillRegistry {
  readonly register: (skill: Skill) => Effect.Effect<void>;
  readonly unregister: (name: string) => Effect.Effect<void>;
  readonly get: (name: string, availableBudget: number) => Effect.Effect<string>;
  readonly list: () => Effect.Effect<Skill[]>;
  readonly findByTrigger: (query: string) => Effect.Effect<Skill[]>;
  readonly saveAll: () => Effect.Effect<void>;
  readonly loadAll: () => Effect.Effect<number>;
}

export const SkillRegistry = Context.GenericTag<SkillRegistry>("SkillRegistry");

import os from "node:os";
const DEFAULT_SKILLS_DIR = path.join(os.homedir(), ".nexus", "skills");

function parseFrontmatter(content: string): { meta: Record<string, unknown>, body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const [k, ...v] = line.split(":");
    if (k && v.length) meta[k.trim()] = v.join(":").trim();
  }
  return { meta, body: match[2] };
}

function serializeWithFrontmatter(meta: Record<string, unknown>, body: string): string {
  const fm = Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${fm}\n---\n${body}`;
}

export function makeSkillRegistry(skillsDir: string = DEFAULT_SKILLS_DIR): SkillRegistry {
  const skills = new Map<string, Skill>();

  function skillFile(name: string): string {
    return path.join(skillsDir, `${name}.md`);
  }

  function ensureDir(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    });
  }

  function skillToContent(skill: Skill): string {
    return serializeWithFrontmatter(
      {
        name: skill.name,
        description: skill.description,
        triggers: skill.trigger.join(", "),
        budget: `${skill.budget.priority}/${skill.budget.tokensPerUse}/${skill.budget.dailyLimit}`,
        lastUsed: skill.lastUsed,
        useCount: skill.useCount,
      },
      skill.content
    );
  }

  function contentToSkill(name: string, content: string): Skill | null {
    try {
      const { meta, body } = parseFrontmatter(content);
      const triggers = typeof meta.triggers === "string"
        ? meta.triggers.split(",").map((t: string) => t.trim()).filter(Boolean)
        : [];
      const [priority, tokensPerUse, dailyLimit] = typeof meta.budget === "string"
        ? meta.budget.split("/").map(Number)
        : ["medium", 1000, 50];
      return {
        name,
        description: String(meta.description || name),
        trigger: triggers,
        content: body,
        compactContent: compactSkill({ name, description: String(meta.description || ""), trigger: triggers, content: body, compactContent: "", lastUsed: 0, useCount: 0, budget: { priority: "medium", tokensPerUse: 1000, dailyLimit: 50 } }),
        lastUsed: Number(meta.lastUsed) || 0,
        useCount: Number(meta.useCount) || 0,
        budget: { priority: (priority as "high" | "medium" | "low") || "medium", tokensPerUse: tokensPerUse || 1000, dailyLimit: dailyLimit || 50 },
      };
    } catch {
      return null;
    }
  }

  return {
    register(skill) {
      return Effect.gen(function* () {
        yield* ensureDir();
        skills.set(skill.name, skill);
        const filePath = skillFile(skill.name);
        fs.writeFileSync(filePath, skillToContent(skill), "utf-8");
      });
    },

    unregister(name) {
      return Effect.gen(function* () {
        skills.delete(name);
        const filePath = skillFile(name);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
    },

    get(name, availableBudget) {
      return Effect.gen(function* () {
        const skill = skills.get(name);
        if (!skill) return "";
        skill.lastUsed = Date.now();
        skill.useCount += 1;
        return getSkillAtTier(skill, availableBudget);
      });
    },

    list() {
      return Effect.sync(() => Array.from(skills.values()));
    },

    findByTrigger(query) {
      return Effect.sync(() => {
        const lower = query.toLowerCase();
        return Array.from(skills.values()).filter(s =>
          s.trigger.some(t => lower.includes(t.toLowerCase())) ||
          s.description.toLowerCase().includes(lower)
        );
      });
    },

    saveAll() {
      return Effect.gen(function* () {
        yield* ensureDir();
        for (const skill of skills.values()) {
          fs.writeFileSync(skillFile(skill.name), skillToContent(skill), "utf-8");
        }
      });
    },

    loadAll() {
      return Effect.gen(function* () {
        yield* ensureDir();
        if (!fs.existsSync(skillsDir)) return 0;
        let count = 0;
        for (const file of fs.readdirSync(skillsDir)) {
          if (!file.endsWith(".md")) continue;
          const content = fs.readFileSync(path.join(skillsDir, file), "utf-8");
          const name = path.basename(file, ".md");
          const skill = contentToSkill(name, content);
          if (skill) { skills.set(name, skill); count++; }
        }
        return count;
      });
    },
  };
}
