// Nexus × Hermes Skill Bridge
// Calls real Hermes Python skill_manager_tool.py as subprocess

import { spawn } from "node:child_process";
import os from "node:os";

function getHome(): string { return os.homedir(); }
const HERMES_HOME = process.env.HERMES_HOME || `${getHome()}/.hermes`;
const IS_WIN = process.platform === "win32";
const PYTHON_BIN = IS_WIN
  ? `${HERMES_HOME}/hermes-agent/venv/Scripts/python.exe`
  : `${HERMES_HOME}/hermes-agent/venv/bin/python3`;
const HERMES_TOOL_PY = `${HERMES_HOME}/hermes-agent/tools/skill_manager_tool.py`;

export interface SkillAction {
  action: "create" | "patch" | "edit" | "delete" | "write_file" | "remove_file";
  name: string;
  content?: string;
  category?: string;
  file_path?: string;
  file_content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

export interface SkillResult {
  success: boolean;
  output: string;
  error?: string;
}

export async function callHermesSkillTool(action: SkillAction): Promise<SkillResult> {
  const jsonArgs = JSON.stringify(action);

  return new Promise((resolve) => {
    const p = spawn(PYTHON_BIN, [
      "-c",
      `import sys; sys.path.insert(0, '${HERMES_TOOL_PY}'.rsplit('/', 1)[0]); from skill_manager_tool import skill_manage; print(skill_manage(**${jsonArgs}))`,
    ], { timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    p.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    p.on("close", (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve({ success: true, output: JSON.stringify(parsed) });
        } catch {
          resolve({ success: true, output: stdout.trim() });
        }
      } else {
        resolve({ success: false, output: stderr.trim() || stdout.trim(), error: `exit ${code}` });
      }
    });
    p.on("error", (err) => {
      resolve({ success: false, output: "", error: err.message });
    });

    setTimeout(() => {
      p.kill("SIGKILL");
      resolve({ success: false, output: "", error: "timeout after 30s" });
    }, 30000);
  });
}

export async function listHermesSkills(): Promise<string[]> {
  const skillsDir = `${getHome()}/.hermes/skills`;
  return new Promise((resolve) => {
    const { existsSync } = require("node:fs");
    if (!existsSync(skillsDir)) { resolve([]); return; }
    const p = spawn("find", [skillsDir, "-name", "SKILL.md", "-type", "f"]);
    let stdout = "";
    p.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    p.on("close", () => {
      resolve(stdout.trim().split("\n").filter(Boolean));
    });
    p.on("error", () => resolve([]));
  });
}
