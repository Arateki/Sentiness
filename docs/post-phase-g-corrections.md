# Correções pós-Fase G

Data: 2026-04-29
Implementado por: Claude (Sonnet 4.6)
Fonte: `docs/post-phase-g-pending.md` (auditoria do Opus 4.7)

Todos os 17 itens listados na auditoria foram implementados e validados. A suite completa (163 testes unitários + 13 E2E), `pnpm lint` e `pnpm typecheck` passam limpos ao final.

---

## Críticos

### C-1 — `baseline update --metric=foo` bloqueado em regressão sem `--force`

**Arquivo:** `packages/core/src/cli/commands/baseline.ts`

A condição `if (improved || targetMetric === metricKey)` permitia que `--metric=foo` gravasse um valor regredido no baseline, silenciando a regressão permanentemente.

**O que foi feito:**

- Removida a condição `targetMetric === metricKey` que forçava atualização independente de direção.
- Adicionada flag `--force` ao comando `baseline update`.
- Sem `--force`, uma regressão de métrica faz o comando retornar exit code `1` após loggar `WARN` com os valores `<baseline> → <current>`.
- Com `--force`, a atualização prossegue com `WARN` explícito.
- Adicionada variável `hasBlockingRegression` para acumular regressões antes de decidir o exit code final.
- Registrado `--force` no `registry.ts`.

**Testes adicionados em `baseline.test.ts`:**

- Regressão sem `--force` → exit code `1`, baseline não alterado.
- Regressão com `--force` → exit code `0`, baseline atualizado, WARN emitido.

---

### C-2 — `agentInstructions.blocking` ignorava checks com `status: 'error'`

**Arquivos:** `packages/core/src/reporter/agent-instructions.ts`, `packages/core/src/reporter/reporter.ts`

Quando um check retornava `status: 'error'` (ex.: Biome não instalado), `summary.blocking` ficava `false` porque o cálculo só considerava findings. O agente lia `blocking: false` e concluía que a tarefa estava pronta, ignorando a falha de tooling.

**O que foi feito:**

- Adicionado tipo `ErroredCheck` (id + errorMessage opcional) em `agent-instructions.ts`.
- `buildAgentInstructions` recebe terceiro parâmetro `erroredChecks: readonly ErroredCheck[]` (default `[]`).
- Cada check com erro gera uma entrada em `mustFix` no formato `[error] check '<id>' failed: <errorMessage ou mensagem padrão>`.
- Como `mustFix` agora fica não-vazio, `blocking: mustFix.length > 0` reflete corretamente `true`.
- Em `reporter.ts`, extraídos `erroredCheckDetails` (filtro de checks com `status === 'error'`) e passados a `buildAgentInstructions`.

**Testes adicionados em `reporter.test.ts`:**

- `1 check errored, 0 findings` → `summary.blocking === true` e `agentInstructions.mustFix` contém a entrada da falha.
- Regressão guard: estado limpo continua com `blocking: false`.

---

## Altos

### A-1 — `baseline.applied` ambíguo em trend mode; adicionado `baseline.mode`

**Arquivos:** `packages/core/src/baseline/diff-filter.ts`, `packages/core/src/schema/report.ts`, `packages/core/schema/report.schema.json`, `packages/core/src/reporter/reporter.ts`, `packages/adapters/src/render.ts`, `packages/adapters/src/skill-template.md`, `packages/adapters/src/rendered-skill.snapshot.md`

Em trend mode, `baseline.applied` era gravado como `false` apesar de o baseline ter sido carregado e usado para comparação de métricas. A saída JSON ficava contraditória (`path` preenchido, `applied: false`).

**O que foi feito:**

- Adicionado `BaselineMode = 'suppress' | 'metrics-only' | 'none'` em `diff-filter.ts`.
- `baselineApplied` agora é `baseline !== undefined` (verdadeiro sempre que o baseline foi carregado).
- `baselineMode` calculado por contexto:
  - `'suppress'` quando findings são filtrados (modo diff/full com baseline).
  - `'metrics-only'` em trend mode (só métricas comparadas).
  - `'none'` quando não há baseline.
