// Three-tier Skills Budget (from OpenClaw compact-format.test.ts)
// Tier1: full → Tier2: compact → Tier3: binary截断

export interface Skill {
  name: string;
  description: string;
  trigger: string[];
  content: string;
  compactContent: string;
  lastUsed: number;
  useCount: number;
  budget: SkillBudget;
}

export interface SkillBudget {
  tokensPerUse: number;
  dailyLimit: number;
  priority: "high" | "medium" | "low";
}

export const SKILL_BUDGET_TIERS = {
  high: { tokensPerUse: 3000, dailyLimit: 50, priority: "high" as const },
  medium: { tokensPerUse: 1000, dailyLimit: 100, priority: "medium" as const },
  low: { tokensPerUse: 300, dailyLimit: 200, priority: "low" as const },
};

export function compactSkill(skill: Skill): string {
  const lines = skill.content.split("\n");
  const truncated = lines.slice(0, 20).join("\n");
  return `## ${skill.name}\n${skill.description}\nTriggers: ${skill.trigger.join(", ")}\n\n${truncated.slice(0, 500)}`;
}

export function getSkillAtTier(skill: Skill, availableBudget: number): string {
  const b = SKILL_BUDGET_TIERS[skill.budget.priority];
  if (availableBudget >= b.tokensPerUse * 2) return skill.content;
  if (availableBudget >= b.tokensPerUse) return skill.compactContent;
  return skill.name;
}

export interface SkillGenBudget {
  usedToday: number;
  lastReset: number;
  maxPerDay: number;
  maxTokensPerGen: number;
}

export const DEFAULT_SKILL_GEN: SkillGenBudget = {
  usedToday: 0, lastReset: Date.now(), maxPerDay: 3, maxTokensPerGen: 5000,
};

export function canGenerateSkill(b: SkillGenBudget): boolean {
  const today = new Date().setHours(0, 0, 0, 0);
  if (b.lastReset < today) return true;
  return b.usedToday < b.maxPerDay;
}

export function useSkillGenBudget(b: SkillGenBudget): SkillGenBudget {
  return { ...b, usedToday: b.usedToday + 1, lastReset: Date.now() };
}
