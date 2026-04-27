// Nexus Brain — Public API
export { makeMemoryManager, type MemoryManager, type MemoryEntry, type MemoryLayers } from "./memory/manager.js";
export { makeDreamingEngine, type DreamingEngine, type DreamConfig, type DreamResult, DEFAULT_DREAM_CONFIG } from "./dreaming/engine.js";
export { makeSkillGenerator, extractSkillTemplate, type SkillGenerator, type SkillTemplate } from "./skills/self-generator.js";
export { makeSkillRegistry, type SkillRegistry } from "./skills/registry.js";