- Campo `mode` adicionado ao objeto `baseline` no `ReportSchema` (enum, obrigatório).
- `report.schema.json` regenerado com o novo campo.
- `reporter.ts` recebe e passa `baselineMode` de `ReportInput`.
- Skill template atualizado (seção 3) para explicar `baseline.mode` e o novo comportamento de `blocking` para erros de tooling.
- `TEMPLATE_VERSION` bumpado de `'1.0'` para `'1.1'`.
- Snapshot `rendered-skill.snapshot.md` regenerado.

**Testes atualizados:**

- `diff-filter.test.ts`: trend mode agora espera `baselineApplied: true` e `baselineMode: 'metrics-only'`.
- `reporter.test.ts`: novo test `baseline.mode reflects how baseline was applied` com os três modos.
- `report.test.ts`: fixture `representativeReport()` recebe `mode: 'suppress'`.
- `status.test.ts`: fixture `reportJson()` recebe `mode: 'none'`.
- `adapters/index.test.ts`: expectativa de `TEMPLATE_VERSION` atualizada para `'1.1'`.

---

### A-2 — `configSchema?` adicionado ao SDK; Coverage e Stryker migrados

**Arquivos:** `packages/check-sdk/src/types.ts`, `packages/core/src/runner/runner.ts`, `packages/checks/coverage/src/coverage.ts`, `packages/checks/stryker/src/stryker.ts`

Cada check validava `ctx.checkConfig` à sua maneira (ou não validava). O SDK não oferecia contrato.

**O que foi feito:**

- Adicionado campo opcional ao tipo `Check`:
  ```ts
  export type Check<TConfig = Record<string, unknown>> = {
    readonly configSchema?: { readonly parse: (input: unknown) => TConfig };
    detect(ctx: CheckContext<TConfig>): Promise<DetectResult>;
    run(ctx: CheckContext<TConfig>): Promise<CheckResult>;
  };
  ```
- Em `runner.ts`, antes de chamar `detect`/`run`, o runner checa:
  ```ts
  if (check.configSchema) {
    parsedCheckConfig = check.configSchema.parse(checkConfig); // ZodError vira CheckResult status:'error'
  }
  ```
  Erros de validação de config geram `status: 'error'` com mensagem que cita o check id; config válida é passada de volta como `ctx.checkConfig`.
- `Coverage`: adicionado `CoverageConfigSchema` (Zod) validando `thresholds` com chaves `lineCoverage` e `diffLineCoverage` (number, default 80/90); exposto via `configSchema`.
- `Stryker`: adicionado `StrykerConfigSchema` validando `reportPath` como string opcional; exposto via `configSchema`.
- `docs/writing-a-check.md` documenta `configSchema`.

---

### A-3 — `location.startLine` documentado como requisito para Phase H

**Arquivo:** `docs/writing-a-check.md`

**O que foi feito:**

- Adicionada subseção "Location Precision" no guia de escrita de checks.
- Estabelecida regra: quando a ferramenta fornecer número de linha, o check **deve** incluir `startLine` em `location`. Necessário para preparar hunk-level `--diff` na Phase I.
- Exemplo de como extrair `startLine` do output de ferramentas comuns.
- Item A-3 (hunk-level `--diff` em si) permanece adiado para Phase I conforme decisão documentada no `next-agent-handoff.md`.

---

### A-4 — `install-skill --agent=all` respeita `config.agents`

**Arquivo:** `packages/core/src/cli/commands/install-skill.ts`

O campo `agents` em `sentiness.config.js` prometia controlar quais adapters `--agent=all` instalaria, mas a implementação iterava todos os adapters disponíveis sem consultar o config.

**O que foi feito:**

