import { join } from 'node:path';
import type { AgentAdapter, AgentName, InstallResult, RenderOptions } from '@sentiness/adapters';
import { loadConfig } from '../../config/config.js';
import { SENTINESS_VERSION } from '../../version.js';
import type { CommandDeps, ParsedArgs } from './types.js';

type AdapterModule = {
  readonly listAdapters: () => readonly AgentAdapter[];
  readonly getAdapter: (agent: AgentName) => AgentAdapter | undefined;
};

function isAgentName(value: string): value is AgentName {
  return value === 'claude-code' || value === 'codex' || value === 'gemini';
}

function parseAgent(value: unknown): AgentName | 'all' | undefined {
  if (value === 'all') {
    return 'all';
  }
  return typeof value === 'string' && isAgentName(value) ? value : undefined;
}

async function loadAdapterModule(deps: CommandDeps): Promise<AdapterModule> {
  if (deps.adapterLoader) {
    return deps.adapterLoader();
  }
  return import('@sentiness/adapters');
}

async function configPathFor(deps: CommandDeps): Promise<string> {
  if (await deps.fs.exists(join(deps.cwd, 'sentiness.config.js'))) {
    return 'sentiness.config.js';
  }
  return 'sentiness.config.json';
}

function adaptersFor(
  agent: AgentName | 'all',
  adapterModule: AdapterModule,
  configAgents?: readonly string[],
): readonly AgentAdapter[] {
  if (agent === 'all') {
    const all = adapterModule.listAdapters();
    if (configAgents && configAgents.length > 0) {
      return all.filter((adapter) => configAgents.includes(adapter.agent));
    }
    return all;
  }

  const adapter = adapterModule.getAdapter(agent);
  return adapter ? [adapter] : [];
}

export async function installSkillCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const requestedAgent = parseAgent(args.agent);
  if (!requestedAgent) {
    deps.logger.error('Usage: sentiness install-skill --agent=<claude-code|codex|gemini|all>');
    return 1;
  }

  const config = await loadConfig(deps.cwd, deps.fs);
  const adapterModule = await loadAdapterModule(deps);
  const adapters = adaptersFor(requestedAgent, adapterModule, config.agents);
  if (adapters.length === 0) {
    deps.logger.error(`No adapter available for agent "${requestedAgent}"`);
    return 1;
  }

  const renderOptions: RenderOptions = {
    sentinessVersion: SENTINESS_VERSION,
    configPath: await configPathFor(deps),
    baselinePath: config.baseline.path,
    pendingPath: config.pending.path,
  };

  const results: InstallResult[] = [];
  for (const adapter of adapters) {
    results.push(await adapter.install(deps.cwd, deps.fs, renderOptions));
  }

  deps.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  return 0;
}
