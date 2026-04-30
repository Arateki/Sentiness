import { compareSeverity, type Finding } from '@sentiness/check-sdk';

export type ErroredCheck = {
  readonly id: string;
  readonly errorMessage?: string;
};

type AgentInstructions = {
  readonly blocking: boolean;
  readonly mustFix: readonly string[];
  readonly shouldFix: readonly string[];
  readonly informational: readonly string[];
};

function findingText(finding: Finding): string {
  const location = finding.location.startLine
    ? `${finding.location.file}:${finding.location.startLine}`
    : finding.location.file;
  return `[${finding.severity}] ${location} ${finding.message}`;
}

export function buildAgentInstructions(
  findings: readonly Finding[],
  warningsAreErrors: boolean,
  erroredChecks: readonly ErroredCheck[] = [],
): AgentInstructions {
  const sorted = [...findings].sort((left, right) => {
    const severity = compareSeverity(left.severity, right.severity);
    return severity !== 0 ? severity : left.location.file.localeCompare(right.location.file);
  });

  const checkErrorEntries = erroredChecks.map(
    (check) =>
      `[error] check '${check.id}' failed: ${check.errorMessage ?? 'tooling error — check the tool is installed and configured'}`,
  );

  const findingErrors = sorted
    .filter(
      (finding) =>
        finding.severity === 'error' || (warningsAreErrors && finding.severity === 'warning'),
    )
    .map(findingText);

  const mustFix = [...checkErrorEntries, ...findingErrors];
  const shouldFix = sorted
    .filter((finding) => finding.severity === 'warning' && !warningsAreErrors)
    .map(findingText);
  const informational = sorted.filter((finding) => finding.severity === 'info').map(findingText);

  return {
    blocking: mustFix.length > 0,
    mustFix,
    shouldFix,
    informational,
  };
}
