import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const publicPackages = [
  {
    dir: 'packages/check-sdk',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/adapters',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'dist/skill-template.md', 'README.md'],
  },
  {
    dir: 'packages/core',
    requiredFiles: [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/cli/index.js',
      'schema/report.schema.json',
      'README.md',
    ],
  },
  {
    dir: 'packages/checks/biome',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/coverage',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/dependency-cruiser',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/deps-diff',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/jscpd',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/knip',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/lockfile-lint',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/osv-scanner',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/playwright',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/semgrep',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
  {
    dir: 'packages/checks/stryker',
    requiredFiles: ['dist/index.js', 'dist/index.d.ts', 'README.md'],
  },
];

const forbiddenPathPatterns = [
  /^src\//,
  /^test\//,
  /^coverage\//,
  /\.test\.[cm]?[jt]s$/,
  /\.test\.d\.ts$/,
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function collectFiles(root, relativePath) {
  const absolutePath = join(root, relativePath);
  const entryStat = await stat(absolutePath);
  if (entryStat.isFile()) {
    return [relativePath];
  }

  const files = [];
  for (const entry of await readdir(absolutePath)) {
    files.push(...(await collectFiles(root, join(relativePath, entry))));
  }
  return files;
}

async function allowedFiles(packageDir, manifest) {
  const packageRoot = join(repoRoot, packageDir);
  const files = ['package.json'];
  for (const entry of manifest.files) {
    assert(
      await pathExists(join(packageRoot, entry)),
      `${packageDir} package file is missing: ${entry}`,
    );
    files.push(...(await collectFiles(packageRoot, entry)));
  }
  return [...new Set(files)].sort();
}

function validateManifest(packageDir, manifest) {
  assert(manifest.private !== true, `${packageDir} is marked private but is in release checks`);
  assert(
    manifest.exports?.['.']?.types === './dist/index.d.ts',
    `${packageDir} must export dist/index.d.ts as its public type entry`,
  );
  assert(
    manifest.exports?.['.']?.default === './dist/index.js',
    `${packageDir} must export dist/index.js as its public runtime entry`,
  );
  assert(Array.isArray(manifest.files), `${packageDir} must declare a package files allowlist`);
  assert(manifest.files.includes('dist'), `${packageDir} package files must include dist`);
}

function validatePackContents(packageDir, files, requiredFiles) {
  for (const required of requiredFiles) {
    assert(files.includes(required), `${packageDir} package is missing ${required}`);
  }

  for (const file of files) {
    assert(
      !forbiddenPathPatterns.some((pattern) => pattern.test(file)),
      `${packageDir} package includes non-release artifact: ${file}`,
    );
  }
}

for (const packageInfo of publicPackages) {
  const manifest = await readJson(join(repoRoot, packageInfo.dir, 'package.json'));
  validateManifest(packageInfo.dir, manifest);
  validatePackContents(
    packageInfo.dir,
    await allowedFiles(packageInfo.dir, manifest),
    packageInfo.requiredFiles,
  );
}

process.stdout.write(`Release package checks passed for ${publicPackages.length} packages.\n`);
