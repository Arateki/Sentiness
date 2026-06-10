import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeProcessRunner } from './process-runner.js';

const PRINT_PATH = ['-e', 'process.stdout.write(process.env.PATH ?? "")'] as const;

const cleanupPaths: string[] = [];

afterEach(async () => {
  const paths = cleanupPaths.splice(0);
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
});

async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sentiness-process-runner-'));
  cleanupPaths.push(dir);
  await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
  return dir;
}

describe('NodeProcessRunner', () => {
  it('prepends the cwd node_modules/.bin chain to the child PATH', async () => {
    const projectDir = await makeProjectDir();
    const runner = new NodeProcessRunner();

    const result = await runner.execFile(process.execPath, [...PRINT_PATH], { cwd: projectDir });

    expect(result.exitCode).toBe(0);
    const entries = result.stdout.split(delimiter);
    expect(entries[0]).toBe(join(projectDir, 'node_modules', '.bin'));
  });

  it('keeps the parent PATH after the local bin prefix', async () => {
    const projectDir = await makeProjectDir();
    const runner = new NodeProcessRunner();

    const result = await runner.execFile(process.execPath, [...PRINT_PATH], { cwd: projectDir });

    const parentEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
    const childEntries = result.stdout.split(delimiter);
    for (const entry of parentEntries) {
      expect(childEntries).toContain(entry);
    }
  });

  it('applies caller-provided env on top of the inherited one', async () => {
    const projectDir = await makeProjectDir();
    const runner = new NodeProcessRunner();

    const result = await runner.execFile(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.SENTINESS_TEST + ":" + process.env.PATH)'],
      { cwd: projectDir, env: { SENTINESS_TEST: 'yes' } },
    );

    expect(result.stdout.startsWith('yes:')).toBe(true);
    expect(result.stdout).toContain(join(projectDir, 'node_modules', '.bin'));
  });

  it('runs without a cwd and reports non-zero exit codes', async () => {
    const runner = new NodeProcessRunner();

    const failure = await runner.execFile(process.execPath, ['-e', 'process.exit(3)']);

    expect(failure.exitCode).toBe(3);
  });

  it('surfaces spawn failures as non-zero exit with a message', async () => {
    const runner = new NodeProcessRunner();

    const result = await runner.execFile('definitely-not-a-real-binary-sentiness', []);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
