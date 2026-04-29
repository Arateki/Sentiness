# Auditoria pós-Fase 5

Data: 2026-04-28
Revisor: Claude (Opus 4.7)
Escopo: todo o código produzido pelas fases 0–5 do `CLAUDE.md`, comparado contra a especificação.

Status das verificações automáticas no momento da auditoria:

- `pnpm typecheck`: passa em todos os pacotes.
- `pnpm test`: 94 testes passam (0 falhas).
- `pnpm lint`: **falha** por causa de lixo deixado por teste (ver §5.1).
- `pnpm sentiness check --tier=fast`: roda e produz relatório válido.

A vertical slice está funcional, mas há sete bugs lógicos que vão produzir comportamento incorreto em uso real, várias violações diretas das "Non-negotiable rules" da §3 do `CLAUDE.md`, e gaps relevantes contra a spec. Este documento descreve cada um em detalhe e propõe correção.

Convenções deste documento:

- Cada problema tem ID estável (`AUD-<seção>.<número>`) para referência cruzada em commits/PRs.
- Severidade: **Crítico** (bug lógico que produz resultado errado), **Sério** (viola regra inegociável ou degrada robustez), **Médio** (UX ou correção parcial), **Menor** (cheiro de design).
- Cada item lista: causa raiz, sintoma observável, fix proposto, e se houver, dependências entre fixes.

---

## Sumário executivo

| Severidade | Quantidade | Resumo |
|---|---|---|
| Crítico | 7 | CLI falha em casos de uso documentados pela spec; metric regressions inexistem na prática; truncação descarta errors em vez de infos |
| Sério | 4 | Violações diretas das regras inegociáveis (`as` casts cegos, catches mudos, `console.log`, `Date` global) |
| Médio | 5 | Gaps com a spec em `install-hooks`, `doctor`, `init`, `stryker`, baseline atômico |
| Menor | 14 | Cheiros de design, fragilidades, hardcodes que vão divergir |

Recomendação: **fechar os 7 críticos e os 4 sérios antes de começar a Fase 6 (adapters)**. Os médios e menores podem ser limpados em paralelo ou deixados como follow-ups documentados.

---

## 1. Bugs críticos

### AUD-1.1 — `sentiness check --trigger=<name>` está quebrado por construção

- **Severidade:** Crítico
- **Localização:** `packages/core/src/cli/commands/check.ts:38`

**Código atual:**

```ts
const tier = parseTier(args.tier) ?? 'standard'; // Default to standard if spawning background
```

`tier` recebe sempre um valor (default `'standard'`) e nunca volta a ser `undefined`. Em seguida, na chamada do runner (linha 96-101):

```ts
{
  ...(tier ? { tier } : {}),
  ...(trigger ? { trigger } : {}),
  diffOnly,
  ...(baseRef ? { baseRef } : {}),
}
```

O ternário `tier ? { tier } : {}` é redundante porque `tier` nunca é falsy.

**Causa raiz:** o autor do CLI confundiu "default para o caminho de background" com "default para qualquer caminho". O comentário na linha 38 ("Default to standard if spawning background") sugere que o default só seria usado para o spawner — mas é aplicado em todos os caminhos.

**Sintoma:** quando o usuário roda `sentiness check --trigger=post-edit`:

1. `parseTier(args.tier)` retorna `undefined` (não foi passado `--tier`)
2. `?? 'standard'` força `tier='standard'`
3. O runner recebe `{ tier: 'standard', trigger: 'post-edit' }`
4. `resolveTier` (em `runner.ts:74`) detecta que `'post-edit'` pertence a `'fast'` mas `tier='standard'`, e lança:
   ```
   Trigger "post-edit" belongs to "fast", not "standard"
   ```

A spec é explícita em T1.3: *"If only `trigger` is provided, resolve its tier from config."* Toda invocação por trigger sozinho falha hoje.

**Fix proposto:**

```ts
const tier = parseTier(args.tier);
```

Remover o `?? 'standard'`. O runner já tem o fallback correto em `resolveTier:82` (`return tierFromTrigger ?? 'standard'`). O ternário `tier ? { tier } : {}` na chamada do runner passa a ter sentido.

Para o caso de background (que precisa de algum tier para preencher `JobMeta.tier`), resolver localmente apenas para esse fim:

```ts
const explicitTier = parseTier(args.tier);
const triggerTier = trigger ? triggerTier(config, trigger) : undefined;
const effectiveTier = explicitTier ?? triggerTier ?? 'standard';
```

E usar `effectiveTier` apenas no `JobSpawner.spawn` (que precisa de `Tier`), passando `explicitTier` (potencialmente `undefined`) para `runChecks`.

---

### AUD-1.2 — Background mode entrega o jobId errado ao child

- **Severidade:** Crítico
- **Localização:** `packages/core/src/cli/commands/check.ts:43-69`

São três bugs encadeados que tornam o caminho `--background` não-funcional em produção.

**1.2.a — Path do CLI quebra em build:**

```ts
const cliPath = fileURLToPath(import.meta.url).replace(
  /\/src\/cli\/commands\/check\.ts$/,
  '/dist/cli/index.js',
);
```

Em produção, `import.meta.url` aponta para `/path/to/dist/cli/commands/check.js`. O regex `/\/src\/cli\/commands\/check\.ts$/` nunca casa, `replace` retorna a string original, e o spawner tenta executar `node dist/cli/commands/check.js`, que é apenas o módulo do comando — não o entry point com o `cac` registrando comandos.

**1.2.b — Placeholders `<jobId>` chegam literais ao child:**

```ts
const jobMeta = await spawner.spawn(
  process.execPath,
  [
    cliPath,
    ...originalArgs,
    `--output=${join(jobsDir, '<jobId>', 'result.json')}`,
    '--job-id=<jobId>',
  ],
  { cwd: deps.cwd, tier },
);

// Patch the <jobId> placeholders in args
const actualArgs = jobMeta.args.map((arg) => arg.replace('<jobId>', jobMeta.jobId));
const updatedMeta = { ...jobMeta, args: actualArgs };
await deps.fs.writeFile(
  join(jobMeta.jobDir, 'meta.json'),
  `${JSON.stringify(updatedMeta, null, 2)}\n`,
);
```

O `replace` é aplicado **depois** do `spawn`. O processo filho já recebeu argv com `--job-id=<jobId>` literal. Reescrever `meta.json` em seguida não muta o argv do processo já vivo.

**1.2.c — Child não consegue se reconhecer:**

Como consequência de (b), o child:

1. Lê `args['job-id']` e obtém a string literal `'<jobId>'`
2. Vai para `core/src/cli/commands/check.ts:130` e procura `meta.json` em `.sentiness/jobs/<jobId>/meta.json` — caminho com placeholder, não existe
3. Pula a atualização de status (`if (await deps.fs.exists(jobMetaPath))` é `false`)
4. Pula o enqueue da pending queue
5. **Resultado: o job termina sem nunca atualizar `meta.json` nem alimentar a fila de pending feedback**

A fase C (background jobs) está implementada no nível das classes (`JobSpawner`, `JobReader`, `PendingQueue`), mas **nunca produziu um round-trip funcional** de ponta a ponta.

**Causa raiz:** geração de `jobId` está dentro do `JobSpawner.spawn`, que recebe `args` como argumento. Não há como substituir o placeholder antes do spawn sem inverter o controle.

**Fix proposto:**

Inverter o fluxo para gerar o `jobId` antes do spawn:

