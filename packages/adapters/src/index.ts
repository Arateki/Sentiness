import { claudeCodeAdapter, claudeCodeSkillAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { geminiAdapter } from './gemini.js';
import { renderSkill, TEMPLATE_VERSION } from './render.js';
import type { AgentAdapter, AgentName } from './types.js';

const adapters = [claudeCodeAdapter, claudeCodeSkillAdapter, codexAdapter, geminiAdapter] as const;

export type { AgentAdapter, AgentName, InstallResult, RenderOptions } from './types.js';
export { renderSkill, TEMPLATE_VERSION };

export function listAdapters(): readonly AgentAdapter[] {
  return adapters;
}

export function getAdapter(agent: AgentName): AgentAdapter | undefined {
  return adapters.find((adapter) => adapter.agent === agent);
}
