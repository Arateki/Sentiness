#!/usr/bin/env node
// OIDC Trusted Publishing for a pnpm workspace.
//
// Why this script exists: `changeset publish` shells out to `pnpm publish`
// (because package.json declares packageManager: pnpm), and pnpm does not yet
// implement npm's OIDC Trusted Publishing exchange — so it fails with ENEEDAUTH
// when no token is present. `npm publish` (>= 11.5.1) DOES the OIDC exchange, but
// it cannot resolve the `workspace:*` protocol. This script bridges the two:
//   1. `pnpm pack` produces a tarball with workspace:* resolved to real versions.
//   2. `npm publish <tarball> --provenance` uploads it via the OIDC identity.
//
// Idempotent: a package whose current version is already on the registry is skipped,
// so re-running after a partial failure only publishes what is missing.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const containers = ['packages', join('packages', 'checks')];

/** @typedef {{ name: string; version: string; dir: string }} WorkspacePackage */

/** @returns {WorkspacePackage[]} */
function discoverPublicPackages() {
  /** @type {WorkspacePackage[]} */
  const found = [];
  for (const container of containers) {
    const base = join(root, container);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(base, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.private === true || typeof manifest.name !== 'string') continue;
      found.push({ name: manifest.name, version: manifest.version, dir });
    }
  }
  return found;
}

/** @returns {boolean} */
function isAlreadyPublished(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim() === version;
  } catch (error) {
    const stderr = String(
      error && typeof error === 'object' && 'stderr' in error ? error.stderr : '',
    );
    // A missing version (not yet published) reports E404 — that's the publish case.
    if (stderr.includes('E404') || stderr.includes('404')) return false;
    throw new Error(`npm view failed for ${name}@${version}: ${stderr || String(error)}`, {
      cause: error,
    });
  }
}

/** @param {WorkspacePackage} pkg */
function packAndPublish(pkg) {
  // pnpm resolves workspace:* into concrete versions inside the tarball.
  const packOutput = execFileSync('pnpm', ['pack', '--pack-destination', root], {
    cwd: pkg.dir,
    encoding: 'utf8',
  });
  const tarballLine = packOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .pop();
  if (!tarballLine) {
    throw new Error(`pnpm pack produced no tarball for ${pkg.name}@${pkg.version}: ${packOutput}`);
  }
  const tarballPath = tarballLine.startsWith('/') ? tarballLine : join(root, tarballLine);
  // npm (>= 11.5.1) performs the OIDC Trusted Publishing exchange; provenance comes
  // from the workflow's id-token. --access public is required for scoped packages.
  execFileSync(
    'npm',
    ['publish', tarballPath, '--access', 'public', '--provenance', '--tag', 'latest'],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  // The Changesets action scrapes stdout for these lines to create GitHub releases.
  console.log(`New tag: ${pkg.name}@${pkg.version}`);
}

function main() {
  const packages = discoverPublicPackages();
  const toPublish = packages.filter((pkg) => !isAlreadyPublished(pkg.name, pkg.version));
  if (toPublish.length === 0) {
    console.log('No unpublished packages to publish.');
    return;
  }
  console.log(
    `Publishing ${toPublish.length} package(s): ${toPublish.map((p) => `${p.name}@${p.version}`).join(', ')}`,
  );

  /** @type {{ pkg: WorkspacePackage; error: unknown }[]} */
  const failures = [];
  for (const pkg of toPublish) {
    try {
      packAndPublish(pkg);
    } catch (error) {
      failures.push({ pkg, error });
      console.error(`Failed to publish ${pkg.name}@${pkg.version}: ${String(error)}`);
    }
  }
  if (failures.length > 0) {
    const names = failures.map((f) => `${f.pkg.name}@${f.pkg.version}`).join(', ');
    throw new Error(`Failed to publish: ${names}`);
  }
  console.log('All packages published.');
}

main();
