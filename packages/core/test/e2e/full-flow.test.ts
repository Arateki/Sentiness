import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JobMetaSchema } from '../../src/jobs/types.js';
import { ReportSchema } from '../../src/schema/report.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const demoProject = join(repoRoot, 'examples/demo-project');
const cliPath = join(repoRoot, 'packages/core/dist/cli/index.js');
const rootBinPath = join(repoRoot, 'node_modules/.bin');
const checkPackages = {
  biome: join(repoRoot, 'packages/checks/biome'),
  coverage: join(repoRoot, 'packages/checks/coverage'),
  'dependency-cruiser': join(repoRoot, 'packages/checks/dependency-cruiser'),
} as const;
const execFileAsync = promisify(execFile);

type CheckPackageId = keyof typeof checkPackages;

type CliResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const JobIdSchema = z.object({ jobId: z.string().min(1) });
const DoctorResultSchema = z.object({
  ok: z.boolean(),
  checks: z.array(
    z.object({
      id: z.string(),
      available: z.boolean(),
      version: z.string().optional(),
      config: z
        .object({
          configured: z.boolean(),
          expectedFiles: z.array(z.string()),
          foundFile: z.string().optional(),
          canCreateDefault: z.boolean(),
        })
        .optional(),
      configSuggestion: z.string().optional(),
    }),
  ),
  loadFailures: z.array(z.unknown()),
});
const InitConfigResultSchema = z.object({
  outcomes: z.array(
    z.object({
      checkId: z.string(),
      action: z.enum(['created', 'skipped-existing', 'skipped-no-default', 'skipped-no-files']),
      path: z.string().optional(),
      existing: z.string().optional(),
    }),
  ),
});
const InstallSkillResultSchema = z.object({
  results: z.array(
    z.object({
      agent: z.enum(['claude-code', 'claude-code-skill', 'codex', 'codex-skill', 'gemini']),
      targetPath: z.string().min(1),
      changed: z.boolean(),
    }),
  ),
});
const PendingItemsSchema = z.array(
  z.object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    tier: z.enum(['fast', 'standard', 'slow']),
    summary: z.string(),
    reportPath: z.string().min(1),
    acked: z.boolean(),
  }),
);
const BaselineSnapshotSchema = z.object({
  schemaVersion: z.literal('1.0'),
  createdAtCommit: z.string().min(1),
  suppressed: z.array(
    z.object({
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().optional(),
    }),
  ),
  metrics: z.record(
    z.string(),
    z.object({
      value: z.number(),
      direction: z.enum(['higher-is-better', 'lower-is-better']),
    }),
  ),
});

const cleanupPaths: string[] = [];

afterEach(async () => {
  const paths = cleanupPaths.splice(0);
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
});

function cliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${rootBinPath}:${process.env.PATH ?? ''}`,
  };
}

async function runCli(cwd: string, args: readonly string[], input = ''): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: cliEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolveResult({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
    child.stdin.end(input);
  });
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout.trim());
}

// v2 config: each check is path-linked directly to the repo's built check
// package (relative to the project dir), so the engine resolves it without a
// cache or any project node_modules. The check's external tool (e.g. biome)
// still resolves from the inherited PATH via `cliEnv` (rootBinPath).
function buildV2Config(
  projectDir: string,
  checks: readonly CheckPackageId[],
  perCheck: Partial<Record<CheckPackageId, Record<string, unknown>>> = {},
): Record<string, unknown> {
  return {
    schemaVersion: '2.0',
    engine: '0.1.4',
    checks: Object.fromEntries(
      checks.map((id) => [
        id,
        { path: relative(projectDir, checkPackages[id]), ...(perCheck[id] ?? {}) },
      ]),
    ),
  };
}

async function writeConfig(projectDir: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(
    join(projectDir, 'sentiness.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function createDemoCopy(
  source: string,
  checks: readonly CheckPackageId[] = ['biome'],
  perCheck: Partial<Record<CheckPackageId, Record<string, unknown>>> = {},
): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'sentiness-e2e-'));
  cleanupPaths.push(tempRoot);
  const projectDir = join(tempRoot, 'demo-project');
  await cp(demoProject, projectDir, { recursive: true });
  await writeFile(join(projectDir, 'src/index.ts'), source);
  await writeConfig(projectDir, buildV2Config(projectDir, checks, perCheck));

  return projectDir;
}

async function writeCoverageReport(projectDir: string, hits: readonly [number, number]) {
  const coverageDir = join(projectDir, 'coverage');
  const sourcePath = join(projectDir, 'src/index.ts');
  await mkdir(coverageDir, { recursive: true });
  await writeFile(
    join(coverageDir, 'coverage-final.json'),
    `${JSON.stringify(
      {
        [sourcePath]: {
          path: sourcePath,
          statementMap: {
            '0': { start: { line: 1 }, end: { line: 1 } },
            '1': { start: { line: 2 }, end: { line: 2 } },
          },
          s: {
            '0': hits[0],
            '1': hits[1],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function createEmptyProject(): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), 'sentiness-e2e-empty-'));
  cleanupPaths.push(projectDir);
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'empty-project',
        private: true,
        type: 'module',
        devDependencies: {
          '@biomejs/biome': 'latest',
          '@sentiness/check-biome': 'workspace:*',
          typescript: 'latest',
        },
      },
      null,
      2,
    )}\n`,
  );
  return projectDir;
}

async function initGitRepo(projectDir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: projectDir });
  await execFileAsync('git', ['add', '.'], { cwd: projectDir });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Sentiness E2E', '-c', 'user.email=e2e@example.test', 'commit', '-m', 'init'],
    { cwd: projectDir },
  );
}

async function pollJob(projectDir: string, jobId: string): Promise<z.infer<typeof JobMetaSchema>> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await runCli(projectDir, ['status', jobId]);
    const meta = JobMetaSchema.parse(parseJson(status.stdout));
    if (meta.status !== 'running') {
      return meta;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
  }

  throw new Error(`Job ${jobId} did not finish in time`);
}

describe('Sentiness CLI E2E full flow', () => {
  it('diagnoses configured checks through doctor', async () => {
    const result = await runCli(demoProject, ['doctor']);
    const doctor = DoctorResultSchema.parse(parseJson(result.stdout));

    expect(result.exitCode).toBe(0);
    expect(doctor.ok).toBe(true);
    expect(doctor.loadFailures).toEqual([]);
    expect(doctor.checks).toEqual([
      expect.objectContaining({
        id: 'biome',
        available: true,
      }),
    ]);
    expect(doctor.checks[0]?.version).toContain('Version:');
  });

  it('flags a missing tool config in doctor and writes it through init-config', async () => {
    const projectDir = await createDemoCopy('export const value = 1;\n', ['dependency-cruiser']);

    const before = await runCli(projectDir, ['doctor']);
    const beforeDoctor = DoctorResultSchema.parse(parseJson(before.stdout));
    const cruiserBefore = beforeDoctor.checks.find((check) => check.id === 'dependency-cruiser');

    expect(before.exitCode).toBe(1);
    expect(beforeDoctor.ok).toBe(false);
    expect(cruiserBefore?.config).toMatchObject({
      configured: false,
      canCreateDefault: true,
    });
    expect(cruiserBefore?.config?.expectedFiles).toContain('.dependency-cruiser.cjs');
    expect(cruiserBefore?.configSuggestion).toBe(
      'sentiness init-config --check=dependency-cruiser',
    );

    const created = await runCli(projectDir, ['init-config', '--check=dependency-cruiser']);
    const createdOutcomes = InitConfigResultSchema.parse(parseJson(created.stdout));

    expect(created.exitCode).toBe(0);
    expect(createdOutcomes.outcomes).toEqual([
      { checkId: 'dependency-cruiser', action: 'created', path: '.dependency-cruiser.cjs' },
    ]);
    const written = await readFile(join(projectDir, '.dependency-cruiser.cjs'), 'utf8');
    expect(written).toContain('no-circular');
    expect(written).toContain('no-orphans');

    const after = await runCli(projectDir, ['doctor']);
    const afterDoctor = DoctorResultSchema.parse(parseJson(after.stdout));
    const cruiserAfter = afterDoctor.checks.find((check) => check.id === 'dependency-cruiser');

    expect(cruiserAfter?.config).toMatchObject({
      configured: true,
      foundFile: '.dependency-cruiser.cjs',
    });
    expect(cruiserAfter?.configSuggestion).toBeUndefined();

    const rerun = await runCli(projectDir, ['init-config', '--check=dependency-cruiser']);
    const rerunOutcomes = InitConfigResultSchema.parse(parseJson(rerun.stdout));
    const unchanged = await readFile(join(projectDir, '.dependency-cruiser.cjs'), 'utf8');

    expect(rerunOutcomes.outcomes[0]).toMatchObject({
      checkId: 'dependency-cruiser',
      action: 'skipped-existing',
      existing: '.dependency-cruiser.cjs',
    });
    expect(unchanged).toBe(written);
  });

  it('runs the built CLI against the demo project', async () => {
    const result = await runCli(demoProject, ['check', '--tier=fast', '--compact']);
    const report = ReportSchema.parse(parseJson(result.stdout));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(report.context.cwd).toBe(demoProject);
    expect(report.context.tier).toBe('fast');
    expect(report.summary.status).toBe('ok');
    expect(report.summary.checksRun).toBe(1);
  });

  it('reports real findings and a blocking exit code for a changed demo project', async () => {
    const projectDir = await createDemoCopy('const unused = 1\n');
    const result = await runCli(projectDir, ['check', '--tier=fast', '--compact']);
    const report = ReportSchema.parse(parseJson(result.stdout));
    const biomeResult = report.checks.find((check) => check.id === 'biome');
    const srcFinding = biomeResult?.findings.find(
      (finding) => finding.location.file === 'src/index.ts',
    );

    expect(result.exitCode).toBe(1);
    expect(report.summary.status).toBe('violations');
    expect(report.summary.blocking).toBe(true);
    expect(report.summary.checksRun).toBe(1);
    expect(biomeResult?.status).toBe('violations');
    expect(srcFinding?.ruleId).toBe('lint/correctness/noUnusedVariables');
    expect(srcFinding?.severity).toBe('warning');
    expect(report.agentInstructions.blocking).toBe(true);
  });

  it('completes the background check round-trip and enqueues pending feedback', async () => {
    const projectDir = await createDemoCopy('const unused = 1\n');
    const start = await runCli(projectDir, ['check', '--tier=fast', '--background', '--compact']);
    const { jobId } = JobIdSchema.parse(parseJson(start.stdout));

    expect(start.exitCode).toBe(0);

    const meta = await pollJob(projectDir, jobId);
    const resultText = await readFile(meta.resultPath, 'utf8');
    const report = ReportSchema.parse(parseJson(resultText));
    const pending = await runCli(projectDir, ['pending', '--all']);
    const pendingItems = PendingItemsSchema.parse(parseJson(pending.stdout));

    expect(meta.status).toBe('completed');
    expect(meta.exitCode).toBe(1);
    expect(report.summary.status).toBe('violations');
    expect(pending.exitCode).toBe(0);
    expect(pendingItems).toHaveLength(1);
    expect(pendingItems[0]?.jobId).toBe(jobId);
    expect(pendingItems[0]?.acked).toBe(false);

    const pendingId = pendingItems[0]?.id;
    expect(pendingId).toBeDefined();
    const ack = await runCli(projectDir, ['pending', 'ack', pendingId ?? '']);
    const afterAck = PendingItemsSchema.parse(
      parseJson((await runCli(projectDir, ['pending', '--all'])).stdout),
    );

    expect(ack.exitCode).toBe(0);
    expect(afterAck[0]?.acked).toBe(true);
  });

  it('creates a baseline that suppresses adopted findings', async () => {
    const projectDir = await createDemoCopy('const unused = 1\n');
    await writeFile(join(projectDir, '.gitignore'), '.sentiness/\n');
    await initGitRepo(projectDir);

    const init = await runCli(projectDir, ['baseline', 'init']);
    const baselineText = await readFile(join(projectDir, '.sentiness/baseline.json'), 'utf8');
    const baseline = BaselineSnapshotSchema.parse(parseJson(baselineText));
    const check = await runCli(projectDir, ['check', '--tier=fast', '--compact']);
    const report = ReportSchema.parse(parseJson(check.stdout));

    expect(init.exitCode).toBe(0);
    expect(baseline.createdAtCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(baseline.suppressed.length).toBeGreaterThan(0);
    expect(check.exitCode).toBe(0);
    expect(report.summary.status).toBe('ok');
    expect(report.baseline.applied).toBe(true);
    expect(report.baseline.suppressedFindings).toBeGreaterThan(0);
  });

  it('accepts and prunes baseline findings through the built CLI', async () => {
    const cleanSource = 'export const value = 1;\n';
    const projectDir = await createDemoCopy(cleanSource);
    await initGitRepo(projectDir);

    const init = await runCli(projectDir, ['baseline', 'init']);
    const initialBaseline = BaselineSnapshotSchema.parse(
      parseJson(await readFile(join(projectDir, '.sentiness/baseline.json'), 'utf8')),
    );
    const initialFingerprints = initialBaseline.suppressed.map((entry) => entry.fingerprint);
    await writeFile(join(projectDir, 'src/index.ts'), 'const unused = 1\n');

    const check = await runCli(projectDir, ['check', '--tier=fast', '--compact']);
    const report = ReportSchema.parse(parseJson(check.stdout));
    const fingerprint = report.checks[0]?.findings[0]?.fingerprint;

    expect(init.exitCode).toBe(0);
    expect(check.exitCode).toBe(1);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(initialFingerprints).not.toContain(fingerprint);

    const accept = await runCli(projectDir, [
      'baseline',
      'accept',
      `--fingerprint=${fingerprint ?? ''}`,
      '--reason=accepted for e2e coverage',
    ]);
    const acceptedBaseline = BaselineSnapshotSchema.parse(
      parseJson(await readFile(join(projectDir, '.sentiness/baseline.json'), 'utf8')),
    );
    const suppressed = ReportSchema.parse(
      parseJson((await runCli(projectDir, ['check', '--tier=fast', '--compact'])).stdout),
    );

    expect(accept.exitCode).toBe(0);
    expect(acceptedBaseline.suppressed).toHaveLength(initialBaseline.suppressed.length + 1);
    expect(acceptedBaseline.suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fingerprint,
          reason: 'accepted for e2e coverage',
        }),
      ]),
    );
    expect(
      suppressed.checks
        .flatMap((checkResult) => checkResult.findings)
        .map((finding) => finding.fingerprint),
    ).not.toContain(fingerprint);
    expect(suppressed.baseline.suppressedFindings).toBeGreaterThan(0);

    await writeFile(join(projectDir, 'src/index.ts'), cleanSource);
    const prune = await runCli(projectDir, ['baseline', 'prune']);
    const prunedBaseline = BaselineSnapshotSchema.parse(
      parseJson(await readFile(join(projectDir, '.sentiness/baseline.json'), 'utf8')),
    );

    expect(prune.exitCode).toBe(0);
    expect(prunedBaseline.suppressed.map((entry) => entry.fingerprint)).toEqual(
      initialFingerprints,
    );
  });

  it('ratchets metric baselines through baseline update', async () => {
    const projectDir = await createDemoCopy(
      'export const value = 1;\nexport const other = 2;\n',
      ['coverage'],
      { coverage: { tier: 'slow', thresholds: { lineCoverage: 0 } } },
    );
    await writeCoverageReport(projectDir, [1, 0]);
    await initGitRepo(projectDir);

    const init = await runCli(projectDir, ['baseline', 'init']);
    const initialBaseline = BaselineSnapshotSchema.parse(
      parseJson(await readFile(join(projectDir, '.sentiness/baseline.json'), 'utf8')),
    );

    await writeCoverageReport(projectDir, [1, 1]);
    const update = await runCli(projectDir, [
      'baseline',
      'update',
      '--metric=coverage.lineCoverage',
    ]);
    const updatedBaseline = BaselineSnapshotSchema.parse(
      parseJson(await readFile(join(projectDir, '.sentiness/baseline.json'), 'utf8')),
    );

    expect(init.exitCode).toBe(0);
    expect(initialBaseline.metrics['coverage.lineCoverage']).toEqual({
      value: 50,
      direction: 'higher-is-better',
    });
    expect(update.exitCode).toBe(0);
    expect(updatedBaseline.metrics['coverage.lineCoverage']).toEqual({
      value: 100,
      direction: 'higher-is-better',
    });
  });

  it('installs direct Git hooks in a target repository', async () => {
    const projectDir = await createDemoCopy('let value = 1;\nvalue = value + 1;\n');
    await initGitRepo(projectDir);

    const result = await runCli(projectDir, ['install-hooks', '--push']);
    const preCommit = await readFile(join(projectDir, '.git/hooks/pre-commit'), 'utf8');
    const prePush = await readFile(join(projectDir, '.git/hooks/pre-push'), 'utf8');

    expect(result.exitCode).toBe(0);
    expect(preCommit).toContain('# sentiness:start');
    expect(preCommit).toContain('npx sentiness check --tier=fast --trigger=pre-commit');
    expect(prePush).toContain('npx sentiness check --tier=slow --trigger=pre-push');
  });

  it('updates direct Git hooks idempotently without replacing unmanaged hooks twice', async () => {
    const projectDir = await createDemoCopy('export const value = 1;\n');
    await initGitRepo(projectDir);
    await writeFile(join(projectDir, '.git/hooks/pre-commit'), '#!/bin/sh\necho user hook\n');

    const first = await runCli(projectDir, ['install-hooks', '--push']);
    const firstPreCommit = await readFile(join(projectDir, '.git/hooks/pre-commit'), 'utf8');
    const firstPrePush = await readFile(join(projectDir, '.git/hooks/pre-push'), 'utf8');
    const backupAfterFirst = await readFile(join(projectDir, '.git/hooks/pre-commit.bak'), 'utf8');

    const second = await runCli(projectDir, ['install-hooks', '--push']);
    const secondPreCommit = await readFile(join(projectDir, '.git/hooks/pre-commit'), 'utf8');
    const secondPrePush = await readFile(join(projectDir, '.git/hooks/pre-push'), 'utf8');
    const backupAfterSecond = await readFile(join(projectDir, '.git/hooks/pre-commit.bak'), 'utf8');

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(backupAfterFirst).toContain('echo user hook');
    expect(backupAfterSecond).toBe(backupAfterFirst);
    expect(firstPreCommit.match(/# sentiness:start/g)).toHaveLength(1);
    expect(firstPrePush.match(/# sentiness:start/g)).toHaveLength(1);
    expect(secondPreCommit).toBe(firstPreCommit);
    expect(secondPrePush).toBe(firstPrePush);
  });

  it('fails hook installation outside a Git repository', async () => {
    const projectDir = await createEmptyProject();

    const result = await runCli(projectDir, ['install-hooks']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    await expect(readFile(join(projectDir, '.git/hooks/pre-commit'), 'utf8')).rejects.toThrow();
  });

  it('initializes a new project through the non-interactive wizard path', async () => {
    const projectDir = await createEmptyProject();

    const result = await runCli(projectDir, ['init', '--yes', '--checks=biome', '--no-baseline']);
    const config = JSON.parse(await readFile(join(projectDir, 'sentiness.config.json'), 'utf8'));
    const gitignore = await readFile(join(projectDir, '.gitignore'), 'utf8');

    expect(result.exitCode).toBe(0);
    expect(config.schemaVersion).toBe('2.0');
    expect(typeof config.engine).toBe('string');
    expect(config.checks).toEqual({ biome: { version: '*', tier: 'fast' } });
    expect(config.reporting.omitOk).toBe(true);
    expect(gitignore).toContain('.sentiness/jobs/');
    expect(gitignore).toContain('.sentiness/pending-feedback.json');

    // --yes without --install/--skill/--hooks must not install anything:
    // registering --no-* variants in cac silently defaults these flags to
    // true, which this assertion guards against (real regression).
    expect(config.agents).toBeUndefined();
    expect(existsSync(join(projectDir, '.claude'))).toBe(false);
    expect(existsSync(join(projectDir, '.git/hooks/pre-commit'))).toBe(false);
    const packageJson = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'));
    expect(Object.keys(packageJson.devDependencies)).not.toContain('knip');
  });

  it('installs agent instruction sections idempotently from the built CLI', async () => {
    const projectDir = await createDemoCopy('let value = 1;\nvalue = value + 1;\n');
    const first = InstallSkillResultSchema.parse(
      parseJson((await runCli(projectDir, ['install-skill', '--agent=all'])).stdout),
    );
    const second = InstallSkillResultSchema.parse(
      parseJson((await runCli(projectDir, ['install-skill', '--agent=all'])).stdout),
    );

    expect(first.results.map((result) => result.agent)).toEqual([
      'claude-code',
      'claude-code-skill',
      'codex',
      'codex-skill',
      'gemini',
    ]);
    expect(first.results.every((result) => result.changed)).toBe(true);
    expect(second.results.every((result) => !result.changed)).toBe(true);

    await expect(readFile(join(projectDir, 'CLAUDE.md'), 'utf8')).resolves.toContain(
      '<!-- sentiness:start -->',
    );
    await expect(readFile(join(projectDir, 'AGENTS.md'), 'utf8')).resolves.toContain(
      '<!-- generated by @sentiness/adapters',
    );
    await expect(
      readFile(join(projectDir, '.agents/skills/sentiness/SKILL.md'), 'utf8'),
    ).resolves.toContain('name: sentiness');
    await expect(readFile(join(projectDir, 'GEMINI.md'), 'utf8')).resolves.toContain(
      '<!-- sentiness:end -->',
    );
  });

  it('keeps the committed public report JSON schema useful', async () => {
    const schemaText = await readFile(
      join(repoRoot, 'packages/core/schema/report.schema.json'),
      'utf8',
    );
    const schema = z
      .object({
        type: z.literal('object'),
        required: z.array(z.string()),
        properties: z.record(z.string(), z.unknown()),
      })
      .parse(parseJson(schemaText));

    expect(schema.required).toContain('schemaVersion');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['schemaVersion', 'summary', 'checks', 'agentInstructions']),
    );
  });
});
