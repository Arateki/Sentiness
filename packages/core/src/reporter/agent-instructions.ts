import { compareSeverity, type Finding } from '@sentiness/check-sdk';

export type AgentInstructions = {
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
): AgentInstructions {
  const sorted = [...findings].sort((left, right) => {
    const severity = compareSeverity(left.severity, right.severity);
    return severity !== 0 ? severity : left.location.file.localeCompare(right.location.file);
  });
  const mustFix = sorted
    .filter(
      (finding) =>
        finding.severity === 'error' || (warningsAreErrors && finding.severity === 'warning'),
    )
    .map(findingText);
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
