import { z } from 'zod';

export type OsvLockfile = {
  readonly path: string;
  readonly packageManager: 'npm' | 'pnpm' | 'yarn';
};

export type NormalizedOsvVulnerability = {
  readonly id: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly packageName: string;
  readonly packageVersion?: string;
  readonly fixedVersion?: string;
  readonly references: readonly string[];
};

const OsvSeveritySchema = z
  .object({
    type: z.string().optional(),
    score: z.union([z.string(), z.number()]).optional(),
  })
  .catchall(z.unknown());

const OsvAffectedEventSchema = z
  .object({
    fixed: z.string().optional(),
  })
  .catchall(z.unknown());

const OsvAffectedSchema = z
  .object({
    ranges: z
      .array(
        z
          .object({
            events: z.array(OsvAffectedEventSchema).optional(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
  })
  .catchall(z.unknown());

const OsvReferenceSchema = z
  .object({
    url: z.string().optional(),
  })
  .catchall(z.unknown());

const OsvVulnerabilitySchema = z
  .object({
    id: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    summary: z.string().optional(),
    details: z.string().optional(),
    severity: z.array(OsvSeveritySchema).optional(),
    affected: z.array(OsvAffectedSchema).optional(),
    references: z.array(OsvReferenceSchema).optional(),
    database_specific: z
      .object({
        severity: z.string().optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown());

const OsvPackageSchema = z
  .object({
    package: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
      })
      .catchall(z.unknown())
      .optional(),
    vulnerabilities: z.array(OsvVulnerabilitySchema).optional(),
  })
  .catchall(z.unknown());

const OsvResultSchema = z
  .object({
    packages: z.array(OsvPackageSchema).optional(),
  })
  .catchall(z.unknown());

const OsvOutputSchema = z
  .object({
    results: z.array(OsvResultSchema).optional(),
  })
  .catchall(z.unknown());

function severityFromLabel(value: string | undefined): 'error' | 'warning' | 'info' | undefined {
  const normalized = value?.toLowerCase();
  if (normalized === 'critical' || normalized === 'high') {
    return 'error';
  }
  if (normalized === 'medium' || normalized === 'moderate') {
    return 'warning';
  }
  if (normalized === 'low') {
    return 'info';
  }
  return undefined;
}

function severityFromScore(
  value: string | number | undefined,
): 'error' | 'warning' | 'info' | undefined {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  if (numeric >= 7) {
    return 'error';
  }
  if (numeric >= 4) {
    return 'warning';
  }
  return 'info';
}

function vulnerabilitySeverity(
  vulnerability: z.infer<typeof OsvVulnerabilitySchema>,
): 'error' | 'warning' | 'info' {
  return (
    severityFromLabel(vulnerability.database_specific?.severity) ??
    vulnerability.severity?.map((entry) => severityFromScore(entry.score)).find(Boolean) ??
    'warning'
  );
}

function fixedVersion(vulnerability: z.infer<typeof OsvVulnerabilitySchema>): string | undefined {
  for (const affected of vulnerability.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) {
          return event.fixed;
        }
      }
    }
  }
  return undefined;
}

function references(
  vulnerability: z.infer<typeof OsvVulnerabilitySchema>,
  id: string,
): readonly string[] {
  return [
    `https://osv.dev/${id}`,
    ...(vulnerability.references ?? []).flatMap((reference) =>
      reference.url ? [reference.url] : [],
    ),
  ];
}

export function normalizeOsvOutput(output: unknown): readonly NormalizedOsvVulnerability[] {
  const parsed = OsvOutputSchema.parse(output);
  const findings: NormalizedOsvVulnerability[] = [];
  for (const result of parsed.results ?? []) {
    for (const packageEntry of result.packages ?? []) {
      const packageName = packageEntry.package?.name;
      if (!packageName) {
        continue;
      }
      const packageVersion = packageEntry.package?.version;
      for (const vulnerability of packageEntry.vulnerabilities ?? []) {
        const id = vulnerability.id ?? vulnerability.aliases?.[0];
        if (!id) {
          continue;
        }
        const fixed = fixedVersion(vulnerability);
        findings.push({
          id,
          severity: vulnerabilitySeverity(vulnerability),
          message:
            vulnerability.summary ??
            vulnerability.details ??
            `Vulnerability ${id} in ${packageName}`,
          packageName,
          ...(packageVersion ? { packageVersion } : {}),
          ...(fixed ? { fixedVersion: fixed } : {}),
          references: references(vulnerability, id),
        });
      }
    }
  }
  return findings;
}
