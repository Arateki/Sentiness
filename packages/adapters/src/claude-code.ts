import { join } from 'node:path';
import type { FileSystem } from '@sentiness/check-sdk';
import { renderSkill } from './render.js';
import type { AgentAdapter, AgentName, InstallResult, RenderOptions } from './types.js';

const START_MARKER = '<!-- sentiness:start -->';
const END_MARKER = '<!-- sentiness:end -->';

type TargetFile = AgentAdapter['targetFile'];

function managedSection(options: RenderOptions): string {
  return `${START_MARKER}\n${renderSkill(options).trimEnd()}\n${END_MARKER}\n`;
}

function replaceManagedSection(content: string, section: string, targetPath: string): string {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);

  if (start === -1 && end === -1) {
    const separator = content.trimEnd().length > 0 ? '\n\n' : '';
    return `${content.trimEnd()}${separator}${section}`;
  }

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Invalid Sentiness managed section markers in ${targetPath}`);
  }

  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end + END_MARKER.length).trimStart();
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
