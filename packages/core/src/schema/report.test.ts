import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Report, ReportSchema } from './report.js';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error('JSON schema must be an object');
  }
  return value;
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'null':
      return value === null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isRecord(value);
    case 'string':
      return typeof value === 'string';
    default:
      return false;
  }
}

function validationErrors(schema: JsonRecord, value: unknown, path: string): readonly string[] {
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const matches = anyOf.some(
      (candidate) => isRecord(candidate) && validationErrors(candidate, value, path).length === 0,
    );
    return matches ? [] : [`${path}: did not match any JSON Schema anyOf branch`];
  }

  const errors: string[] = [];
  const type = schema.type;
  if (typeof type === 'string' && !typeMatches(type, value)) {
    return [`${path}: expected ${type}`];
  }

  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: expected const ${String(schema.const)}`);
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.includes(value)) {
    errors.push(`${path}: expected one of ${enumValues.join(', ')}`);
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: expected >= ${schema.minimum}`);
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push(`${path}: expected > ${schema.exclusiveMinimum}`);
    }
  }

  if (typeof value === 'string' && typeof schema.pattern === 'string') {
    const pattern = new RegExp(schema.pattern);
    if (!pattern.test(value)) {
      errors.push(`${path}: did not match pattern ${schema.pattern}`);
    }
  }

  if (Array.isArray(value) && isRecord(schema.items)) {
    for (const [index, item] of value.entries()) {
      errors.push(...validationErrors(schema.items, item, `${path}[${index}]`));
    }
  }

  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((field): field is string => typeof field === 'string')
      : [];

    for (const field of required) {
      if (!(field in value)) {
        errors.push(`${path}.${field}: required`);
      }
    }

    for (const [key, entryValue] of Object.entries(value)) {
      if (isRecord(schema.propertyNames)) {
        errors.push(...validationErrors(schema.propertyNames, key, `${path}.${key}<name>`));
      }

      const propertySchema = properties[key];
      if (isRecord(propertySchema)) {
        errors.push(...validationErrors(propertySchema, entryValue, `${path}.${key}`));
        continue;
      }

      if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: unexpected property`);
      } else if (isRecord(schema.additionalProperties)) {
        errors.push(...validationErrors(schema.additionalProperties, entryValue, `${path}.${key}`));
      }
    }
  }

  return errors;
}

function reportJsonSchema(): JsonRecord {
  return schemaRecord(
    JSON.parse(readFileSync(new URL('../../schema/report.schema.json', import.meta.url), 'utf8')),
  );
}

function representativeReport(): Report {
  return ReportSchema.parse({
    schemaVersion: '1.0',
    sentinessVersion: '0.1.0',
    runId: 'run-1',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:01.000Z',
    durationMs: 1000,
    context: {
      cwd: '/project',
      tier: 'fast',
      trigger: null,
      mode: 'diff',
      baseRef: 'main',
      headRef: 'HEAD',
      changedFiles: ['src/index.ts'],
      addedDependencies: ['left-pad'],
      removedDependencies: [],
    },
    summary: {
      status: 'violations',
      totals: { error: 1, warning: 0, info: 0 },
      newInDiff: { error: 1, warning: 0, info: 0 },
      blocking: true,
      topIssues: ['[error] src/index.ts Fix this'],
      checksRun: 1,
      checksSkipped: 0,
      checksErrored: 0,
    },
    checks: [
      {
        id: 'fake',
        category: 'lint',
        status: 'violations',
        durationMs: 12,
        metrics: { score: 90, tool: 'fake', passed: false },
        findings: [
          {
            id: 'fake:error',
            checkId: 'fake',
            ruleId: 'rule',
            severity: 'error',
            message: 'Fix this',
            location: { file: 'src/index.ts', startLine: 1, startColumn: 1 },
            snippet: 'const value = 1;',
            suggestion: { kind: 'refactor', description: 'Change the code' },
            references: ['https://example.test/rule'],
            fingerprint: 'a'.repeat(64),
            introducedInDiff: true,
          },
        ],
        truncated: { total: 60, shown: 50 },
      },
    ],
    trend: {
      available: true,
      regressions: [
        {
          metric: 'fake.score',
          baselineValue: 100,
          currentValue: 90,
          direction: 'higher-is-better',
        },
      ],
    },
    baseline: {
      applied: true,
      path: '.sentiness/baseline.json',
      suppressedFindings: 2,
    },
    agentInstructions: {
      blocking: true,
      mustFix: ['[error] src/index.ts Fix this'],
      shouldFix: [],
      informational: [],
    },
  });
}

describe('report JSON schema artifact', () => {
  it('validates a representative report through the committed schema artifact', () => {
    expect(validationErrors(reportJsonSchema(), representativeReport(), '$')).toEqual([]);
  });

  it('rejects reports missing required fields', () => {
    const report = representativeReport();
    const { schemaVersion: _schemaVersion, ...missingSchemaVersion } = report;

    expect(validationErrors(reportJsonSchema(), missingSchemaVersion, '$')).toContain(
      '$.schemaVersion: required',
    );
  });

  it('rejects invalid schema version and finding fingerprints', () => {
    const report = representativeReport();
    const invalidReport = {
      ...report,
      schemaVersion: '2.0',
      checks: [
        {
          ...report.checks[0],
          findings: [{ ...report.checks[0]?.findings[0], fingerprint: 'not-a-fingerprint' }],
        },
      ],
    };

    const errors = validationErrors(reportJsonSchema(), invalidReport, '$');

    expect(errors).toContain('$.schemaVersion: expected const 1.0');
    expect(errors).toContain(
      '$.checks[0].findings[0].fingerprint: did not match pattern ^[a-f0-9]{64}$',
    );
  });
});
