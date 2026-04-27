// Nexus Brain — Skill Self-Generator (自学习循环)
// 遇到新问题 → 自动生成 Skill → 下次同类问题秒解
// 每天最多生成 3 个 Skill，每次最多消耗 5000 tokens

import { Effect, Context } from "effect";
import type { Skill, SkillGenBudget } from "./budget.js";

export interface SkillTemplate {
  name: string;
  description: string;
  trigger: string[];
  content: string;
}

export class SkillGenLimitError extends Error {
  constructor(public readonly budget: SkillGenBudget) {
    super(`Skill generation limit reached: ${budget.usedToday}/${budget.maxPerDay}`);
    this.name = "SkillGenLimitError";
  }
}

export interface SkillGenerator {
  readonly generate: (template: SkillTemplate) => Effect.Effect<Skill, SkillGenLimitError>;
  readonly shouldGenerate: (task: string, existingSkills: Skill[]) => boolean;
  readonly getBudget: () => SkillGenBudget;
}

export const SkillGenerator = Context.GenericTag<SkillGenerator>("SkillGenerator");

export function makeSkillGenerator(
  onGenerate?: (skill: Skill) => void,
  initialBudget?: Partial<SkillGenBudget>
): SkillGenerator {
  let budget: SkillGenBudget = {
    usedToday: 0,
    lastReset: Date.now(),
    maxPerDay: 3,
    maxTokensPerGen: 5000,
    ...initialBudget,
  };

  function resetIfNewDay() {
    const today = new Date().setHours(0, 0, 0, 0);
    if (budget.lastReset < today) {
      budget.usedToday = 0;
      budget.lastReset = today;
    }
  }

  // 判断是否应该生成 skill
  function checkShouldGenerate(task: string, existingSkills: Skill[]): boolean {
    const taskLower = task.toLowerCase();
    // 检查是否有现成的 skill 能处理
    for (const s of existingSkills) {
      const descLower = s.description.toLowerCase();
      const triggersLower = s.trigger.map(t => t.toLowerCase());
      if (triggersLower.some(t => taskLower.includes(t))) return false;
      if (descLower.includes(taskLower.slice(0, 50))) return false;
    }
    return true;
  }

  // 生成 skill 名称
  function generateSkillName(template: SkillTemplate): string {
    const action = template.name.replace(/\s+/g, "-").toLowerCase();
    return action;
  }

  // 生成 compact content
  function generateCompact(content: string): string {
    const lines = content.split("\n");
    const truncated = lines.slice(0, 20).join("\n");
    return `${truncated.slice(0, 500)}...`;
  }

  return {
    generate(template) {
      return Effect.gen(function* () {
        resetIfNewDay();
        if (budget.usedToday >= budget.maxPerDay) {
          return yield* Effect.fail(new SkillGenLimitError(budget));
        }

        const skill: Skill = {
          name: generateSkillName(template),
          description: template.description,
          trigger: template.trigger,
          content: template.content,
          compactContent: generateCompact(template.content),
          lastUsed: Date.now(),
          useCount: 0,
          budget: {
            tokensPerUse: 1000,
            dailyLimit: 50,
            priority: "medium",
          },
        };

        budget = { ...budget, usedToday: budget.usedToday + 1 };
        onGenerate?.(skill);
        return skill;
      });
    },

    shouldGenerate(task, existingSkills) {
      resetIfNewDay();
      if (budget.usedToday >= budget.maxPerDay) return false;
      return checkShouldGenerate(task, existingSkills);
    },

    getBudget() {
      resetIfNewDay();
      return { ...budget };
    },
  };
}

// 从对话历史中提取 skill 模板
export function extractSkillTemplate(
  task: string,
  solution: string,
  context: string
): SkillTemplate {
  const taskClean = task.trim();
  const contextLines = context.split("\n").filter(l => l.trim().length > 0);

  // 生成触发词：从任务描述中提取关键词
  const words = taskClean.split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !["如何", "怎么", "为什么", "什么", "请问", "帮我", "我想"].includes(w));

  const triggers = [...new Set(words)].slice(0, 5);

  return {
    name: taskClean.slice(0, 40),
    description: `处理 ${triggers[0] || taskClean.slice(0, 30)} 相关任务`,
    trigger: triggers,
    content: `# Skill: ${taskClean.slice(0, 50)}

## Task
${taskClean}

## Solution
${solution}

## Context
${contextLines.slice(-10).join("\n")}

## Notes
- 自动生成，请验证内容准确性
`,
  };
}