```ts
// 1. Gerar jobId no caller, não no JobSpawner
const jobId = randomUUID();

// 2. Substituir placeholders antes de spawn
const args = [
  cliPath,
  ...originalArgs,
  `--output=${join(jobsDir, jobId, 'result.json')}`,
  `--job-id=${jobId}`,
];

// 3. JobSpawner aceita jobId via SpawnOptions
const meta = await spawner.spawn(process.execPath, args, {
  cwd: deps.cwd,
  tier,
  jobId,  // novo campo
});
```

E em `JobSpawner.spawn`, usar o `options.jobId` em vez de `randomUUID()` interno (manter o `randomUUID()` como fallback se `options.jobId` for `undefined` para preservar a API atual em outros chamadores).

Para o `cliPath`, usar `import.meta.resolve('@sentiness/core/cli')` (Node 20+ suporta) ou navegar relativo ao `dirname(fileURLToPath(import.meta.url))` somando `'../../index.js'` — o que funciona tanto em `src/` quanto em `dist/`.

**Dependência de fix:** independente de AUD-1.1.

---

### AUD-1.3 — Métricas de baseline nunca disparam regressão

- **Severidade:** Crítico
- **Localização:** `packages/core/src/baseline/diff-filter.ts:100-125`

**Código atual:**

```ts
export function applyBaselineToOutcome(
  outcome: RunOutcome,
  baseline: BaselineSnapshot | undefined,
  options: { readonly baselinePath: string | null; readonly diffOnly: boolean },
): BaselineApplication {
  const results = new Map(outcome.results);
  let suppressedCount = 0;
  for (const [checkId, result] of outcome.results) {
    const filtered = applyBaseline(...);
    suppressedCount += filtered.suppressedCount;
    results.set(checkId, resultWithFindings(result, filtered.findings));
  }

  return {
    outcome: { ...outcome, results, checkMetadata: outcome.checkMetadata },
    baselineApplied: baseline !== undefined,
    baselinePath: options.baselinePath,
    suppressedCount,
    metricRegressions: [],   // ← hardcoded vazio
  };
}
```

A função `compareMetrics` (linha 64-88 do mesmo arquivo) está implementada, testada e correta. **Mas nunca é chamada no fluxo do CLI.** O `check.ts` recebe `application.metricRegressions = []` e passa direto para `buildReport`.

**Sintoma:**

- `report.trend.available` é sempre `false` quando há baseline (porque nunca há regressões para ativar `true`).
- Regressões em `mutationScore`, `lineCoverage`, ou qualquer métrica futura **nunca aparecem no JSON do report**.
- A "Trend mode" da spec é, na prática, vapor.

**Causa raiz:** durante a implementação do diff filter, `compareMetrics` foi escrito como função pura testável, mas a integração com `applyBaselineToOutcome` foi esquecida.

**Fix proposto:**

```ts
function collectCurrentMetrics(outcome: RunOutcome): CheckMetrics {
  const merged: Record<string, number | string | boolean> = {};
  for (const [checkId, result] of outcome.results) {
    for (const [name, value] of Object.entries(result.metrics ?? {})) {
      merged[`${checkId}.${name}`] = value;
    }
  }
  return merged;
}

export function applyBaselineToOutcome(
  outcome: RunOutcome,
  baseline: BaselineSnapshot | undefined,
  options: { readonly baselinePath: string | null; readonly diffOnly: boolean },
): BaselineApplication {
  // ... (lógica existente para findings)

  const currentMetrics = collectCurrentMetrics(outcome);
  const metricRegressions = baseline
    ? compareMetrics(currentMetrics, baseline.metrics)
    : [];

  return {
    outcome: { ... },
    baselineApplied: baseline !== undefined,
    baselinePath: options.baselinePath,
    suppressedCount,
    metricRegressions,
  };
}
```

**Dependência de fix:** AUD-1.4 (direction de métricas) deve ser resolvido junto, senão metric regressions ficam invertidas para métricas `lower-is-better`.

---

### AUD-1.4 — Direction de métricas hardcoded como `higher-is-better`

- **Severidade:** Crítico
- **Localização:**
  - `packages/core/src/baseline/baseline.ts:50` (em `collectMetrics`)
  - `packages/core/src/cli/commands/baseline.ts:120` (em `baselineUpdateCommand`)

**Código atual (`baseline.ts:50`):**

```ts
function collectMetrics(outcome: RunOutcome): Readonly<Record<string, MetricBaseline>> {
  const metrics: Record<string, MetricBaseline> = {};
  for (const [checkId, result] of outcome.results) {
    for (const [name, value] of Object.entries(result.metrics ?? ({} satisfies CheckMetrics))) {
      if (typeof value === 'number') {
        metrics[`${checkId}.${name}`] = { value, direction: 'higher-is-better' };
      }
    }
  }
  return metrics;
}
```

A spec define `MetricBaseline.direction: 'higher-is-better' | 'lower-is-better'` e `compareMetrics` respeita os dois sentidos corretamente. Mas no momento de **criar** o baseline, todas as métricas são tagueadas como `higher-is-better`, sem que o check tenha como declarar a semântica de cada uma das suas métricas.

**Sintoma:**

- `mutationScore` (Stryker): higher-is-better é correto. OK por sorte.
- `lineCoverage` (Coverage): higher-is-better é correto. OK por sorte.
- Qualquer métrica futura que seja `lower-is-better` (`duplicated-lines` do jscpd, `surviving-mutants` do Stryker, `cyclomatic-complexity`, `bundle-size-kb`, `unused-exports-count`) vai ser tagueada errada. **Quando o código melhorar, o baseline vai detectar regressão.**

**Causa raiz:** o tipo `CheckMetrics` no SDK (`check-sdk/src/types.ts:47`) é apenas `Record<string, number | string | boolean>`. Não há canal para o check declarar a direção de cada métrica que emite.

**Fix proposto (estrutural):**

Adicionar ao SDK um `MetricSpec` opcional no `Check`:

```ts
// check-sdk/src/types.ts
export type MetricDirection = 'higher-is-better' | 'lower-is-better';

export type MetricSpec = {
  readonly direction: MetricDirection;
  readonly description?: string;
};

export type Check = {
  readonly id: CheckId;
  readonly category: Category;
  readonly defaultTier: Tier;
  readonly metricSpecs?: Readonly<Record<string, MetricSpec>>;
  detect(ctx: CheckContext): Promise<DetectResult>;
  run(ctx: CheckContext): Promise<CheckResult>;
  dispose?(): Promise<void>;
};
```

Cada check declara as métricas que emite com sua direção:

```ts
// checks/coverage/src/coverage.ts
export const coverageCheck: Check = {
  id: checkId,
  category: 'coverage',
  defaultTier: 'slow',
  metricSpecs: {
    lineCoverage: { direction: 'higher-is-better', description: 'Global line coverage %' },
  },
  // ...
};
```

`collectMetrics` passa a aceitar o registry para olhar `metricSpecs`:

```ts
function collectMetrics(
  outcome: RunOutcome,
  registry: CheckRegistry,
): Readonly<Record<string, MetricBaseline>> {
  const metrics: Record<string, MetricBaseline> = {};
  for (const [checkId, result] of outcome.results) {
    const check = registry.get(checkId);
    const specs = check?.metricSpecs ?? {};
    for (const [name, value] of Object.entries(result.metrics ?? {})) {
      if (typeof value === 'number') {
        const direction = specs[name]?.direction ?? 'higher-is-better';
        metrics[`${checkId}.${name}`] = { value, direction };
      }
    }
  }
  return metrics;
}
```

