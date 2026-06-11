import { createFileAdapter, createSkillFileAdapter } from './claude-code.js';

export const codexAdapter = createFileAdapter('codex', 'AGENTS.md');

// Codex discovers repository-scoped skills from .agents/skills/<name>/SKILL.md;
// AGENTS.md is durable instruction context, not a /skills entry.
export const codexSkillAdapter = createSkillFileAdapter(
  'codex-skill',
  '.agents/skills/sentiness/SKILL.md',
);
