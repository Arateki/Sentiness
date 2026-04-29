import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asCheckId } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '../config/config.js';
import { DEFAULT_CONFIG } from '../config/config.js';
import { CheckLoadError, CheckNotFoundError, CheckRegistry } from './registry.js';

describe('registry', () => {
  it('loads checks successfully', async () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      checks: {
        'non-existent': { enabled: true, tier: 'slow' },
        'invalid@@': { enabled: true },
        disabled: { enabled: false },
      },
    };

    const registry = await CheckRegistry.fromConfig(config, process.cwd());
    const failures = registry.loadFailures();

    const invalidFailure = failures.find((f) => f.requestedId === asCheckId('invalid@@'));
    expect(invalidFailure?.message).toMatch(/Invalid check id/);

    const notFoundFailure = failures.find((f) => f.requestedId === asCheckId('non-existent'));
    expect(notFoundFailure?.moduleName).toBe('@sentiness/check-non-existent');

    const slowChecks = registry.filterByTier('slow');
    expect(slowChecks).toEqual([]);

    expect(registry.list()).toEqual([]);
    expect(registry.get(asCheckId('non-existent'))).toBeUndefined();
  });

  it('throws CheckNotFoundError and CheckLoadError', () => {
    const notFound = new CheckNotFoundError(asCheckId('foo'));
    expect(notFound.name).toBe('CheckNotFoundError');

    const loadErr = new CheckLoadError('msg', {
      requestedId: asCheckId('foo'),
      moduleName: 'bar',
      message: 'err',
    });
    expect(loadErr.name).toBe('CheckLoadError');
    expect(loadErr.failure.moduleName).toBe('bar');
  });

  it('validates check exports through a real mock module', async () => {
    const tempDir = join(process.cwd(), '.sentiness-test-registry');
    mkdirSync(tempDir, { recursive: true });

    const writeMockPkg = (name: string, content: string) => {
      mkdirSync(join(tempDir, 'node_modules', '@sentiness', name), { recursive: true });
      writeFileSync(join(tempDir, 'node_modules', '@sentiness', name, 'index.js'), content);
    };

    writeMockPkg('check-bad1', `export default { id: 123 };`); // bad id
    writeMockPkg('check-bad2', `export default { id: "a", category: "nope" };`); // bad category
    writeMockPkg(
      'check-bad3',
      `export default { id: "a", category: "lint", defaultTier: "nope" };`,
    ); // bad defaultTier
    writeMockPkg(
      'check-bad4',
      `export default { id: "a", category: "lint", defaultTier: "fast", detect: 1 };`,
    ); // bad detect function
    writeMockPkg('check-bad5', `export const noDefault = true;`); // missing default export
    writeMockPkg('check-bad6', `export default "not an object";`); // default export is not an object
    writeFileSync(join(tempDir, 'package.json'), `{"name": "test-pkg"}`);

    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      checks: {
        bad1: { enabled: true },
        bad2: { enabled: true },
        bad3: { enabled: true },
        bad4: { enabled: true },
        bad5: { enabled: true },
        bad6: { enabled: true },
      },
    };
    const registry = await CheckRegistry.fromConfig(config, tempDir);

    const getFail = (id: string) =>
      registry.loadFailures().find((f) => f.requestedId === asCheckId(id))?.message;

    expect(getFail('bad1')).toMatch(/check.id must be a string/);
    expect(getFail('bad2')).toMatch(/check.category is invalid/);
    expect(getFail('bad3')).toMatch(/check.defaultTier is invalid/);
    expect(getFail('bad4')).toMatch(/check.detect and check.run must be functions/);
    expect(getFail('bad5')).toMatch(/module has no default export/);
    expect(getFail('bad6')).toMatch(/default export is not an object/);
  });
});
