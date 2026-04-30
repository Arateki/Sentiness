---
name: Auditoria pós-Fase G — pendências de arquitetura e lógica
description: Análise do estado pós-Fase G antes de iniciar Phase H, com pendências classificadas por severidade
type: project
---

# Auditoria pós-Fase G — pendências de arquitetura e lógica

Data: 2026-04-29
Revisor: Claude (Opus 4.7, contexto 1M)
Escopo: estado do código após Phase G concluída e handoff em `docs/next-agent-handoff.md`. O foco aqui não é repetir os achados já fechados nas auditorias `post-phase5-*.md`; é mapear o que ainda está aberto, o que ficou inconsistente após o sprint corretivo, e o que merece decisão **antes** de Phase H começar (porque adiciona seis check packages novos que podem cristalizar dívidas).

Este documento **não altera código**. Cada item lista localização, sintoma observável, causa raiz e proposta — para que o próximo agente decida.

---

## Sumário executivo

| Severidade | Quantidade | Resumo |
|---|---|---|
| Crítico | 2 | Lógica incorreta em fluxo documentado (regressão silenciosa de baseline; sinal de bloqueio inconsistente para o agente) |
| Alto | 4 | Phase H vai amplificar a dívida se não decidirmos antes (validação de `checkConfig`, `--diff` file-level, semântica de `--trend` no report, `--metric` força ratchet pra baixo) |
| Médio | 5 | Gaps reais que afetam operação local e robustez (lock sem TTL, mutação em `read`, `doctor` semi-falso para Coverage, `accept` caro, doc do escape Stryker) |
| Baixo | 6 | Cheiros e edge cases isolados |

Recomendação: fechar **C-1, C-2 e A-1** (≈ meio dia) antes de abrir branches de Phase H. Os demais podem virar follow-ups documentados, mas A-2 a A-4 devem ser **decididos** (não necessariamente implementados) antes que os 6 checks novos repitam o mesmo padrão.

---

## 1. Críticos

### C-1 — `baseline update --metric=<x>` força ratchet "para baixo" e esconde regressões

**Severidade:** Crítico
**Localização:** `packages/core/src/cli/commands/baseline.ts:174-184`

**Código atual:**

```ts
const improved =
  baselineMetric.direction === 'higher-is-better'
    ? currentMetric.value > baselineMetric.value
    : currentMetric.value < baselineMetric.value;

if (improved || targetMetric === metricKey) {
  updatedMetrics[metricKey] = { ...baselineMetric, value: currentMetric.value };
  updatedCount++;
}
```

A condição `targetMetric === metricKey` força a atualização **mesmo se o valor regrediu**. O comentário inline na linha 162 (`Skip if a specific metric was requested and this is not it`) trata o filtro por nome corretamente, mas o comportamento subsequente quebra a noção de "ratchet".

**Sintoma observável:**

1. Coverage cai de `90` para `60`.
2. Usuário (ou pior, agente) roda `sentiness baseline update --metric=coverage.lineCoverage` para "ajustar" alegando que era para subir.
3. Baseline grava `{ value: 60 }`. A regressão fica engolida sem aviso.
4. Próximas runs comparam contra `60` e dizem "tudo certo".

Isso viola a regra inegociável §3.7 do `CLAUDE.md`: *"Never modify `sentiness.config.js` or `.sentiness/baseline.json` to make a check pass"*. O CLI hoje convida a violação.

**Causa raiz:** confusão entre dois casos legítimos: "adicionar métrica nova ao baseline" (a primeira vez que ela aparece) e "ratchet quando melhorou". O alvo `targetMetric === metricKey` foi colocado como atalho para o primeiro caso, mas pega o segundo de carona.

**Proposta:**

- Manter a regra: ratchet só quando `improved`.
- Adicionar uma flag explícita `--force` para sobrescrever, com mensagem WARN no logger antes do save (`Forcing metric "%s" to regress: <baseline> → <current>. This is non-idempotent and may hide real regressions.`).
- Para "adicionar métrica nova", continuar permitindo (a checagem `if (!baselineMetric)` na linha 167-171 já cobre isso).

**Aceite:**

- [ ] `baseline update --metric=foo` quando o valor piorou retorna exit code não-zero ou pelo menos emite WARN visível e **não** sobrescreve sem `--force`.
- [ ] Novo teste em `baseline.test.ts` verificando os três casos: melhorou, piorou sem `--force`, piorou com `--force`.