Este fix toca o SDK, então é melhor fazer agora, antes da Fase 8 (que adiciona mais 6 check packages que precisarão declarar métricas).

**Dependência:** habilita AUD-1.3.

---

### AUD-1.5 — Truncação ignora ordem de severidade

- **Severidade:** Crítico
- **Localização:** `packages/core/src/reporter/reporter.ts:47-61`

**Código atual:**

```ts
function truncateFindings(
  findings: readonly Finding[],
  maxFindings: number,
): {
  readonly findings: readonly Finding[];
  readonly truncated?: { readonly total: number; readonly shown: number };
} {
  if (findings.length <= maxFindings) {
    return { findings };
  }
  return {
    findings: findings.slice(0, maxFindings),
    truncated: { total: findings.length, shown: maxFindings },
  };
}
```

A spec T1.4 é literal: *"if a check has more than `maxFindingsPerCheck` findings, **keep top N by severity**, add `truncated: { total, shown }` field."*

**Sintoma:**

- `slice(0, N)` mantém a ordem que o check produziu.
- `checks/knip/src/normalize.ts` produz issues nesta ordem: `unused-files` (warning), `dependencies` (error), `devDependencies` (error), `unlisted` (error), ..., `exports` (warning), `types` (warning), etc. (linha 112-178)
- Em um projeto com 60 unused files (warning) + 5 unused dependencies (error), com `maxFindingsPerCheck=50`, o report mostra **apenas warnings e descarta os 5 errors silenciosamente.**
- O agente recebe um relatório com `summary.totals.error: 0` e nada para corrigir, mesmo que haja errors reais.

**Causa raiz:** o autor não leu/lembrou da exigência "top N by severity" da spec.

**Fix proposto:**

```ts
import { compareSeverity } from '@sentiness/check-sdk';

function truncateFindings(
  findings: readonly Finding[],
  maxFindings: number,
): {
  readonly findings: readonly Finding[];
  readonly truncated?: { readonly total: number; readonly shown: number };
} {
  if (findings.length <= maxFindings) {
    return { findings };
  }
  const sorted = [...findings].sort((left, right) => {
    const severity = compareSeverity(left.severity, right.severity);
    if (severity !== 0) return severity;
    return left.location.file.localeCompare(right.location.file);
  });
  return {
    findings: sorted.slice(0, maxFindings),
    truncated: { total: findings.length, shown: maxFindings },
  };
}
```

`compareSeverity` já está exportado pelo SDK e é usado em `agent-instructions.ts:22`.

---

### AUD-1.6 — Validação do baseline carregado é cosmética

- **Severidade:** Crítico
- **Localização:** `packages/core/src/baseline/baseline.ts:82-98`

**Código atual:**

```ts
static async load(path: string, fs: FileSystem): Promise<BaselineSnapshot | undefined> {
  if (!(await fs.exists(path))) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path));
    if (typeof parsed !== 'object' || parsed === null || !('schemaVersion' in parsed)) {
      throw new BaselineParseError(`Malformed baseline file: ${path}`);
    }
    return parsed as BaselineSnapshot;
  } catch (error) {
    if (error instanceof BaselineParseError) {
      throw error;
    }
    throw new BaselineParseError(`Failed to parse baseline file: ${path}`, { cause: error });
  }
}
```

A validação só checa se há `schemaVersion`. Um arquivo `{"schemaVersion":"1.0", "suppressed": "oops"}` passa. Em seguida, `applyBaseline` (linha 27 de `diff-filter.ts`) faz:

```ts
return new Set((baseline?.suppressed ?? []).map((entry) => entry.fingerprint));
```

`'oops'.map` lança `TypeError: baseline.suppressed.map is not a function` em runtime, sem contexto útil para o usuário.

**Causa raiz:** uso de `as BaselineSnapshot` em fronteira de I/O sem validação Zod imediata. Viola diretamente a regra 2 da §3 do `CLAUDE.md`: *"Boundary casts must be immediately followed by Zod validation or an equivalent explicit narrowing function."*

**Fix proposto:**

Definir o schema Zod e usá-lo:

```ts
// baseline/schema.ts (novo arquivo)
import { z } from 'zod';

const BaselineEntrySchema = z.object({
  checkId: z.string(),
  ruleId: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  location: z.object({
    file: z.string(),
    startLine: z.number().int().positive().optional(),
  }),
  addedAt: z.string(),
  reason: z.string(),
});

const MetricBaselineSchema = z.object({
  value: z.number(),
  direction: z.enum(['higher-is-better', 'lower-is-better']),
});

export const BaselineSnapshotSchema = z.object({
  schemaVersion: z.literal('1.0'),
  createdAt: z.string(),
  createdAtCommit: z.string(),
  suppressed: z.array(BaselineEntrySchema),
  metrics: z.record(z.string(), MetricBaselineSchema),
});
```

E em `baseline.ts:load`:

```ts
try {
  const parsed: unknown = JSON.parse(await fs.readFile(path));
  return BaselineSnapshotSchema.parse(parsed);
} catch (error) {
  if (error instanceof z.ZodError) {
    throw new BaselineParseError(
      `Invalid baseline file: ${path}: ${error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      { cause: error },
    );
  }
  throw new BaselineParseError(`Failed to parse baseline file: ${path}`, { cause: error });
}
```

**Dependência:** independente. Resolve junto a regra 2 das non-negotiable rules para esse arquivo.

---

### AUD-1.7 — Trend mode não existe

- **Severidade:** Crítico
- **Localização:** `packages/core/src/runner/runner.ts:190`

**Código atual:**

```ts
const context: RunContext = {
  cwd: input.cwd,
  tier,
  trigger: options.trigger ?? null,
  mode: options.diffOnly ? 'diff' : 'full',  // ← apenas dois valores
  baseRef: options.diffOnly ? baseRef : null,
  // ...
};
```

A spec define três modos (`'diff' | 'trend' | 'full'`) e o JSON schema também valida os três (`packages/core/src/schema/report.ts:68`). Não há nenhum caminho que produza `mode: 'trend'`.

**Sintoma:**

- O campo `mode: 'trend'` no schema é letra morta.
- Combinado com AUD-1.3 (regressões hardcoded vazias), toda a área "trend e regressões de métrica" da spec é não-funcional.
- O usuário não tem como rodar "verificar regressões de métrica em todo o codebase" sem rodar com `--diff` (que filtra por arquivo) ou full (que não compara contra baseline).

**Causa raiz:** o `RunOptions` só tem `diffOnly: boolean`. Não modela o terceiro caso.

**Fix proposto:**

Trocar `diffOnly: boolean` por `mode: RunMode` no `RunOptions`:

```ts
export type RunMode = 'diff' | 'trend' | 'full';

export type RunOptions = {
  readonly tier?: Tier;
  readonly trigger?: string;
  readonly mode: RunMode;     // antes era diffOnly
  readonly baseRef?: string;
  readonly maxConcurrency?: number;
  readonly signal?: AbortSignal;
};
```

E no contexto do check, derivar `diffOnly` a partir do mode:

```ts
const checkContext = {
  // ...
  diffOnly: context.mode === 'diff',
  // ...
};
```

`runChecks`:

```ts
const changedFiles = options.mode === 'diff'
  ? await input.git.changedFiles(input.cwd, baseRef)
  : [];