- Função `adaptersFor` recebe parâmetro opcional `configAgents?: readonly string[]`.
- Quando `--agent=all`, a lista de adapters é filtrada por `configAgents` (quando presente). Se `config.agents` estiver vazio ou ausente, comportamento anterior (todos os adapters) é mantido.
- Spec e comportamento agora estão alinhados.

---

## Médios

### M-1 — `PendingQueue` lock com detecção de PID stale

**Arquivo:** `packages/core/src/pending/pending.ts`

Processo morto (kill -9, OOM) durante operação deixava o lock dir órfão, travando invocações futuras por ~1.5s antes de lançar `PendingQueueLockError` sem recuperação.

**O que foi feito:**

- Após criar o lock dir, escrito arquivo `owner` com `{ pid, acquiredAt }` (Zod `LockOwnerSchema`).
- Antes de aguardar na fila de tentativas, verifica se o lock existente é stale: processo morto (via `process.kill(pid, 0)`) ou `acquiredAt` mais antigo que 10 minutos.
- Lock stale é removido com `fs.rm({ recursive: true })` e WARN é logado antes de retentar imediatamente.
- Helper `isProcessAlive(pid)` trata `EPERM` (processo existe mas sem permissão) como vivo.
- Importado `join` de `node:path` (removido `dirname` — ver B-1).

**Testes adicionados em `pending.test.ts`:**

- Stale lock com PID morto é auto-recuperado; operação prossegue.

---

### M-2 — `JobReader.read()` puro; `reconcile()` separado

**Arquivos:** `packages/core/src/jobs/status.ts`, `packages/core/src/cli/commands/status.ts`

`read()` mutava `meta.json` ao detectar job órfão, criando race condition entre leituras concorrentes e violando o princípio de menor surpresa.

**O que foi feito:**

- `read()` agora retorna o meta.json como está, sem nenhuma escrita.
- `reconcile(jobId)` faz a detecção de órfão e grava o status `failed` quando o PID está morto.
- `list()` chama `reconcile()` para cada entry (comportamento de agregação que vale a mutação).
- `status.ts` (CLI) troca `reader.read` por `reader.reconcile` para refletir a intenção.

**Testes atualizados em `status.test.ts`:**

- Novo teste: `read is pure and does not mutate meta.json for orphaned jobs`.
- Novo teste: `reconcile detects and marks orphaned jobs as failed`.
- Fixture `reportJson()` recebe `baseline.mode: 'none'` (necessário pelo novo campo obrigatório do schema).

---

### M-3 — `Coverage.detect()` verifica existência do report

**Arquivo:** `packages/checks/coverage/src/coverage.ts`

`detect()` sempre retornava `{ available: true }`, fazendo `sentiness doctor` reportar Coverage como disponível mesmo quando `coverage/coverage-final.json` não existia.

**O que foi feito:**

- `detect()` chama `ctx.fs.exists('coverage/coverage-final.json')` (relativo a `ctx.cwd`).
- Se ausente: `{ available: false, reason: 'no Istanbul coverage report at coverage/coverage-final.json; run your test suite with coverage enabled' }`.
- `run()` mantém o `status: 'skipped'` independente (caminho de defesa).

**Testes atualizados em `coverage.test.ts`:**

- Teste `detects unconditionally` dividido em dois:
  - `detects as unavailable when coverage report is missing (M-3)`.
  - `detects as available when coverage report exists (M-3)`.

---

### M-4 — `baseline accept` recebe flag `--tier`

**Arquivo:** `packages/core/src/cli/commands/baseline.ts`, `packages/core/src/cli/commands/registry.ts`

Aceitar um finding de um check fast-tier forçava rodar standard e slow antes de encontrá-lo.

**O que foi feito:**

- Adicionada flag `--tier <tier>` ao `baseline accept` (default `'fast'`).
- `findFindingByFingerprint` recebe parâmetro `tier` e executa apenas esse tier.
- Se não encontrado no tier especificado, mensagem WARN sugere tentar os outros tiers explicitamente.
- Documentado em `docs/baseline-strategy.md`.

