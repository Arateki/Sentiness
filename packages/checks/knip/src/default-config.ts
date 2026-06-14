import type { CheckDefaultConfig, DefaultConfigContext } from '@sentiness/check-sdk';
import { ignoredDependenciesForChecks } from './ignore.js';

const KNIP_SCHEMA_URL = 'https://unpkg.com/knip@6/schema.json';

/**
 * Scaffolds a minimal `knip.json` whose `ignoreDependencies` lists the
 * `@sentiness/*` scope plus the tool binaries of the *enabled* checks, so a repo
 * that runs knip directly (outside the Sentiness gate — IDE, lint-staged, a
 * separate CI job) is clean too. The runtime filter (issue #7) keeps the gate
 * green even when this file is absent, which is why knip marks config optional.
 */
export function buildKnipDefaultConfig(context: DefaultConfigContext): CheckDefaultConfig {
  const config = {
    $schema: KNIP_SCHEMA_URL,
    ignoreDependencies: ignoredDependenciesForChecks(context.enabledCheckIds),
  };
  return {
    path: 'knip.json',
    content: `${JSON.stringify(config, null, 2)}\n`,
  };
}