---

### C-2 — `agentInstructions.blocking` ignora `summary.status === 'error'`

**Severidade:** Crítico (consumidor primário é um agente lendo JSON, não um humano lendo exit code)
**Localização:**
- `packages/core/src/reporter/reporter.ts:129-131, 155`
- `packages/core/src/reporter/agent-instructions.ts:36-41`

**Código atual:**

```ts
// reporter.ts
const checksErrored = checks.filter((check) => check.status === 'error').length;
const status = checksErrored > 0 ? 'error' : findings.length > 0 ? 'violations' : 'ok';
// ...
summary: {
  status,                              // 'error' quando algum check falhou
  // ...
  blocking: instructions.blocking,     // só considera findings, ignora status
}
```

```ts
// agent-instructions.ts
return {
  blocking: mustFix.length > 0,        // findings de severity error|warning(promovido)
  mustFix,
  shouldFix,
  informational,
};
```

Cenário concreto:

1. Biome não está instalado, retorna `status: 'error'` com zero findings.
2. Reporter calcula `summary.status = 'error'`, `summary.totals.error = 0`, `summary.blocking = false`.
3. `exitCodeFor` retorna `3` (correto para CI).
4. Agente que lê `summary.blocking` no JSON vê `false` e considera "tudo OK", ignorando a falha de tooling.

A spec da skill template (`@sentiness/adapters` §3) ensina o agente a olhar `summary.blocking` como sinal primário. O sinal está mentindo para o agente, mesmo que esteja correto para CI.

**Proposta:**

Em `agent-instructions.ts` (ou no reporter, antes de montar `summary.blocking`), incluir o status de erro:

```ts
// reporter.ts
summary: {
  status,
  // ...
  blocking: instructions.blocking || status === 'error',
}
```

E `agentInstructions.mustFix` deve ganhar entradas do tipo `[error] check '<id>' failed: <errorMessage>` quando há check em erro de tooling, para o agente ter algo acionável (instalar a ferramenta, corrigir o config) em vez de tratar como findings. A informação já existe em `result.errorMessage`; basta o reporter passá-la ao `buildAgentInstructions`.

**Aceite:**

- [ ] Cenário `1 check errored, 0 findings` → `summary.blocking === true` e `agentInstructions.mustFix` lista a falha.
- [ ] Cenário `0 errored, 1 violation` → comportamento atual (sem regressão).
- [ ] Teste novo em `reporter.test.ts` cobrindo os dois.

Esse item já foi proposto como §4.6 em `post-phase5-claude-followup.md` mas não foi fechado.

---

## 2. Altos

### A-1 — `--trend` mode reporta `baseline.applied: false` no JSON

**Severidade:** Alto (contrato JSON visível ao agente)
**Localização:** `packages/core/src/baseline/diff-filter.ts:115-145`

**Código atual:**

```ts
const isTrend = outcome.context.mode === 'trend';
// ...
return {
  // ...
  baselineApplied: !isTrend && baseline !== undefined,
  // ...
};
```

Em trend mode, mesmo com baseline carregado e aplicado conceitualmente (na supressão dos findings e na comparação de métricas), o reporter expõe `baseline.applied: false`. O agente lendo o JSON vê:

```json
{
  "context": { "mode": "trend" },
  "baseline": { "applied": false, "path": ".sentiness/baseline.json", "suppressedFindings": 0 },
  "trend": { "available": true, "regressions": [...] }
}
```

Isso é contraditório: há `path` e `regressions`, mas `applied: false`. A intenção era distinguir "modo full com baseline" de "modo trend onde findings são suprimidos por desenho", mas o sinal escolhido (`applied`) é semântico errado.

**Causa raiz:** §4.1 do `post-phase5-claude-followup.md` recomendou tornar `--trend` semanticamente útil, e o sprint implementou isso suprimindo findings. Mas o campo `baselineApplied` ficou com a sobrecarga de "indica que findings foram filtrados pela baseline", o que diverge do significado óbvio "estou usando o baseline".

**Proposta:**

Renomear ou adicionar um campo:

- Manter `baseline.applied: true` sempre que o baseline foi carregado e considerado.
- Adicionar `baseline.mode: 'suppress' | 'metrics-only' | 'none'` (ou similar) para descrever **como** ele foi usado.
- Atualizar `ReportSchema` e o template da skill (`@sentiness/adapters/src/skill-template.md`) para o agente entender.

