import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSkill, TEMPLATE_VERSION } from './index.js';
import { renderTemplate } from './render.js';
import type { RenderOptions } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const repoRoot = join(packageRoot, '..', '..');
const templateRelativePath = 'packages/adapters/src/skill-template.md';
const indexRelativePath = 'packages/adapters/src/render.ts';

const options: RenderOptions = {
  sentinessVersion: '0.1.0',
  configPath: 'sentiness.config.json',
  baselinePath: '.sentiness/baseline.json',
  pendingPath: '.sentiness/pending-feedback.json',
};

function readHeadFile(path: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_error) {
    return null;
  }
}

describe('renderSkill', () => {
  it('renders the shared skill template snapshot', () => {
    const expected = readFileSync(join(here, 'rendered-skill.snapshot.md'), 'utf8');
    expect(renderSkill(options)).toBe(expected);
  });

  it('fails when the template contains an unknown placeholder', () => {
    expect(() => renderTemplate('Hello {{unknownValue}}', options)).toThrow(
      'Unknown skill template placeholder: {{unknownValue}}',
    );
  });

  it('contains all required sections in order', () => {
    const rendered = renderSkill(options);
    const headings = [
      '### 1. What Sentiness Is',
      '### 2. When To Run',
      '### 3. How To Interpret The JSON',
      '### 4. Pending Feedback Discipline',
      '### 5. Hard Rules',
      '### 6. Background Polling Protocol',
      '### 7. Adding Dependencies',
    ];

    let previousIndex = -1;
    for (const heading of headings) {
      const currentIndex = rendered.indexOf(heading);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it('requires a template version bump when an existing template changes', () => {
    const previousTemplate = readHeadFile(templateRelativePath);
    const previousRender = readHeadFile(indexRelativePath);
    if (previousTemplate === null || previousRender === null) {
      return;
    }

    const currentTemplate = readFileSync(join(here, 'skill-template.md'), 'utf8');
    if (currentTemplate === previousTemplate) {
      return;
    }

    expect(previousRender).not.toContain(`TEMPLATE_VERSION = '${TEMPLATE_VERSION}'`);
  });
});
