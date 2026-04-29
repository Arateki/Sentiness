import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JobMetaSchema } from '../../src/jobs/types.js';
import { ReportSchema } from '../../src/schema/report.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const demoProject = join(repoRoot, 'examples/demo-project');
const cliPath = join(repoRoot, 'packages/core/dist/cli/index.js');
const rootBinPath = join(repoRoot, 'node_modules/.bin');
const biomeCheckPackage = join(repoRoot, 'packages/checks/biome');

type CliResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const JobIdSchema = z.object({ jobId: z.string().min(1) });
const InstallSkillResultSchema = z.object({
  results: z.array(
    z.object({
      agent: z.enum(['claude-code', 'codex', 'gemini']),
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

async function runCli(cwd: string, args: readonly string[]): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
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
  });
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout.trim());
}

async function createDemoCopy(source: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'sentiness-e2e-'));
  cleanupPaths.push(tempRoot);
  const projectDir = join(tempRoot, 'demo-project');
  await cp(demoProject, projectDir, { recursive: true });
  await writeFile(join(projectDir, 'src/index.ts'), source);

  const sentinessScope = join(projectDir, 'node_modules/@sentiness');
  await mkdir(sentinessScope, { recursive: true });
  await symlink(biomeCheckPackage, join(sentinessScope, 'check-biome'), 'dir');

  return projectDir;
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
  });

  it('installs agent instruction sections idempotently from the built CLI', async () => {
    const projectDir = await createDemoCopy('let value = 1;\nvalue = value + 1;\n');
    const first = InstallSkillResultSchema.parse(
      parseJson((await runCli(projectDir, ['install-skill', '--agent=all'])).stdout),
    );
    const second = InstallSkillResultSchema.parse(
      parseJson((await runCli(projectDir, ['install-skill', '--agent=all'])).stdout),
    );

    expect(first.results.map((result) => result.agent)).toEqual(['claude-code', 'codex', 'gemini']);
    expect(first.results.every((result) => result.changed)).toBe(true);
    expect(second.results.every((result) => !result.changed)).toBe(true);

    await expect(readFile(join(projectDir, 'CLAUDE.md'), 'utf8')).resolves.toContain(
      '<!-- sentiness:start -->',
    );
    await expect(readFile(join(projectDir, 'AGENTS.md'), 'utf8')).resolves.toContain(
      '<!-- generated by @sentiness/adapters',
    );
    await expect(readFile(join(projectDir, 'GEMINI.md'), 'utf8')).resolves.toContain(
      '<!-- sentiness:end -->',
    );
  });
});