Esse é um item barato (uma rodada de schema bump + reporter update + adapter doc), mas precisa decidir antes de Phase H porque o template da skill é congelado em `TEMPLATE_VERSION`.

**Aceite:**

- [ ] `Report.baseline` distingue claramente carregado-mas-modo-trend de não-aplicado.
- [ ] Skill template explica o novo campo.
- [ ] `TEMPLATE_VERSION` bumpada.

---

### A-2 — `checkConfig` validação ad hoc, sem contrato no SDK

**Severidade:** Alto (Phase H adiciona 6 checks que repetirão o padrão)
**Localizações:**
- `packages/check-sdk/src/types.ts:151-163` (CheckContext sem `configSchema`)
- `packages/checks/coverage/src/coverage.ts:80` (Zod safeParse parcial)
- `packages/checks/stryker/src/stryker.ts:51` (typeof === 'string' inline)
- `packages/checks/knip/src/knip.ts` (sem validação)
- `packages/checks/biome/src/biome.ts` (sem validação)

**Sintoma:**

Cada check valida `ctx.checkConfig` à sua maneira:

- Coverage tem `ThresholdConfigSchema.safeParse(config.thresholds)`, mas só valida `thresholds`. Outros campos passam silenciosamente.
- Stryker valida só `reportPath` por `typeof reportPath === 'string'`.
- Knip e Biome não validam — usam `ctx.checkConfig` apenas se a config define algo, mas nada quebra se vier inválido.
- Erros de config se manifestam como findings vazios ou comportamento default surpreendente, não como exit code não-zero com mensagem.

**Causa raiz:** o SDK declara `checkConfig: Record<string, unknown>` (linha 162 de `types.ts`) e deixa cada check virar uma loteria. A spec não obriga uma forma; a §4.7 de `post-phase5-claude-followup.md` propôs um `configSchema?` no `Check`, mas foi adiada para "antes da Fase 8".

A Phase H adiciona dependency-cruiser, osv-scanner, lockfile-lint, deps-diff, jscpd, semgrep — todos com config rica (rules, allowed-hosts, severity overrides, paths). Sem contrato, são 6 oportunidades novas de validação ad hoc.

**Proposta:**

Estender `Check` com um campo opcional:

```ts
export type Check<TConfig = Record<string, unknown>> = {
  // ...
  readonly configSchema?: { parse(input: unknown): TConfig };
  // ...
};
```

O runner valida `check.configSchema?.parse(rawConfig)` antes de chamar `run`; falhas viram `CheckResult.status: 'error'` com mensagem que cita o path do issue. Migrar Coverage e Stryker imediatamente (são pequenos). Documentar em `docs/writing-a-check.md` que novos checks devem declarar.

**Aceite:**

- [ ] SDK ganha `configSchema?` com tipos parametrizáveis.
- [ ] Runner aplica antes de `run`.
- [ ] Coverage e Stryker migrados.
- [ ] Doc atualizado.

Decidir agora reduz o custo de migrar os 6 novos checks da Phase H.

---

### A-3 — `--diff` ainda é file-level, não hunk-level

**Severidade:** Alto (qualidade de sinal para o agente)
**Localização:** `packages/core/src/baseline/diff-filter.ts:50` e em cada check (Coverage, Knip filtram por `changedSet.has(file)`)

**Estado:** documentado em `docs/next-agent-handoff.md` como decisão deliberada de adiar para depois da Phase H. A análise do agente anterior é:

> Phase H increases coverage and usefulness now. Current `--diff` is good enough as a first slice and is documented as file-level.

Endosso com ressalva: a spec T2.3 (`CLAUDE.md`) e a documentação pública (`docs/baseline-strategy.md`) prometem que `--diff` filtra "findings novos relativo ao baseline". Em projetos com arquivos de 500+ linhas, qualquer touch num arquivo grande dispara findings antigos como "novos" — sintomas reais que o agente confunde com regressão sua.

**Proposta:**

Confirmar que Phase H é prioridade e A-3 fica para Phase I. Mas:

1. Garantir que **todos** os novos checks da Phase H emitam `location.startLine` quando o tool fornecer (deps-diff/osv-scanner/lockfile-lint têm dependências sem arquivo, mas dependency-cruiser/jscpd/semgrep têm linha). Documentar como hard requirement em `docs/writing-a-check.md`.
2. Após Phase H, implementar parsing de hunks em `GitProvider` (`changedRanges(cwd, baseRef): Promise<readonly { file: string; ranges: { start: number; end: number }[] }[]>`), e atualizar `applyBaseline` para usar.

