// Nexus Brain — Skill Loader (Bootstrap 预装Skills)
// 从 ~/.nexus/skills/ 目录加载所有 .md 文件到 registry

import { Effect } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import type { Skill } from "./budget.js";
import { makeSkillRegistry } from "./registry.js";
import { makeSkillGenerator } from "./self-generator.js";

export interface PresetSkill {
  name: string;
  content: string;
}

export const DEFAULT_SKILLS_DIR = path.join(os.homedir(), ".nexus", "skills");

// Parse YAML frontmatter from markdown content
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const k = line.slice(0, colonIdx).trim();
    const v = line.slice(colonIdx + 1).trim();
    if (k) meta[k] = v;
  }
  return { meta, body: match[2] };
}

function parseBudgetStr(budgetStr: string): { priority: "high" | "medium" | "low"; tokensPerUse: number; dailyLimit: number } {
  const parts = budgetStr.split("/").map(Number);
  return {
    priority: (["high", "medium", "low"][parts[0] - 1] as "high" | "medium" | "low") || "medium",
    tokensPerUse: parts[1] || 1500,
    dailyLimit: parts[2] || 50,
  };
}

function contentToSkill(name: string, content: string): Skill | null {
  try {
    const { meta, body } = parseFrontmatter(content);
    const triggers = typeof meta.triggers === "string"
      ? meta.triggers.split(",").map((t: string) => t.trim()).filter(Boolean)
      : [];
    const budgetStr = typeof meta.budget === "string" ? meta.budget : "2/1500/50";
    const budget = parseBudgetStr(budgetStr);

    return {
      name,
      description: String(meta.description || name),
      trigger: triggers,
      content: body,
      compactContent: body.split("\n").slice(0, 20).join("\n").slice(0, 500),
      lastUsed: Number(meta.lastUsed) || 0,
      useCount: Number(meta.useCount) || 0,
      budget,
    };
  } catch {
    return null;
  }
}

// Check if a file is a valid preset skill (has frontmatter + content)
function isValidSkill(name: string, content: string): boolean {
  const { meta, body } = parseFrontmatter(content);
  return !!(meta.name && meta.description && body.trim().length > 50);
}

export interface LoaderResult {
  loadedCount: number;
  errors: string[];
}

// Load all skills from directory, return { registry, generator, result }
export function createSkillSystem(skillsDir: string = DEFAULT_SKILLS_DIR): {
  registry: ReturnType<typeof makeSkillRegistry>;
  generator: ReturnType<typeof makeSkillGenerator>;
  result: LoaderResult;
} {
  const errors: string[] = [];
  let loadedCount = 0;

  const registry = makeSkillRegistry(skillsDir);
  const generator = makeSkillGenerator();

  // Load all .md files from skillsDir
  if (fs.existsSync(skillsDir)) {
    for (const file of fs.readdirSync(skillsDir)) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(skillsDir, file);
      const name = path.basename(file, ".md");
      const content = fs.readFileSync(filePath, "utf-8");

      if (!isValidSkill(name, content)) {
        errors.push(`Invalid skill format: ${file}`);
        continue;
      }

      const skill = contentToSkill(name, content);
      if (skill) {
        try {
          Effect.runPromise(registry.register(skill));
          loadedCount++;
        } catch (e: unknown) {
          errors.push(`Failed to register ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  return {
    registry,
    generator,
    result: { loadedCount, errors },
  };
}

// Trigger-based skill lookup
export function matchSkills(registry: ReturnType<typeof makeSkillRegistry>, query: string): Skill[] {
  const lower = query.toLowerCase();
  const matched: Array<{ skill: Skill; score: number }> = [];

  // Sync load for in-memory skills (already loaded)
  const skills = registry.list() as unknown as Skill[];

  for (const skill of skills) {
    let score = 0;
    for (const trigger of skill.trigger) {
      if (lower.includes(trigger.toLowerCase())) {
        score += trigger.length; // Longer trigger = higher score
      }
    }
    if (score > 0) {
      matched.push({ skill, score });
    }
  }

  return matched
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(m => m.skill);
}