const context: RunContext = {
  cwd: input.cwd,
  tier,
  trigger: options.trigger ?? null,
  mode: options.mode,
  baseRef: options.mode === 'diff' ? baseRef : null,
  // ...
};
```

CLI ganha `--trend` (mutuamente exclusivo com `--diff`):

```ts
.option('--diff', 'Only keep findings introduced in changed files')
.option('--trend', 'Track metric regressions across the whole codebase')
```

E no diff filter, o trend mode mantém todos os findings mas marca `introducedInDiff: false` em todos (já é o comportamento atual quando `diffOnly: false`); a diferença é que `compareMetrics` (após AUD-1.3) é chamado.

**Dependência:** AUD-1.3 deve estar resolvido para o trend mode ter algo útil para reportar.

---

## 2. Violações das Non-negotiable rules (§3 do CLAUDE.md)

### AUD-2.1 — Casts em fronteira sem validação subsequente (regra 2)

- **Severidade:** Sério
- **Regra violada:** §3.2 — *"Allowed: `as const`, branded-type constructors, and casts at trust boundaries (parsing JSON, reading process arguments). Boundary casts must be immediately followed by Zod validation or an equivalent explicit narrowing function."*

**Locais:**

| Arquivo:linha | Cast |
|---|---|
| `core/src/baseline/baseline.ts:91` | `parsed as BaselineSnapshot` (coberto por AUD-1.6) |
| `core/src/jobs/status.ts:31` | `JSON.parse(content) as JobMeta` |
| `core/src/jobs/status.ts:53` | `JSON.parse(content) as Report` |
| `core/src/pending/pending.ts:79` | `JSON.parse(content) as readonly PendingItem[]` |
| `core/src/cli/commands/check.ts:132` | `JSON.parse(await deps.fs.readFile(jobMetaPath))` (sem cast explícito mas usado como `JobMeta`) |
| `core/src/cli/commands/check.ts:162` | idem |
| `core/src/cli/commands/baseline.ts:68` | `as RunOutcome` (mais grave: cast estrutural, não só de I/O) |
| `checks/coverage/src/coverage.ts:76` | `JSON.parse(content) as IstanbulReport` |

**Sintoma:**

- Um `meta.json` corrompido (mesmo escrito por uma versão antiga do Sentiness) é silenciosamente aceito e usado.
- `JobReader.read` retorna um objeto com forma errada — quem consome (CLI `status`) acessa `meta.exitCode`, `meta.status`, etc. sem garantia.
- Um `pending-feedback.json` com forma errada vai ser usado como se fosse `PendingItem[]` — `item.acked` pode ser `undefined` e o filtro de unacked vira no-op.

**Fix proposto:**

Definir Zod schemas para cada tipo persistido em disco:

- `JobMetaSchema` em `jobs/types.ts`
- `PendingItemSchema` em `pending/pending.ts`
- `IstanbulReportSchema` em `checks/coverage/src/coverage.ts`

E usá-los nos pontos de leitura. Para o cast `as RunOutcome` em `cli/commands/baseline.ts:68`, mudar a construção do `mergedOutcome` para já ter o tipo correto sem cast (usar `Map<CheckId, CheckResult>` desde o início, sem spread que perde tipos).

**Dependência:** AUD-1.6 cobre o caso do baseline.

---

### AUD-2.2 — `} catch {}` engolindo erros (regra 5)

- **Severidade:** Sério
- **Regra violada:** §3.5 — *"No swallowed errors. Never write `catch (e) {}`. Either handle the error meaningfully, wrap and rethrow with context, or let it propagate."*

**Locais:**

| Arquivo:linha | Comportamento atual |
|---|---|
| `core/src/jobs/status.ts:40` | `} catch { return undefined; }` em `read` |
| `core/src/jobs/status.ts:54` | `} catch { return undefined; }` em `readResult` |
| `core/src/pending/pending.ts:68` | `} catch {}` em `releaseLock` |
| `core/src/pending/pending.ts:80` | `} catch { return []; }` em `readAtomic` |
| `core/src/cli/commands/install-hooks.ts:38` | `} catch { logger.warn(...) }` (warn sem cause) |
| `core/src/cli/commands/install-hooks.ts:67` | idem |
| `checks/biome/src/biome.ts:30` | `} catch {}` em cache de file read |
| `checks/knip/src/knip.ts:30` | idem |
| `checks/stryker/src/stryker.ts:48` | `} catch { return undefined; }` em parse do report |

**Caso mais perigoso:** `pending.ts:80` — um `pending-feedback.json` corrompido aparece como **fila vazia**. O agente perde feedback de jobs que rodaram em background, sem nenhum sinal de erro.

**Sintoma geral:** falhas silenciosas. Nenhum log, nenhum erro, comportamento normalizado para o caminho feliz.

**Fix proposto:**

Para cada local, decidir entre:

1. **Logar e degradar** — quando a degradação é genuína (ex.: arquivo não existe ou está corrompido, mas o sistema deve continuar):
   ```ts
   } catch (error) {
     ctx.logger.warn(`Failed to parse pending-feedback.json`, {
       cause: error instanceof Error ? error.message : String(error),
     });
     return [];
   }
   ```
2. **Wrap e relançar** — quando a falha é fatal mas precisa de contexto:
   ```ts
   } catch (error) {
     throw new PendingQueueError('Failed to read pending feedback', { cause: error });
   }
   ```
3. **Deixar propagar** — quando o catch é só preguiça.

Recomendação por caso:

- `jobs/status.ts:40,54` → logar warn, retornar `undefined` (degradação é OK, mas precisa rastro)
- `pending/pending.ts:68` → logar warn (lock dir foi removido por outro processo? race condition que merece visibilidade)
- `pending/pending.ts:80` → logar **error**, retornar `[]` (corrupção de fila é grave)
- `install-hooks.ts:38,67` → manter warn mas incluir cause no log
- `checks/biome/src/biome.ts:30` e `knip:30` → logar debug (file não pôde ser lido para fingerprint enrichment; benigno)
- `checks/stryker/src/stryker.ts:48` → logar error e retornar `undefined` (parse de report é importante)

**Pré-requisito:** Para os caches de file read em checks, eles não recebem `Logger` no seu fluxo de cache (`lineContent`). Passar `ctx.logger` para essa função.

---

### AUD-2.3 — `console.log` em código de produção (regra 4)

- **Severidade:** Sério
- **Regra violada:** §3.4 — *"No `console.log`. Use the injected `Logger`. The CLI's stdout is reserved for the JSON report."*

**Local:** `packages/core/src/cli/wizard/prompts.ts:52`

```ts
async choice<T extends string>(...): Promise<T> {
  // ...
  while (true) {
    // ...
    console.log('Invalid choice, please try again.');
  }
}
```

**Sintoma:**

- Escreve em **stdout** durante uma chamada interativa.
- Se o usuário pipear a saída do `init` (improvável mas possível), a string `'Invalid choice'` contamina o JSON.
- Mais grave conceitualmente: viola a separação stdout=JSON / stderr=logs.

**Outro caso:** `packages/core/scripts/generate-schema.ts:15` — `console.log('Generated JSON schema to ${targetPath}');`. Esse é um **script de build/devtool**, não código de runtime. Aceitável (mas vale anotar com comentário ou mudar para `process.stdout.write` para consistência).

**Fix proposto:**

`Prompter` deve receber um `OutputWriter` ou `Logger`:

```ts
export class Prompter {
  constructor(
    private readonly stdout: OutputWriter,
    input = process.stdin,
    output = process.stdout,
  ) {
    this.rl = createInterface({ input, output });
  }