**Aceite (para Phase H, não para esta auditoria):**

- [ ] Cada check novo da Phase H tem teste comprovando `location.startLine` quando aplicável.

---

### A-4 — `agents` config não controla `install-skill --agent=all`

**Severidade:** Alto (contrato de config é prometido mas inerte)
**Localizações:**
- `packages/core/src/config/config.ts:49, 78, 184` — define `agents: ('claude-code' | 'codex' | 'gemini')[]`
- `packages/core/src/cli/commands/install-skill.ts` (não lido nesta auditoria, mas a leitura cruzada é direta)
- `CLAUDE.md` §T1.1: `agents` field documented as "consumed by install-skill --agent=all and the init wizard"

**Sintoma esperado:**

Spec promete que `agents: ['claude-code']` em `sentiness.config.json` faz `install-skill --agent=all` instalar **só** Claude Code. Implementação atual (a julgar pelo registry de adapters em `packages/adapters/src/index.ts` e seu listAdapters) provavelmente itera todos os adapters disponíveis sem consultar o config.

Isso pode ser bug ou divergência de spec. Worth verificar antes de Phase H mexer no install-skill UX.

**Proposta:**

1. Confirmar comportamento atual com teste E2E ou leitura.
2. Se inerte, dois caminhos: (a) implementar filtro pelo config; (b) atualizar `CLAUDE.md` para refletir comportamento real.

**Aceite:**

- [ ] Decisão registrada num ADR ou no progress.md.
- [ ] Comportamento e doc estão alinhados.

---

## 3. Médios

### M-1 — `PendingQueue` lock dir não tem TTL nem detecção de stale

**Severidade:** Médio
**Localização:** `packages/core/src/pending/pending.ts:55-77`

`acquireLock` cria `${path}.lock/` com `mkdir`. Se o processo morrer (Ctrl+C, kill -9, OOM) entre `acquireLock` e `releaseLock`, o lock dir fica órfão. Próxima invocação vai tentar 5 vezes com backoff exponencial (50, 100, 200, 400, 800 ms) e depois lançar `PendingQueueLockError`. Total: ~1.5s travados, depois falha hard sem caminho de recuperação.

**Proposta:**

Adicionar marker de PID e timestamp dentro do lock dir:

```ts
await this.fs.writeFile(join(this.lockDir, 'owner'), JSON.stringify({
  pid: process.pid,
  acquiredAt: this.clock.isoNow(),
}));
```

Em `acquireLock`, antes de tentar criar, se o lock dir existe e o `owner.pid` está morto (ou `acquiredAt > 10 minutos atrás`), remover o lock e retentar. Logar WARN ao remover stale.

**Aceite:**

- [ ] Stale lock auto-recuperado.
- [ ] Test simulando processo morto durante operação.

---

### M-2 — `JobReader.read` muta `meta.json` em "read"

**Severidade:** Médio (race condition + violação semântica)
**Localização:** `packages/core/src/jobs/status.ts:50-55`