---

### M-5 — Stryker README documenta os três caminhos de `reportPath`

**Arquivo:** `packages/checks/stryker/README.md`

A maioria dos projetos reais usa `stryker.conf.mjs`/`.cjs`. Sem doc, usuários viam erro genérico e desistiam.

**O que foi feito:**

- README reescrito para cobrir as três estratégias de resolução do report:
  1. **Config JSON** (`stryker.config.json` / `stryker.conf.json`) — Sentiness lê `jsonReporter.fileName` automaticamente.
  2. **Escape hatch explícito** — `checks.stryker.reportPath` em `sentiness.config.js` sobrepõe qualquer detecção.
  3. **Fallback** — `reports/mutation/mutation.json` (padrão do Stryker) quando nenhum dos anteriores se aplica.
- Cada estratégia tem exemplo de configuração.
- O wizard de `sentiness init` detecta `stryker.conf.{js,mjs,cjs}`/`stryker.config.{js,mjs,cjs}` sem companion JSON e pergunta o `reportPath`, gravando em `checks.stryker.reportPath`.

---

## Baixos

### B-1 — `_dir` morto removido de `pending.ts`

**Arquivo:** `packages/core/src/pending/pending.ts`

```ts
// antes
const _dir = dirname(path);
```

Variável residual removida. `dirname` continua importado porque ainda é usado para criar diretórios pai em `acquireLock()` e `writeAtomic()`.

---

### B-2 — Filtro de `--background` cobre sintaxe `--background=true`

**Arquivo:** `packages/core/src/cli/commands/check.ts`

```ts
// antes
.filter((arg) => arg !== '--background')

// depois
.filter((arg) => arg !== '--background' && !arg.startsWith('--background='))
```

Evita recursão infinita quando usuário passa `--background=true` em vez de `--background`.

---

### B-3 — Stryker inclui exit code na mensagem de erro

**Arquivo:** `packages/checks/stryker/src/stryker.ts`

```ts
// antes
errorMessage: runResult.stderr || 'failed to generate or read stryker report'

// depois
errorMessage: `exit ${runResult.exitCode}: ${runResult.stderr || 'failed to generate or read stryker report'}`
```

Exit code 1 (thresholds violados), 2 (config inválida) e outros são agora visíveis na mensagem.

**Testes atualizados em `stryker.test.ts`:**

- Asserção trocada de `toBe('stryker error')` para `toContain('exit 1')` + `toContain('stryker error')`.

---

### B-4 — Invariante de `mergeCheckResult` documentada

**Arquivo:** `packages/core/src/cli/commands/baseline.ts`

Adicionado comentário acima de `mergeCheckResult` documentando a invariante "um check id roda em exatamente um tier" que previne conflito de métricas. Se um check futuro quebrar essa invariante, o desenvolvedor tem contexto para detectar antes de introduzir duplicação silenciosa.

---

### B-5 — Orientação de migração de schema adicionada

**Arquivo:** `packages/core/src/baseline/schema.ts`

Adicionado comentário de cabeçalho com instrução: ao bumpar `schemaVersion`, adicionar `migrateFromPrevious(raw)` antes do `parse`, e emitir mensagem de erro útil quando o schema lido for maior que o suportado (`"upgrade Sentiness to read baseline schema X.Y"`).

---

### B-6 — Comentário em `JobSpawner.spawn` sobre `writeFile('')`

**Arquivo:** `packages/core/src/jobs/spawner.ts`

Esclarecido que as chamadas `writeFile('', '')` antes do `open()` existem para compatibilidade com `InMemoryFileSystem` nos testes. Em produção, `open(path, 'a')` já cria o arquivo; a chamada é redundante mas inofensiva.

---

## Verificação final

```
pnpm test      → 163 testes, todos passando (8 pacotes)
pnpm test:e2e  → 13 testes E2E, todos passando
pnpm lint      → 0 erros
pnpm typecheck → 0 erros (8 pacotes)
```