  async choice<T extends string>(...): Promise<T> {
    while (true) {
      // ...
      this.stdout.write('Invalid choice, please try again.\n');
    }
  }
}
```

Note: prompts são interativos e por natureza usam stdout (o usuário precisa ver o prompt). Em modo init, o CLI não está produzindo report JSON — então é seguro escrever em stdout. O ponto é **não usar `console.log` direto**, e idealmente passar pelo writer injetado para testabilidade.

---

### AUD-2.4 — `Date` global não-injetada (regra 3 — global state, e §8)

- **Severidade:** Sério
- **Regra violada:**
  - §3.3 — *"No global state. No singletons, no module-level mutable variables, no `process.env` reads outside of a single config-loading module."*
  - §8 (testing) — *"Never mock `Date.now()` globally. Inject a `Clock` interface or pass a timestamp argument."*

**Local:** `packages/core/src/baseline/baseline.ts:138`

```ts
static accept(snapshot: BaselineSnapshot, finding: Finding, reason: string): BaselineSnapshot {
  if (reason.trim().length === 0) {
    throw new BaselineAcceptError('Baseline accept reason is required');
  }
  return sortSnapshot({
    ...snapshot,
    suppressed: [...snapshot.suppressed, toEntry(finding, new Date().toISOString(), reason)],
  });
}
```

`new Date().toISOString()` é exatamente o que a §8 proíbe.

**Sintoma:**

- Os testes de `BaselineManager.accept` usam asserções fracas (`expect(updated.suppressed[0]?.reason).toBe('wontfix')`) sem assertar o `addedAt` porque não conseguem injetar.
- Fica difícil testar idempotência ou ordem por timestamp.

**Causa raiz:** a fachada estática do `BaselineManager` não recebe `Clock`. Para preservar a fachada, ou se converte para método de instância, ou se passa `Clock` como argumento extra.

**Fix proposto:**

Aceitar `Clock` como argumento explícito no método:

```ts
static accept(
  snapshot: BaselineSnapshot,
  finding: Finding,
  reason: string,
  clock: Clock,
): BaselineSnapshot {
  if (reason.trim().length === 0) {
    throw new BaselineAcceptError('Baseline accept reason is required');
  }
  return sortSnapshot({
    ...snapshot,
    suppressed: [...snapshot.suppressed, toEntry(finding, clock.isoNow(), reason)],
  });
}
```

E o caller (`baselineAcceptCommand` em `cli/commands/baseline.ts:225`) passa `deps.clock`.

Discussão alternativa: conferir se a fachada estática realmente vale (a §6 SRP do CLAUDE.md diz "composition over inheritance" e a classe estática só existe pela "spec exposes BaselineManager as a static facade" — comentário em `baseline.ts:80`). Se preferir, converter `BaselineManager` para uma classe regular com `Clock` no construtor.

---

## 3. Gaps significativos vs. spec

### AUD-3.1 — `install-hooks` é destrutivo e não detecta gerenciadores

- **Severidade:** Médio (mas com potencial de destruir trabalho do usuário)
- **Localização:** `packages/core/src/cli/commands/install-hooks.ts`

**Spec (T4.3):** *"Detect `husky`, `lefthook`, `simple-git-hooks` from `package.json`. If any present, install hook config there. If none, write to `.git/hooks/` directly with a warning... and offer to install `simple-git-hooks` (no daemon, lightweight)."*

**Implementação atual:**

- Linha 32-33: escreve direto em `.git/hooks/pre-commit` sempre. **Sobrescreve qualquer pre-commit existente.** Se o usuário tem husky configurado, o comando do husky vai ser apagado.
- Linha 21, 53: hardcoda `pnpm sentiness check ...`. Em projeto npm/yarn, o hook falha silenciosamente.
- Não há checagem de idempotência (a spec exige).

**Sintomas:**

1. Usuário com husky configurado roda `sentiness install-hooks`. Husky pre-commit é apagado e substituído por shell script Sentiness. Pré-commit do husky (lint-staged, prettier, etc.) deixa de rodar.
2. Usuário npm roda `sentiness install-hooks`. Hook escreve `pnpm sentiness check`. Próximo commit chama `pnpm` que não existe. Commit falha cripticamente.
3. Re-rodar `install-hooks` não verifica se já existe — sobrescreve.

**Fix proposto:**

Pseudocódigo:

```ts
const metadata = await detectPackageMetadata(deps.cwd, deps.fs);
const pkgManagerCommand = packageManagerCommand(metadata.packageManager); // 'pnpm' | 'npm' | 'yarn' | 'npx'

const hookManager = detectHookManager(metadata);
// retorna 'husky' | 'lefthook' | 'simple-git-hooks' | null

if (hookManager) {
  return installViaHookManager(hookManager, pkgManagerCommand, deps);
}

// fallback: .git/hooks direto
const preCommitPath = join(hooksDir, 'pre-commit');
if (await deps.fs.exists(preCommitPath)) {
  const existing = await deps.fs.readFile(preCommitPath);
  if (!existing.includes('sentiness')) {
    deps.logger.warn(`Existing pre-commit hook at ${preCommitPath} will be backed up to pre-commit.bak`);
    await deps.fs.rename(preCommitPath, `${preCommitPath}.bak`);
  }
  // se já tem 'sentiness', é idempotência: regenerar com versão atual
}

await deps.fs.writeFile(preCommitPath, hookScriptForPm(pkgManagerCommand));
```

`packageManagerCommand` retorna `pnpm`, `npm run`, `yarn run`, ou `npx`.

`detectHookManager` lê o `package.json` e procura por `husky` em `devDependencies`, ou `lefthook`/`simple-git-hooks` em `devDependencies`.

---

### AUD-3.2 — `doctor` não chama `detect()`

- **Severidade:** Médio
- **Localização:** `packages/core/src/cli/commands/doctor.ts`
- **Reconhecido em** `docs/progress.md:143` como gap.

**Spec (T4.1):** *"runs all installed checks' `detect()` and reports availability. Suggests install commands for missing tools (e.g., 'stryker not found — `pnpm add -D @stryker-mutator/core`')."*

**Implementação atual:** apenas lista checks registrados e load failures. Se `biome` não está no PATH, doctor mostra `ok: true` mesmo assim.

**Fix proposto:**

```ts
export async function doctorCommand(_args, deps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const registry = await CheckRegistry.fromConfig(config, deps.cwd);
  const metadata = await detectPackageMetadata(deps.cwd, deps.fs);

  const detectResults = await Promise.all(
    registry.list().map(async (check) => {
      const ctx = makeDetectContext(check, deps, config); // signal, fs, process, etc.
      const result = await check.detect(ctx);
      return { id: check.id, category: check.category, defaultTier: check.defaultTier, ...result };
    }),
  );

  const allOk =
    registry.loadFailures().length === 0
    && detectResults.every((r) => r.available);

  deps.stdout.write(JSON.stringify({
    ok: allOk,
    checks: detectResults,
    loadFailures: registry.loadFailures(),
    suggestions: detectResults
      .filter((r) => !r.available)
      .map((r) => suggestInstallCommand(r.id, metadata.packageManager)),
  }, null, 2) + '\n');

  return allOk ? 0 : 1;
}
```

`suggestInstallCommand('stryker', 'pnpm')` retorna `'pnpm add -D @stryker-mutator/core'`. Mapa estático por check id.

---

### AUD-3.3 — `init` só pergunta sobre Biome

- **Severidade:** Médio
- **Localização:** `packages/core/src/cli/commands/init.ts:41-44`

**Spec (T4.2):** *"For each detected gap, prompt: install / use existing path / skip."*

**Implementação atual:** só `useBiome`. Knip, Coverage, Stryker (já implementados) ficam de fora; usuário precisa editar `sentiness.config.json` à mão.

**Fix proposto:**

Iterar sobre os checks conhecidos:

```ts
const knownChecks = [
  { id: 'biome', category: 'lint', defaultTier: 'fast' },
  { id: 'knip', category: 'architecture', defaultTier: 'standard' },
  { id: 'coverage', category: 'coverage', defaultTier: 'slow' },
  { id: 'stryker', category: 'test-quality', defaultTier: 'slow' },
];

