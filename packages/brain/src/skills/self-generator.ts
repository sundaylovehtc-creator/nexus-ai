// Nexus Brain — Skill Self-Generator (按需生成，无次数限制)
// 遇到新问题 → 自动生成 Skill → 下次同类问题秒解
// Skill生成本身不限次数（这是能力），对话token预算是另一回事

import { Effect, Context } from "effect";
import type { Skill } from "./budget.js";

export interface SkillTemplate {
  name: string;
  description: string;
  trigger: string[];
  content: string;
}

export interface SkillGenerator {
  readonly generate: (template: SkillTemplate) => Effect.Effect<Skill>;
  readonly shouldGenerate: (task: string, existingSkills: Skill[]) => boolean;
  readonly getGeneratedCount: () => number;
}

export const SkillGenerator = Context.GenericTag<SkillGenerator>("SkillGenerator");

function generateSkillName(template: SkillTemplate): string {
  const action = template.name.replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return action || "skill";
}

function generateCompact(content: string): string {
  const lines = content.split("\n");
  const truncated = lines.slice(0, 20).join("\n");
  return truncated.slice(0, 500);
}

export function makeSkillGenerator(
  onGenerate?: (skill: Skill) => void
): SkillGenerator {
  let generatedCount = 0;

  // 判断是否应该生成 skill
  // 核心原则：按需生成，不重复造轮子
  function checkShouldGenerate(task: string, existingSkills: Skill[]): boolean {
    const taskLower = task.toLowerCase();

    for (const s of existingSkills) {
      // 完全匹配描述
      if (s.description.toLowerCase() === taskLower) return false;
      // 触发词命中
      if (s.trigger.some(t => taskLower.includes(t.toLowerCase()))) return false;
      // 描述包含任务关键词（宽松匹配）
      const taskKeywords = taskLower.split(/\s+/).filter(w => w.length > 4);
      const descLower = s.description.toLowerCase();
      const matchCount = taskKeywords.filter(k => descLower.includes(k)).length;
      if (matchCount >= 2) return false; // 已有skill能处理
    }
    return true;
  }

  return {
    generate(template) {
      return Effect.gen(function* () {
        generatedCount++;

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
            dailyLimit: 999999, // 不限制
            priority: "medium",
          },
        };

        onGenerate?.(skill);
        return skill;
      });
    },

    shouldGenerate(task, existingSkills) {
      return checkShouldGenerate(task, existingSkills);
    },

    getGeneratedCount() {
      return generatedCount;
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
  const stopWords = new Set(["如何", "怎么", "为什么", "什么", "请问", "帮我", "我想", "可以", "这个", "那个", "一下", "帮我"]);
  const words = taskClean.split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !stopWords.has(w));

  const triggers = [...new Set(words)].slice(0, 5);

  return {
    name: taskClean.slice(0, 40),
    description: `${triggers[0] || taskClean.slice(0, 30)}相关任务 — 自动生成`,
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
