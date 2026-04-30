export type CheckId = string & { readonly __brand: 'CheckId' };
export type RuleId = string & { readonly __brand: 'RuleId' };

export type Tier = 'fast' | 'standard' | 'slow';

export type Category =
  | 'lint'
  | 'architecture'
  | 'test-quality'
  | 'coverage'
  | 'security'
  | 'duplication'
  | 'complexity'
  | 'platform';

export type Severity = 'error' | 'warning' | 'info';

export type Location = {
  readonly file: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly packageName?: string;
  readonly packageVersion?: string;
};

export type Suggestion = {
  readonly kind: 'refactor' | 'add-test' | 'upgrade' | 'remove' | 'rename' | 'other';
  readonly description: string;
  readonly command?: string;
};

export type Finding = {
  readonly id: string;
  readonly checkId: CheckId;
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly message: string;
  readonly location: Location;
  readonly snippet?: string;
  readonly suggestion?: Suggestion;
  readonly references?: readonly string[];
  readonly fingerprint: string;
  readonly introducedInDiff?: boolean;
};

export type CheckMetrics = {
  readonly [name: string]: number | string | boolean;
};

export type MetricDirection = 'higher-is-better' | 'lower-is-better';

export type MetricSpec = {
  readonly direction: MetricDirection;
  readonly description?: string;
};

export type CheckStatus = 'ok' | 'violations' | 'error' | 'skipped';

export type CheckResult = {
  readonly status: CheckStatus;
  readonly findings: readonly Finding[];
  readonly metrics?: CheckMetrics;
  readonly rawOutputPath?: string;
  /** Check packages may return 0 here; the core runner records the final duration. */
  readonly durationMs: number;
  readonly skipReason?: string;
  readonly errorMessage?: string;
};

export type DetectResult = {
  readonly available: boolean;
  readonly reason?: string;
  readonly version?: string;
};

export type Logger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export type FileStat = {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly mtimeMs: number;
};

export type FileSystem = {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  rm(
    path: string,
    options?: { readonly recursive?: boolean; readonly force?: boolean },
  ): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  readDir(path: string): Promise<readonly string[]>;
  stat(path: string): Promise<FileStat>;
  realpath(path: string): Promise<string>;
};

export type Clock = {
  now(): number;
  isoNow(): string;
};

export type GitCommitInfo = {
  readonly sha: string;
  readonly date: string;
  readonly author: string;
};

export type GitProvider = {
  isRepo(cwd: string): Promise<boolean>;
  currentBranch(cwd: string): Promise<string>;
  changedFiles(cwd: string, baseRef: string): Promise<readonly string[]>;
  fileContentAtRef(cwd: string, ref: string, path: string): Promise<string | null>;
  mergeBase(cwd: string, refA: string, refB: string): Promise<string>;
  showCommit(cwd: string, ref: string): Promise<GitCommitInfo>;
};

export type ExecFileOptions = {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

export type ExecFileResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly signal?: string;
};

export type ProcessRunner = {
  execFile(
    command: string,
    args: readonly string[],
    options?: ExecFileOptions,
  ): Promise<ExecFileResult>;
};

export type CheckContext<TConfig = Record<string, unknown>> = {
  readonly cwd: string;
  readonly tier: Tier;
  readonly trigger: string | null;
  readonly baseRef: string | null;
  readonly changedFiles: readonly string[];
  readonly diffOnly: boolean;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  readonly fs: FileSystem;
  readonly git?: GitProvider;
  readonly process: ProcessRunner;
  readonly checkConfig: TConfig;
};

export type Check<TConfig = Record<string, unknown>> = {
  readonly id: CheckId;
  readonly category: Category;
  readonly defaultTier: Tier;
  readonly metricSpecs?: Readonly<Record<string, MetricSpec>>;
  readonly configSchema?: { readonly parse: (input: unknown) => TConfig };
  detect(ctx: CheckContext<TConfig>): Promise<DetectResult>;
  run(ctx: CheckContext<TConfig>): Promise<CheckResult>;
  dispose?(): Promise<void>;
};

const severityRank: Readonly<Record<Severity, number>> = {
  error: 3,
  warning: 2,
  info: 1,
};

export function asCheckId(value: string): CheckId {
  return value as CheckId;
}

export function asRuleId(value: string): RuleId {
  return value as RuleId;
}

export function compareSeverity(left: Severity, right: Severity): number {
  return severityRank[right] - severityRank[left];
}

export function severityValue(severity: Severity): number {
  return severityRank[severity];
}