for (const check of knownChecks) {
  const enabled = await prompter.confirm(
    `Enable ${check.id} (${check.category})?`,
    true,
  );
  if (enabled) {
    checks[check.id] = { enabled: true, tier: check.defaultTier };
  }
}
```

Pode também perguntar `tier` por check, mas isso vira muito interativo. Manter o default.

A lista `knownChecks` deve ser definida no próprio `init.ts` (não vale ter um registry estático no SDK que precisa atualizar a cada novo check). Ou opcionalmente, ler dinamicamente quais `@sentiness/check-*` estão instalados via `detectPackageMetadata`.

---

### AUD-3.4 — Stryker não lê `stryker.conf.js` para path do report

- **Severidade:** Médio
- **Localização:** `packages/checks/stryker/src/stryker.ts:41`

**Spec (T5.5):** *"Parse the report file (path configured in `stryker.conf.js`, Sentiness reads it)."*

**Implementação atual:** path hardcoded `reports/mutation/mutation.json`.

**Sintoma:** projetos que customizam `htmlReporter.fileName` ou usam estrutura diferente de pastas vão receber `status: 'error'` ("failed to generate or read stryker report") em vez do report real.

**Fix proposto:**

Stryker tem várias formas de configuração (`stryker.conf.js`, `stryker.config.mjs`, `stryker.conf.json`, campos em `package.json`). Suportar JSON primeiro (mais simples):

```ts
async function resolveReportPath(ctx: CheckContext): Promise<string> {
  const candidates = ['stryker.conf.json', 'stryker.config.json'];
  for (const candidate of candidates) {
    const path = join(ctx.cwd, candidate);
    if (await ctx.fs.exists(path)) {
      try {
        const config = JSON.parse(await ctx.fs.readFile(path));
        const fileName = config?.jsonReporter?.fileName;
        if (typeof fileName === 'string') {
          return isAbsolute(fileName) ? fileName : join(ctx.cwd, fileName);
        }
      } catch (error) {
        ctx.logger.warn(`Failed to parse ${candidate}`, { cause: error });
      }
    }
  }
  // Default path do Stryker
  return join(ctx.cwd, 'reports/mutation/mutation.json');
}
```

Para `.js`/`.mjs`, deixar como follow-up (importar dinamicamente é mais arriscado e a maioria dos projetos modernos usa JSON ou `.cjs`).

---

### AUD-3.5 — Baseline save não é atômico

- **Severidade:** Médio
- **Localização:** `packages/core/src/baseline/baseline.ts:100-103`
- **Reconhecido em** `docs/progress.md:147` como TODO.

**Implementação atual:**

```ts
static async save(path: string, snapshot: BaselineSnapshot, fs: FileSystem): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(sortSnapshot(snapshot), null, 2)}\n`);
}
```

Se o processo for interrompido durante o `writeFile` (Ctrl+C, OOM, kill), o arquivo fica truncado. Próximo `BaselineManager.load` lança `BaselineParseError`.

`PendingQueue.writeAtomic` (`pending/pending.ts:85-90`) já faz o pattern correto:

```ts
const tempPath = `${this.path}.tmp.${randomUUID()}`;
await this.fs.mkdir(dirname(this.path), { recursive: true });
await this.fs.writeFile(tempPath, content);
await this.fs.rename(tempPath, this.path);
```

**Fix proposto:** reusar o mesmo pattern em `BaselineManager.save`:

```ts
static async save(path: string, snapshot: BaselineSnapshot, fs: FileSystem): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp.${randomUUID()}`;
  const content = `${JSON.stringify(sortSnapshot(snapshot), null, 2)}\n`;
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, path);
}
```

Ou extrair `writeAtomic` como helper compartilhado em `core/src/fs/atomic-write.ts` e usar em ambos os pontos.

---

## 4. Bugs menores e cheiros de design

### AUD-4.1 — `errorResult`/`skippedResult` definem `durationMs: 0` que é sobrescrito

- **Severidade:** Menor
- **Localização:** `packages/core/src/runner/runner.ts:101-117`, e em todos os checks (`durationMs: 0` hardcoded)

`runOneCheck:148` faz `return { ...result, durationMs: input.clock.now() - started }`, sobrescrevendo o `durationMs` que veio do check. Cheirinho de design ruim — todos os checks retornam `durationMs: 0` "porque o runner reescreve". Documentar ou remover do tipo.

**Fix proposto:** ou remover `durationMs` da `CheckResult` (calculado externamente), ou documentar com comentário no tipo.

---

### AUD-4.2 — `loadFailures` iterado duas vezes no runner

- **Severidade:** Menor
- **Localização:** `packages/core/src/runner/runner.ts:195-199`

```ts
const results = new Map<CheckId, CheckResult>(syntheticLoadFailureResults(input));
const checkMetadata = new Map<CheckId, { readonly category: Category }>();
for (const failure of input.registry.loadFailures()) {
  checkMetadata.set(failure.requestedId, { category: 'lint' });
}
```

Itera `loadFailures()` uma vez em `syntheticLoadFailureResults` e outra aqui. Pode unificar em uma única iteração.

---

### AUD-4.3 — `concurrency.ts` rejeita itens falsy

- **Severidade:** Menor
- **Localização:** `packages/core/src/runner/concurrency.ts:10`

```ts
const item = queue.shift();
if (item) {
  await worker(item);
}
```

`if (item)` rejeita `0`, `''`, `false`, `null`. Funciona porque `Check` é objeto, mas torna a função não-genérica.

**Fix:** `if (item !== undefined)`.

---

### AUD-4.4 — `randomUUID` em vez de ULID nos jobs

- **Severidade:** Menor
- **Localização:** `packages/core/src/jobs/spawner.ts:17`

A spec sugeriu ULID por ser monotonicamente crescente. UUIDv4 não é. Resultado: `JobReader.list()` retorna jobs em ordem arbitrária, dificultando "qual foi meu último job".

**Fix:** ou implementar mini-ULID (timestamp + crypto random) em ~30 linhas, ou aceitar a fragilidade e ordenar `list()` por `startedAt` antes de retornar.

---

### AUD-4.5 — `JobReader` detecta mas não persiste status orphaned

- **Severidade:** Menor
- **Localização:** `packages/core/src/jobs/status.ts:33-37`

```ts
if (meta.status === 'running') {
  if (!this.isAlive(meta.pid)) {
    return { ...meta, status: 'failed', exitCode: -1 };
  }
}
```

Detecta job morto, retorna `failed`, mas **não atualiza `meta.json` no disco**. Toda chamada de `read` recalcula. Se o disco for lento ou o número de jobs grande, é ineficiente. Mais grave: dois consumidores podem ver estados diferentes em corrida.

**Fix:** chamar `fs.writeFile(metaPath, JSON.stringify(updatedMeta))` antes de retornar. Pode ser controverso (read não deveria mutar) — alternativa: ter um método explícito `reconcile` chamado periodicamente.

---

### AUD-4.6 — PID reuse confunde alive vs new process

- **Severidade:** Menor
- **Localização:** `packages/core/src/jobs/status.ts:12-21`

`process.kill(pid, 0)` retorna true se o PID está em uso, mesmo que seja um processo diferente (Linux reutiliza PIDs). Job morto cujo PID foi reusado por outro processo aparece como `running`.

**Fix proposto (Linux-specific):** ler `/proc/<pid>/stat` ou `/proc/<pid>/cmdline` e comparar com `meta.command`. Em macOS/Windows, manter o comportamento atual e documentar a fragilidade.

Ou, mais simples: persistir `startedAt` (já é feito) e checar `/proc/<pid>/stat` para ver se o tempo de início bate. Aceita-se que isso é Linux-only; o projeto declara `Platform: linux` no `gitStatus`.

Este é o tipo de fragilidade que pode ser deixada para follow-up — não é um sintoma frequente.

---

### AUD-4.7 — `NodeProcessRunner.execFile` perde PATH quando env é fornecido

- **Severidade:** Menor (mas armadilha real)
- **Localização:** `packages/core/src/process/process-runner.ts:32-38`

```ts
const result = await execFileAsync(command, [...args], {
  cwd: options?.cwd,
  ...(options?.env ? { env: { ...options.env } } : {}),
  signal: options?.signal,
  timeout: options?.timeoutMs,
  maxBuffer: 20 * 1024 * 1024,
});
```

Quando `options.env` é definido, sobrescreve `process.env` completamente. Se o caller passa `env: { CUSTOM_VAR: 'foo' }`, o subprocesso perde `PATH` e falha em achar binários.

**Fix proposto:**

```ts
...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
```

Comportamento usual em ferramentas similares: env do usuário **estende** o env do parent, não substitui.

---

### AUD-4.8 — `BaselineEntry.checkId/ruleId` perdem o brand

- **Severidade:** Menor
- **Localização:** `packages/core/src/baseline/baseline.ts:6-7`

```ts
export type BaselineEntry = {
  readonly checkId: string;        // deveria ser CheckId
  readonly ruleId: string;         // deveria ser RuleId
  // ...
};
```

Os branded types `CheckId` e `RuleId` existem no SDK justamente para evitar confusão. Aqui são desbranded silenciosamente. Não causa bug, mas perde o investimento em type safety.

**Fix:** trocar `string` por `CheckId` / `RuleId`. Como branded types são "string + brand", a serialização JSON é idêntica — sem custo em runtime.

---

### AUD-4.9 — `baseline init` roda checks 3 vezes

- **Severidade:** Menor (perf)
- **Localização:** `packages/core/src/cli/commands/baseline.ts:34-69`

A spec (T4.1) aceita: *"This can be implemented as one all-tiers helper or as three runChecks invocations merged into one RunOutcome."* O atual usa 3 invocações.

Para um repo grande com Stryker (slow tier, 5+ minutos), `baseline init`, `baseline update`, `baseline accept` e `baseline prune` cada um leva 3× o tempo de uma run.

**Fix proposto:** introduzir uma `RunMode` extra `'all-tiers'` (não confundir com o trend mode da AUD-1.7) ou um helper `runAllTiers` que iterou no nível do registry, não chamando `runChecks` 3×.

---

### AUD-4.10 — `sentinessVersion` hardcoded em dois lugares

- **Severidade:** Menor
- **Localização:**
  - `packages/core/src/reporter/reporter.ts:127` — `sentinessVersion: '0.1.0'`
  - `packages/core/src/cli/index.ts:30` — `cli.version('0.1.0')`

Vai divergir de `package.json` na próxima release.

**Fix proposto:** ler `package.json` no boot:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
);
export const SENTINESS_VERSION = pkg.version;
```

E expor `SENTINESS_VERSION` ao reporter via dep injection.

---

### AUD-4.11 — `reporter.ts` fallback de category para `'lint'`

- **Severidade:** Menor
- **Localização:** `packages/core/src/reporter/reporter.ts:94`

```ts
return {
  id: checkId,
  category: metadata?.category ?? 'lint',
  // ...
};
```

Quando um check falha load, o synthetic check fica com `category: 'lint'` arbitrário (fixado em `runner.ts:198`). O usuário vê um "lint" que na verdade era um problema de plugin.

**Fix:** ou tornar `CheckLoadFailure.category` opcional/configurável, ou usar uma categoria nova `'platform'` para load failures (precisaria adicionar ao schema).

---

### AUD-4.12 — Knip gera findings com `file: 'unknown'`

- **Severidade:** Menor
- **Localização:** `packages/checks/knip/src/normalize.ts:114, 152`

```ts
issues.push(...parsed.files.map((i) => normalizeIssue('unused-files', 'warning', i, 'unknown')));
issues.push(...parsed.exports.map((i) => normalizeIssue('unused-exports', 'warning', i, 'unknown')));
```

Issues sem `file` recebem o literal `'unknown'`. Polui o report:

```json
{
  "location": { "file": "unknown" },
  "fingerprint": "..."
}
```

**Fix proposto:** descartar findings sem `file` em vez de defaultar para `'unknown'`. Ou pelo menos usar `''` (string vazia) e filtrar no reporter.

---

### AUD-4.13 — Knip `id` não inclui file (potencial colisão)

- **Severidade:** Menor
- **Localização:** `packages/checks/knip/src/knip.ts:47`

```ts
id: `knip:${issue.ruleId}:${issue.name ?? 'unknown'}`,
```

Duas variáveis `x` em arquivos diferentes têm o **mesmo `id`**. O `fingerprint` está correto (inclui file), mas tooling externo que use `id` como chave única vai colidir.

**Fix:** `id: \`knip:${issue.ruleId}:${issue.file}:${issue.name ?? 'unknown'}\``.

---

### AUD-4.14 — `Prompter` instancia readline no construtor (efeito colateral)

- **Severidade:** Menor
- **Localização:** `packages/core/src/cli/wizard/prompts.ts:5`

```ts
private readonly rl = createInterface({ input, output });
```

Cada teste precisa mockar a classe inteira (como em `init.test.ts:13-19`). Receber `readline` por DI seria mais testável.

**Fix:** receber `Interface` (do readline) por construtor, com factory padrão.

---

## 5. Higiene do repositório

### AUD-5.1 — Lint quebrado por lixo de teste

- **Severidade:** Sério (quebra CI)
- **Localização:** `packages/core/src/registry/registry.test.ts:50-70`

`pnpm lint` falha agora porque o teste `'validates check exports through a real mock module'` cria `<cwd>/.sentiness-test-registry/` com `mkdirSync` (linha 51-55) e nunca limpa. O Biome encontra o `package.json` malformado dentro:

```
× Formatter would have printed the following content:
  packages/core/.sentiness-test-registry/package.json
```

**Causa raiz:**

- Teste usa `process.cwd()` (= `packages/core`) como base para o tempdir
- Sem `afterEach`/`afterAll`
- `.sentiness-test-registry/` não está em `biome.json` `files.includes` nem em `.gitignore`

**Sintoma:** qualquer dev que rode `pnpm test` antes de `pnpm lint` quebra o CI.

**Fixes possíveis (escolher um):**

