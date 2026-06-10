import { dirname, join } from 'node:path';
import type { FileSystem } from '@sentiness/check-sdk';
import { renderSkill } from './render.js';
import type { AgentAdapter, AgentName, InstallResult, RenderOptions } from './types.js';

const SKILL_RELATIVE_PATH = '.claude/skills/sentiness/SKILL.md';
const SKILL_FRONTMATTER = `---
name: sentiness
description: Run Sentiness quality checks before declaring a task complete and after every meaningful edit. Use when the user is wrapping up changes, asks to "verify", "check", or "validate" code, when CI is failing locally, or when there are unacked Sentiness pending feedback items from a previous session.
---
`;

function skillFileContent(options: RenderOptions): string {
  return `${SKILL_FRONTMATTER}\n${renderSkill(options).trimEnd()}\n`;
}

const START_MARKER = '<!-- sentiness:start -->';
const END_MARKER = '<!-- sentiness:end -->';

type TargetFile = string;

function managedSection(options: RenderOptions): string {
  return `${START_MARKER}\n${renderSkill(options).trimEnd()}\n${END_MARKER}\n`;
}

interface MarkerLine {
  readonly lineStart: number;
  readonly lineEnd: number;
}

// Only a line whose entire trimmed content is the marker counts: marker text
// quoted inline (e.g. in documentation) must never delimit the managed section.
function findMarkerLine(content: string, marker: string): MarkerLine | undefined {
  let offset = 0;
  for (const line of content.split('\n')) {
    if (line.trim() === marker) {
      return { lineStart: offset, lineEnd: offset + line.length };
    }
    offset += line.length + 1;
  }
  return undefined;
}

function replaceManagedSection(content: string, section: string, targetPath: string): string {
  const start = findMarkerLine(content, START_MARKER);
  const end = findMarkerLine(content, END_MARKER);

  if (!start && !end) {
    const separator = content.trimEnd().length > 0 ? '\n\n' : '';
    return `${content.trimEnd()}${separator}${section}`;
  }

  if (!start || !end || end.lineStart < start.lineStart) {
    throw new Error(`Invalid Sentiness managed section markers in ${targetPath}`);
  }

  const before = content.slice(0, start.lineStart).trimEnd();
  const after = content.slice(end.lineEnd).trimStart();
  const prefix = before.length > 0 ? `${before}\n\n` : '';
  const suffix = after.length > 0 ? `\n${after}` : '';
  return `${prefix}${section}${suffix}`;
}

async function writeIfChanged(path: string, nextContent: string, fs: FileSystem): Promise<boolean> {
  if ((await fs.exists(path)) && (await fs.readFile(path)) === nextContent) {
    return false;
  }
  await fs.writeFile(path, nextContent);
  return true;
}

export function createFileAdapter(agent: AgentName, targetFile: TargetFile): AgentAdapter {
  return {
    agent,
    targetFile,
    async install(cwd: string, fs: FileSystem, options: RenderOptions): Promise<InstallResult> {
      const targetPath = join(cwd, targetFile);
      const section = managedSection(options);
      const content = (await fs.exists(targetPath)) ? await fs.readFile(targetPath) : '';
      const nextContent = replaceManagedSection(content, section, targetPath);
      const changed = await writeIfChanged(targetPath, nextContent, fs);
      return { agent, targetPath, changed };
    },
  };
}

export const claudeCodeAdapter = createFileAdapter('claude-code', 'CLAUDE.md');

export const claudeCodeSkillAdapter: AgentAdapter = {
  agent: 'claude-code-skill',
  targetFile: SKILL_RELATIVE_PATH,
  async install(cwd: string, fs: FileSystem, options: RenderOptions): Promise<InstallResult> {
    const targetPath = join(cwd, SKILL_RELATIVE_PATH);
    const nextContent = skillFileContent(options);
    await fs.mkdir(dirname(targetPath), { recursive: true });
    const changed = await writeIfChanged(targetPath, nextContent, fs);
    return { agent: 'claude-code-skill', targetPath, changed };
  },
};