```ts
if (meta.status === 'running') {
  if (!this.isAlive(meta.pid)) {
    const updated = { ...meta, status: 'failed' as const, exitCode: -1 };
    await this.fs.writeFile(metaPath, `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
  }
}
```

Métodos `read*` mutando estado quebram a previsibilidade do CLI. Dois agentes lendo `status` simultaneamente podem racear no `writeFile`. PID reuse (já anotado em `post-phase5-claude-followup.md` §AUD-4.6) torna `isAlive` impreciso, então a mutação pode marcar `failed` um job que ainda está vivo após PID reciclado pelo OS.

**Proposta:**

- Separar reconciliação (`reconcile()` explícito, chamado por `list`/`status` antes de retornar) da leitura pura.
- Ou, mais simples: tornar a mutação opcional via flag `JobReader.read(jobId, { reconcile: true })` e, no CLI, só reconciliar em pontos onde isso faz sentido (`status` sim, `list` sim, leitura interna do background spawner não).

**Aceite:**

- [ ] `read` puro.
- [ ] `reconcile` explícito coberto por teste.

---

### M-3 — `Coverage.detect()` sempre retorna `available: true`

**Severidade:** Médio
**Localização:** `packages/checks/coverage/src/coverage.ts:104-107`

```ts
async detect(_ctx) {
  return { available: true };
},
```

Resultado: `sentiness doctor` reporta Coverage como `ok`, mas se não há `coverage/coverage-final.json`, o `run` retorna `status: 'skipped'`. Discrepância entre `doctor` (tudo verde) e `check` (skipped). Minimamente confuso.

**Proposta:**

`detect` checa se `coverage/coverage-final.json` existe; se não, `available: false, reason: 'no Istanbul coverage report at <path>; configure Vitest/Jest to emit one'`. Custo: uma chamada de `fs.exists` no detect.

**Aceite:**

- [ ] `doctor` reporta Coverage indisponível quando não há report; `check` continua skipping com mesma mensagem.

---

### M-4 — `baseline accept` pode rodar Stryker sem necessidade

**Severidade:** Médio (perf)
**Localização:** `packages/core/src/cli/commands/baseline.ts:113-127`

`findFindingByFingerprint` itera `['fast', 'standard', 'slow']` e roda `runChecks` por tier até achar o fingerprint. Aceitar finding do Biome (fast tier) é rápido; aceitar finding do Stryker (slow) força rodar fast e standard antes. Em projetos onde `slow` leva minutos, qualquer tentativa de aceitar finding em fast tier paga apenas o fast — OK. Mas o usuário não tem como dizer "sei que é fast, não rode standard nem slow".

**Proposta (já em §4.3 do follow-up):**

Adicionar `--tier=<fast|standard|slow>` em `baseline accept` (default `fast`). Se não achar, mensagem WARN sugerindo `--tier=standard`. Custo baixo, ganho real para o agente que usa o comando interativamente.

**Aceite:**

- [ ] Flag implementada e documentada em `docs/baseline-strategy.md`.

---

### M-5 — Escape hatch do Stryker (`reportPath`) não é documentado

**Severidade:** Médio
**Localização:**
- `packages/checks/stryker/src/stryker.ts:50-53` — implementado
- `packages/checks/stryker/README.md` (não lido nesta auditoria)
- `docs/writing-a-check.md` (não lido)

Spec T5.5 diz que Sentiness lê `stryker.conf.js`. O sprint corretivo decidiu não importar `.js`/`.mjs` por segurança e oferecer dois fallbacks: `stryker.conf.json`/`stryker.config.json` e `checkConfig.reportPath`. Mas a maioria de usuários reais Stryker usa `.mjs` ou `.cjs`. Sem doc, eles vão ver "failed to generate or read stryker report" e desistir.

**Proposta:**

1. Em `packages/checks/stryker/README.md`, documentar os três caminhos: JSON config, `checkConfig.reportPath` em `sentiness.config.json`, fallback default.
2. No `init` wizard, quando detecta `stryker.conf.{js,mjs,cjs}` mas não JSON, perguntar "Stryker report path?" e gravar em `checks.stryker.reportPath`.

**Aceite:**

- [ ] README do `@sentiness/check-stryker` cobre os três caminhos com exemplo.
- [ ] Wizard pergunta quando aplicável.

---

## 4. Baixos

### B-1 — `pending.ts:47` declara `_dir` não utilizado

**Localização:** `packages/core/src/pending/pending.ts:47`

```ts
constructor(...) {
  const _dir = dirname(path);
  this.lockDir = `${path}.lock`;
}
```

`_dir` é resíduo. A intenção provavelmente era `this.dir = dirname(path)`. Remover ou usar. Já listado como §4.8 do follow-up de Claude e não foi limpo.

---

### B-2 — `originalArgs` filtra apenas `--background` literal

**Localização:** `packages/core/src/cli/commands/check.ts:74`

```ts
const originalArgs = process.argv.slice(2).filter((arg) => arg !== '--background');
```

Se alguém passar `--background=true` (sintaxe alternativa do `cac`), o filtro não bate e o child recebe `--background=true`, recursando. Edge case raro mas existe. Solução: também filtrar `arg.startsWith('--background=')`.

---

### B-3 — `Stryker.run` ignora `runResult.exitCode` no errorMessage

**Localização:** `packages/checks/stryker/src/stryker.ts:130-137`

Quando o report não existe, `errorMessage: runResult.stderr || 'failed to generate or read stryker report'`. Não inclui o exit code do stryker, que muitas vezes é o sinal mais útil (`1` = thresholds violados, `2` = config inválida, etc.). Incluir `exit ${runResult.exitCode}: ${runResult.stderr || 'no stderr'}`.

---

### B-4 — `mergeCheckResult` em `baseline.ts` faz spread de `metrics` que pode duplicar entradas

**Localização:** `packages/core/src/cli/commands/baseline.ts:58-73`

`mergeCheckResult` é chamado quando o mesmo check id aparece em mais de uma run (pelos três `runTier`). Hoje um check só roda no seu defaultTier (ou no `tier` configurado), então isso não acontece. Mas se a Phase H adicionar um check que possa rodar em múltiplos tiers (ex.: deps-diff em fast E standard), o merge sobrescreve métricas silenciosamente. Documentar a invariante "um check id, um tier" ou refatorar `mergeCheckResult` para detectar conflitos.

---

### B-5 — `schemaVersion: '1.0'` é literal sem migração

**Localizações:**
- `packages/core/src/schema/report.ts`
- `packages/core/src/baseline/schema.ts`

Se um futuro bump para `'1.1'` ou `'2.0'` quebrar parse, o usuário perde baseline e fica com erro hard. Adicionar lógica de migração ou pelo menos mensagem de erro útil ("upgrade Sentiness to read baseline schema 1.1") quando o schema é maior que o conhecido.

---

### B-6 — `JobSpawner.spawn` cria stdout/stderr files via `fs.writeFile('')` antes de `open()`

**Localização:** `packages/core/src/jobs/spawner.ts:30-31`

```ts
await this.fs.writeFile(stdoutPath, '');
await this.fs.writeFile(stderrPath, '');
```

Esse `writeFile('')` foi adicionado para satisfazer testes com `InMemoryFileSystem`. Em produção, o `open(path, 'a')` que vem em seguida cria o arquivo se não existir, então o `writeFile('')` é redundante. Pequeno custo de I/O extra; se algum dia migrar para outro file system mock, lembrar disso. Comentar ou remover via condicional baseada em `fs` capabilities.

---

## 5. Pontos positivos

Para balancear:

- O sprint corretivo pós-Fase 5 fechou os 30 itens da auditoria original sem regressões. Validei reproduzindo a tabela do `post-phase5-claude-followup.md` por amostragem (`SENTINESS_VERSION` lido de `package.json`, `BaselineSnapshotSchema` Zod aplicado em `load`, `wrapWithPositionals` em `registry.ts`, `effectiveTier` separado para background, `compareMetrics` integrado em `applyBaselineToOutcome`).
- Phase G entregou E2E sólido (13 testes em `packages/core/test/e2e/full-flow.test.ts`), CI workflow e release-package guards.
- Os checks (Biome, Knip, Coverage, Stryker) seguem o template de forma consistente: `detect`, `run`, `normalize`, fingerprint via `@sentiness/check-sdk`, testes via `FakeProcessRunner`. A repetição é intencional e ajuda revisores externos.
- O `install-hooks` do sprint corretivo cobre os três principais hook managers e deixa fallback explícito; idempotência por marker é uma boa decisão.

---

## 6. Roadmap sugerido (não-bloqueante)

**Antes de Phase H (≈ meio dia):**

1. C-1: corrigir `baseline update --metric=foo` ratchet semantics + flag `--force`.
2. C-2: `agentInstructions.blocking` reflete `summary.status === 'error'`.
3. A-1: decidir nome de `baseline.applied` em trend mode; bumpar `TEMPLATE_VERSION` se for renomear.

**Decidir antes de Phase H (não necessariamente implementar):**

4. A-2: `configSchema?` no SDK; documentar no `writing-a-check.md` para novos checks adotarem.
5. A-4: `agents` config controla install-skill ou doc atualizada.

**Durante Phase H (incorporar como hard requirement):**

6. Cada check novo emite `location.startLine` quando aplicável (preparar terreno para A-3).
7. Cada check novo declara `configSchema?` se A-2 for em frente.

**Pós-Phase H:**

8. A-3: hunk-level `--diff` (parsing de hunks no GitProvider).
9. M-1, M-2, M-3, M-4, M-5 e os baixos como follow-ups individuais.

---

## 7. Como aplicar este documento

- Cada PR de correção referencia o ID (C-1, A-2, etc.) que fecha.
- Se um item parecer errado ou desnecessário, comentar neste arquivo com a divergência **antes** de implementar diferente — o `CLAUDE.md` §13 cobre isso.
- Após cada fix, atualizar `docs/progress.md` com a referência.