1. **Mais limpo:** usar `os.tmpdir()` em vez de `process.cwd()`:
   ```ts
   import { mkdtempSync } from 'node:fs';
   import { tmpdir } from 'node:os';
   import { join } from 'node:path';
   import { afterAll, beforeAll, describe, expect, it } from 'vitest';

   describe('registry', () => {
     let tempDir: string;
     beforeAll(() => { tempDir = mkdtempSync(join(tmpdir(), 'sentiness-registry-')); });
     afterAll(() => { rmSync(tempDir, { recursive: true, force: true }); });
     // ...
   });
   ```

2. **Mais simples:** adicionar `afterAll(() => rmSync(tempDir, { recursive: true, force: true }))` e botar `.sentiness-test-registry/` no `.gitignore` e em `biome.json` `files.includes`.

A primeira opção é a recomendada — testes não devem ter side effect persistente no working tree do repositório.

---

### AUD-5.2 — `init.gitignore` pode duplicar entradas em re-run

- **Severidade:** Menor
- **Localização:** `packages/core/src/cli/commands/init.ts:71-76`

```ts
if (await deps.fs.exists(gitignorePath)) {
  const current = await deps.fs.readFile(gitignorePath);
  if (!current.includes('.sentiness/jobs/')) {
    await deps.fs.appendFile(gitignorePath, ignoreEntries);
    deps.logger.info('Added .sentiness/ ignores to .gitignore');
  }
}
```

A checagem `!current.includes('.sentiness/jobs/')` é frágil. Se o user já ignorou de outra forma (ex.: só `.sentiness/`), a adição vai duplicar.

**Fix proposto:** verificar entrada por entrada, ou usar markers (ex.: `# Sentiness:start` / `# Sentiness:end`) similar ao que a Fase 6 vai fazer com adapters.

---

## 6. Pontos positivos (registro)

Para balancear a auditoria, vale registrar o que está bem feito:

- O `check-sdk` está limpo, sem dependências externas, e o algoritmo de fingerprint corresponde literalmente ao spec (separador ` `, normalização de whitespace, SHA-256 hex 64 chars). Bom alicerce.
- `ReportSchema` é fiel ao Appendix A; o regex `^[a-f0-9]{64}$` em `fingerprint` tranca o contrato.
- `runChecks` lida corretamente com timeouts, `AbortSignal` encadeado, throw de check, detect-not-available, e load failures como findings sintéticos. Todos os caminhos são testados.
- `PendingQueue` faz lock + write atômico (temp + rename) corretamente. É o pattern que falta no `BaselineManager`.
- `Logger` usa stderr e nunca stdout (à exceção do bug em `prompts.ts`).
- `GitProvider` usa `--diff-filter=ACMRT` (exclui delete) como a spec pede.
- `NodeProcessRunner` faz catching apropriado de erro e converte exit code não-zero em result, em vez de throw.
- 94 testes passam, typecheck passa, vertical slice produz JSON válido contra o schema.

---

## 7. Roadmap de correção priorizado

Recomendação: **fechar este sprint corretivo antes de começar a Fase 6 (adapters)**. Justificativa: muitos dos itens (especialmente AUD-1.4) tocam contratos do SDK que adapters vão consumir; mudá-los depois é caro.

### Sprint corretivo recomendado

**Onda 1 — hotfixes desbloqueantes (1-2 horas de trabalho):**

1. **AUD-1.1** — apagar `?? 'standard'` em `check.ts:38`. 1 linha. Destrava trigger-only.
2. **AUD-1.5** — ordenar por severidade em `truncateFindings`. ~5 linhas.
3. **AUD-5.1** — mover tempdir do registry test para `os.tmpdir()` + cleanup. ~10 linhas.

**Onda 2 — bugs estruturais (meio dia):**

4. **AUD-1.6** — `BaselineSnapshotSchema` Zod e validar em `load`.
5. **AUD-2.1** + **AUD-2.2** — varredura completa por `as` casts pós-`JSON.parse` e `} catch {}`. Adicionar Zod schemas para `JobMeta`, `PendingItem`, `IstanbulReport`. Adicionar logger.warn nos catches que fazem sentido.
6. **AUD-1.2** — fix do background mode (jobId antes do spawn, cliPath em produção).

**Onda 3 — contratos do SDK (meio dia):**

7. **AUD-1.4** — adicionar `metricSpecs` ao `Check` no SDK; checks declaram direção. Mudança breaking no contrato — fazer agora, antes da Fase 8.
8. **AUD-1.3** — chamar `compareMetrics` em `applyBaselineToOutcome`.
9. **AUD-1.7** — introduzir trend mode no runner e CLI.

**Onda 4 — gaps de UX (1 dia):**

10. **AUD-3.1** — reescrever `install-hooks` para detectar gerenciadores e package manager.
11. **AUD-3.2** — `doctor` chama `detect()` por check.
12. **AUD-3.3** — `init` pergunta sobre todos os checks conhecidos.
13. **AUD-3.5** — `BaselineManager.save` atômico (extrair `writeAtomic` helper).
14. **AUD-2.3** — `Prompter` usa `OutputWriter` em vez de `console.log`.
15. **AUD-2.4** — `BaselineManager.accept` recebe `Clock`.

### Follow-ups documentados (não-bloqueantes)

Itens menores que podem virar tasks no `progress.md`:

- AUD-3.4 — Stryker `stryker.conf.json`
- AUD-4.1 a AUD-4.14 — cheiros e fragilidades isoladas
- AUD-5.2 — duplicação de `.gitignore` em re-run

### Post-Fase 6 / antes do release público

- E2E tests (T7.1, já anotado em progress.md)
- Documentação pública (T7.2)
- Schema JSON regression test (já anotado)

---

## 8. Como aplicar este documento

- Cada PR de correção deve referenciar o(s) ID(s) AUD-x.y que fecha.
- Se um fix não for aplicável ou se o entendimento aqui estiver errado, **comentar neste arquivo com a divergência antes de implementar diferente** (a §13 do CLAUDE.md cobre isso: "If two tasks have conflicting expectations — flag it").
- Após cada onda completar, atualizar `progress.md` e marcar os IDs aqui com `(resolvido em <commit>)`.

---

## 9. Critérios de aceite do sprint corretivo

A correção está completa quando todas estas afirmações são verdadeiras:

- [ ] `pnpm typecheck` passa.
- [ ] `pnpm test` passa, com cobertura >=85% linha / 80% branch (mantém threshold da spec).
- [ ] `pnpm lint` passa **sem** ter rodado testes antes (i.e., sem o lixo do registry test).
- [ ] `sentiness check --trigger=post-edit` (sem `--tier`) executa e retorna report válido.
- [ ] `sentiness check --background --tier=slow` cria job que **escreve `result.json` corretamente** e atualiza `meta.json` para `completed`.
- [ ] `sentiness pending` lista o item enqueued pelo job acima.
- [ ] `grep -rn "} catch {" packages/*/src --include="*.ts" --exclude="*.test.ts"` não retorna nada.
- [ ] `grep -rn "as Report\|as JobMeta\|as PendingItem\|as BaselineSnapshot\|as RunOutcome" packages/*/src --include="*.ts" --exclude="*.test.ts"` não retorna nada.
- [ ] `grep -rn "console\." packages/*/src --include="*.ts" --exclude="*.test.ts" --exclude-dir=scripts` não retorna nada.
- [ ] `sentiness baseline init` cria baseline com **`direction` correta por métrica** (não tudo `higher-is-better`).
- [ ] Em um run com baseline tendo métrica que regrediu, `report.trend.regressions` contém a regressão.
- [ ] Em um check com 60 errors + 60 warnings + `maxFindingsPerCheck=50`, o report mostra os 50 errors (não 50 dos primeiros).
