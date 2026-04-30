import { z } from 'zod';

export type NormalizedDependencyCruiserViolation = {
  readonly ruleId: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly from: string;
  readonly to?: string;
  readonly startLine?: number;
};

const RuleSchema = z
  .object({
    name: z.string().optional(),
    severity: z.string().optional(),
    comment: z.string().optional(),
  })
  .catchall(z.unknown());

const ViolationSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    rule: RuleSchema.optional(),
    name: z.string().optional(),
    severity: z.string().optional(),
    comment: z.string().optional(),
    line: z.number().optional(),
    lineNumber: z.number().optional(),
    fromLine: z.number().optional(),
    startLine: z.number().optional(),
  })
  .catchall(z.unknown());

const DependencySchema = z
  .object({
    module: z.string().optional(),
    resolved: z.string().optional(),
    line: z.number().optional(),
    lineNumber: z.number().optional(),
    fromLine: z.number().optional(),
    startLine: z.number().optional(),
    rules: z.array(RuleSchema).optional(),
    violations: z.array(ViolationSchema).optional(),
  })
  .catchall(z.unknown());

const ModuleSchema = z
  .object({
    source: z.string().optional(),
    dependencies: z.array(DependencySchema).optional(),
    rules: z.array(RuleSchema).optional(),
    violations: z.array(ViolationSchema).optional(),
  })
  .catchall(z.unknown());

const DependencyCruiserOutputSchema = z
  .object({
    summary: z
      .object({
        violations: z.array(ViolationSchema).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    modules: z.array(ModuleSchema).optional(),
  })
  .catchall(z.unknown());

function normalizeSeverity(value: string | undefined): 'error' | 'warning' | 'info' {
  if (value === 'error') {
    return 'error';
  }
  if (value === 'info') {
    return 'info';
  }
  return 'warning';
}

function firstLine(...values: readonly (number | undefined)[]): number | undefined {
  return values.find((value) => typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function fromSummaryViolation(
  violation: z.infer<typeof ViolationSchema>,
): NormalizedDependencyCruiserViolation | undefined {
  const from = violation.from;
  const ruleId = violation.rule?.name ?? violation.name;
  if (!from || !ruleId) {
    return undefined;
  }
  const to = violation.to;
  const message =
    violation.rule?.comment ??
    violation.comment ??
    `Dependency-cruiser rule "${ruleId}" failed${to ? ` for ${from} -> ${to}` : ` in ${from}`}`;
  const startLine = firstLine(
    violation.lineNumber,
    violation.fromLine,
    violation.startLine,
    violation.line,
  );
  return {
    ruleId,
    severity: normalizeSeverity(violation.rule?.severity ?? violation.severity),
    message,
    from,
    ...(to ? { to } : {}),
    ...(startLine ? { startLine } : {}),
  };
}

function fromRuleOnDependency(
  source: string,
  dependency: z.infer<typeof DependencySchema>,
  rule: z.infer<typeof RuleSchema>,
): NormalizedDependencyCruiserViolation | undefined {
  const ruleId = rule.name;
  if (!ruleId) {
    return undefined;
  }
  const to = dependency.resolved ?? dependency.module;
  const startLine = firstLine(
    dependency.lineNumber,
    dependency.fromLine,
    dependency.startLine,
    dependency.line,
  );
  return {
    ruleId,
    severity: normalizeSeverity(rule.severity),
    message:
      rule.comment ??
      `Dependency-cruiser rule "${ruleId}" failed${to ? ` for ${source} -> ${to}` : ` in ${source}`}`,
    from: source,
    ...(to ? { to } : {}),
    ...(startLine ? { startLine } : {}),
  };
}

function dedupe(
  violations: readonly NormalizedDependencyCruiserViolation[],
): NormalizedDependencyCruiserViolation[] {
  const seen = new Set<string>();
  const result: NormalizedDependencyCruiserViolation[] = [];
  for (const violation of violations) {
    const key = [
      violation.ruleId,
      violation.from,
      violation.to ?? '',
      violation.startLine?.toString() ?? '',
    ].join('\0');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(violation);
    }
  }
  return result;
}

export function normalizeDependencyCruiserOutput(
  output: unknown,
): readonly NormalizedDependencyCruiserViolation[] {
  const parsed = DependencyCruiserOutputSchema.parse(output);
  const violations: NormalizedDependencyCruiserViolation[] = [];

  for (const violation of parsed.summary?.violations ?? []) {
    const normalized = fromSummaryViolation(violation);
    if (normalized) {
      violations.push(normalized);
    }
  }

  for (const module of parsed.modules ?? []) {
    const source = module.source;
    if (!source) {
      continue;
    }
    for (const violation of module.violations ?? []) {
      const normalized = fromSummaryViolation({ ...violation, from: violation.from ?? source });
      if (normalized) {
        violations.push(normalized);
      }
    }
    for (const rule of module.rules ?? []) {
      if (!rule.name) {
        continue;
      }
      violations.push({
        ruleId: rule.name,
        severity: normalizeSeverity(rule.severity),
        message: rule.comment ?? `Dependency-cruiser rule "${rule.name}" failed in ${source}`,
        from: source,
      });
    }
    for (const dependency of module.dependencies ?? []) {
      for (const rule of dependency.rules ?? []) {
        const normalized = fromRuleOnDependency(source, dependency, rule);
        if (normalized) {
          violations.push(normalized);
        }
      }
      for (const violation of dependency.violations ?? []) {
        const normalized = fromSummaryViolation({
          ...violation,
          from: violation.from ?? source,
          to: violation.to ?? dependency.resolved ?? dependency.module,
          lineNumber: violation.lineNumber ?? dependency.lineNumber,
          fromLine: violation.fromLine ?? dependency.fromLine,
          startLine: violation.startLine ?? dependency.startLine,
          line: violation.line ?? dependency.line,
        });
        if (normalized) {
          violations.push(normalized);
        }
      }
    }
  }

  return dedupe(violations);
}
