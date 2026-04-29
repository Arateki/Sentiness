# Revisao pos-Fase 5 - segunda opiniao Codex

Data: 2026-04-29
Revisor: Codex
Escopo: revisao do `docs/post-phase5-audit.md` contra `CLAUDE.md`, `docs/progress.md`,
a implementacao atual e comandos locais. Este arquivo nao implementa correcoes; ele organiza
concordancias, divergencias e achados adicionais para um sprint corretivo coordenado.

Status das verificacoes feitas nesta revisao:

- `pnpm typecheck`: passa.
- `pnpm test`: passa.
- `pnpm build`: passa.
- `pnpm lint`: falha em `packages/core/.sentiness-test-registry/package.json`, confirmando o
  lixo persistente gerado por teste.
- `pnpm sentiness check --trigger=post-edit --compact`: falha com
  `Trigger "post-edit" belongs to "fast", not "standard"`.
- `pnpm sentiness check --background --tier=fast --compact`: retorna `{ jobId }`, mas o job
  criado aponta para `packages/core/dist/cli/commands/check.js`, nao escreve `result.json` e
  deixa `meta.json` como `running`.
- `pnpm sentiness status <jobId>`: falha com mensagem de uso, por bug de argumentos
  posicionais no wrapper do `cac`.
- `pnpm sentiness pending ack fake-id`: imprime `[]` em vez de tratar `ack`, pelo mesmo bug
  de argumentos posicionais.
- `pnpm sentiness doctor`: retorna `ok: true`, mesmo com `pnpm exec stryker --version`
  falhando por comando ausente.
- `git check-ignore -v packages/checks/coverage/src/coverage.ts`: mostra que o pacote
  `packages/checks/coverage` esta sendo ignorado por `.gitignore:3:coverage/`.

Convencoes deste documento:

- Itens novos usam ID `COD-<secao>.<numero>`.
- Itens do arquivo anterior continuam referidos como `AUD-x.y`.
- Severidades seguem o mesmo modelo do `post-phase5-audit.md`.

---

## Sumario executivo

Minha conclusao: o `post-phase5-audit.md` faz sentido no diagnostico geral. A Fase 5 nao deve
ser considerada pronta para abrir Fase 6 sem um sprint corretivo. O arquivo anterior acerta
principalmente nos bugs de trigger-only, background jobs, metric regressions nao integradas,
truncacao sem severidade, baseline sem validacao real e `install-hooks` destrutivo.

Mas ele tambem deixa passar tres bloqueadores praticos:

1. O pacote `@sentiness/check-coverage` existe no workspace local, mas esta ignorado por Git e
   por Biome. Um clone limpo provavelmente quebra o workspace porque `package.json` e
   `pnpm-lock.yaml` referenciam um pacote que nao seria commitado.
2. `sentiness status <jobId>` e `sentiness pending ack <id>` estao quebrados por registro
   incorreto de comandos com argumentos posicionais no `cac`. Isso invalida a afirmacao de que
   a Fase C esta operacional via CLI.
3. Um check com `status: "error"` e zero findings produz `summary.status: "error"`, mas
   `exitCodeFor` pode retornar `0`. Isso transforma falha de ferramenta em sucesso de CI.

Tambem ha algumas divergencias de prioridade/design: `--trend` como nova flag nao aparece na
lista de comandos da spec; `randomUUID` e permitido pela propria spec quando nao ha ULID lib;
e os criterios finais baseados em `grep packages/*/src` nao cobrem pacotes nested como
`packages/checks/biome`.

---

## 1. Onde concordo com o post-phase5

### AUD-1.1 - Trigger-only quebrado

Concordo integralmente.

Evidencia atual:

- `packages/core/src/cli/commands/check.ts:38` faz
  `const tier = parseTier(args.tier) ?? 'standard'`.
- `packages/core/src/runner/runner.ts:72-82` ja sabe resolver o tier a partir do trigger.
- `pnpm sentiness check --trigger=post-edit --compact` falhou com
  `Trigger "post-edit" belongs to "fast", not "standard"`.

Impacto: todo trigger que nao seja `pre-done` tende a falhar quando usado sem `--tier`, apesar
da spec em T4.1 dizer que trigger sozinho deve resolver o tier pela config.

Prioridade: hotfix.

---

### AUD-1.2 - Background mode nao fecha round-trip

Concordo com o diagnostico e subi a prioridade por causa do bug adicional `COD-1.2`.

Evidencia atual:

- `check.ts:43-46` tenta transformar o caminho do proprio modulo com regex de `src/*.ts`.
  No build, `import.meta.url` aponta para `dist/cli/commands/check.js`, entao o regex nao
  casa.
- O job testado gravou `args[0]` como
  `packages/core/dist/cli/commands/check.js`, que nao registra a CLI.
- O placeholder `<jobId>` so e substituido em `meta.json` depois de `spawn`; o processo filho
  ja recebeu argv literal.
- O job criado nao escreveu `result.json` e permaneceu `running` no arquivo.

Nota sobre o fix proposto no outro arquivo: `import.meta.resolve('@sentiness/core/cli')` nao
serve sem alterar `packages/core/package.json`, porque o pacote so exporta `"."` e so declara
`bin.sentiness`. A abordagem mais robusta e passar o caminho do entrypoint da CLI pelo boundary
do CLI (`process.argv[1]` em `main`, injetado em deps) ou registrar um subpath exportado de
forma explicita. O comando `check` nao deveria tentar inferir o entrypoint a partir do modulo
do subcomando.

Prioridade: hotfix/estrutural antes de qualquer trabalho de adapters.

---

### AUD-1.3 - Metric regressions nunca entram no report

Concordo.

Evidencia atual:

- `packages/core/src/baseline/diff-filter.ts:64-88` implementa `compareMetrics`.
- `applyBaselineToOutcome` retorna `metricRegressions: []` hardcoded em
  `diff-filter.ts:118-124`.
- Nao existe `packages/core/src/baseline/diff-filter.test.ts`.

Impacto: `report.trend.available` so fica `true` quando o reporter recebe regressions
manualmente em teste. O fluxo CLI nunca produz regressao de metrica.

Prioridade: alta, junto com testes de diff-filter.

---

### AUD-1.5 - Truncacao ignora severidade

Concordo.

Evidencia atual:

- `packages/core/src/reporter/reporter.ts:47-60` usa `findings.slice(0, maxFindings)`.
- A spec T1.4 exige "keep top N by severity".
- `reporter.test.ts` so testa 60 findings com a mesma severidade, entao nao pega perda de
  errors quando warnings aparecem primeiro.

Prioridade: hotfix simples.

---

### AUD-1.6 e AUD-2.1 - Baseline e JSON persistido sem validacao real

Concordo.

Evidencia atual:

- `BaselineManager.load` so confere `schemaVersion` e retorna `parsed as BaselineSnapshot`.
- `JobReader.read`, `JobReader.readResult`, `PendingQueue.readAtomic` e coverage parsing
  tambem fazem parse sem schema.
- Isso viola a regra da spec sobre casts em boundary sem validacao subsequente.

Prioridade: alta, especialmente baseline, jobs e pending feedback.

---

### AUD-2.2 - Catches mudos

Concordo com o problema, mas recomendo aplicar com cuidado.

Os casos que mais precisam mudar:

- `PendingQueue.readAtomic`: arquivo corrompido virando fila vazia e perda silenciosa de
  feedback.
- `JobReader.read` e `readResult`: metadata ou result corrompido virando "job nao existe".
- `Stryker getReport`: parse ou schema invalido vira "report ausente".

Para cache de linha em Biome/Knip, degradar para string vazia pode ser aceitavel, mas deve
logar em `debug` para nao esconder problemas reais de path.

---

### AUD-3.1, AUD-3.2, AUD-3.3 - Gaps de onboarding

Concordo.

Pontos confirmados:

- `install-hooks` escreve direto em `.git/hooks/pre-commit` e usa `pnpm` hardcoded.
- `doctor` so lista checks registrados; nao chama `detect()`.
- `init` pergunta apenas sobre Biome, apesar de Knip, Coverage e Stryker ja existirem no
  workspace local.

Esses itens podem vir depois dos bugs de corretude, mas antes de chamar o produto de
dogfood-ready.

---

### AUD-3.5 e AUD-5.1 - Atomic save e lixo de teste

Concordo.

- `BaselineManager.save` usa `writeFile` direto; `PendingQueue.writeAtomic` ja tem o pattern
  correto com temp + rename.
- `registry.test.ts` cria `packages/core/.sentiness-test-registry` dentro do repo e nao limpa.
  Isso quebra `pnpm lint` e tambem `sentiness check --tier=fast`.

Prioridade: AUD-5.1 e hotfix. AUD-3.5 e hardening importante.

---

## 2. Onde discordo ou ajusto prioridade

### AUD-1.4 - `metricSpecs` no SDK e uma boa direcao, mas nao precisa bloquear Fase 6

Concordo com o problema de origem: `BaselineManager.createFromOutcome` e
`baselineUpdateCommand` assumem `higher-is-better` para toda metrica numerica.

Minha divergencia e de prioridade e desenho:

- Hoje as metricas implementadas (`coverage.lineCoverage` e `stryker.mutationScore`) sao
  de fato `higher-is-better`.
- O risco explode quando entrarem metricas de contagem como duplicacao, complexidade,
  surviving mutants ou tamanho de bundle.
- Adicionar `metricSpecs` ao `Check` e razoavel, mas nao e necessario para os adapters da Fase
  6. E necessario antes de Phase H ou antes de qualquer metrica `lower-is-better`.

Proposta: manter a tarefa no sprint corretivo se houver apetite para mudar o SDK agora, mas
nao tratar como bloqueador dos adapters. Se for feita agora, incluir teste que prova que uma
metrica `lower-is-better` salva baseline com direcao correta e ratchet correto.

---

### AUD-1.7 - Trend mode existe conceitualmente, mas `--trend` nao esta especificado

Concordo que `RunContext.mode` nunca vira `"trend"` e que o schema tem esse valor.

Minha divergencia: o `CLAUDE.md` lista o comando `sentiness check` com `--diff`, mas nao lista
`--trend`. O texto de T2.3 diz "In trend mode" como semantica de metric regressions, mas a
interface publica de `applyBaselineToOutcome` ainda recebe apenas `diffOnly: boolean`.

Proposta menor e mais segura:

1. Primeiro integrar `compareMetrics` no fluxo atual.
2. Decidir se regressao de metrica aparece em todo run com baseline ou apenas quando uma flag
   explicita for passada.
3. So entao introduzir `RunOptions.mode` e talvez `--trend`.

Classificacao: gap de produto medio/alto, nao hotfix critico enquanto metric regressions nem
estao integradas.

---

### AUD-2.3 - `console.log` no Prompter viola regra, mas nao e mais urgente que o resto

O `console.log` em `Prompter.choice` deve sair porque a spec diz que command handlers escrevem
por stdout injetado. Mas `init` e comando interativo e nao produz report JSON. O risco de
contaminar a saida do `check` e baixo.

Classificacao sugerida: serio por regra, mas ordem depois de trigger, background, status,
pending, lint residual, baseline validation e exit code de erro.

---

### AUD-4.4 - UUID em jobs nao viola a spec

O `post-phase5-audit.md` chama `randomUUID` de cheiro porque ULID seria ordenavel.

Porem o `CLAUDE.md` diz explicitamente em T3.1: "Generate `jobId` via ULID (use
`node:crypto.randomUUID` if no ULID lib; we don't add deps)." Portanto `randomUUID` nao e
violacao da spec.

Se a UX de listagem precisar de ordem, basta ordenar `JobReader.list()` por `startedAt`.
Nao vale introduzir mini-ULID antes de resolver os bugs funcionais.

---

### AUD-4.1 - `durationMs` sobrescrito e cheiro pequeno, nao bloqueador

Concordo que o contrato e estranho: checks retornam `durationMs: 0`, e o runner sobrescreve.
Mas isso nao gera comportamento incorreto hoje e esta longe dos problemas de CLI e baseline.

Proposta: documentar no tipo ou remover de `CheckResult` em uma limpeza de SDK futura.

---

### Criterios de aceite do post-phase5 precisam ser corrigidos

O arquivo anterior sugere comandos como:

```sh
grep -rn "} catch {" packages/*/src --include="*.ts" --exclude="*.test.ts"
```

Esse glob nao cobre `packages/checks/biome/src`, `packages/checks/knip/src`,
`packages/checks/stryker/src` nem o pacote `coverage`. Alem disso, ferramentas que respeitam
ignore podem ocultar `packages/checks/coverage`.

Proposta:

```sh
rg -n --no-ignore "} catch \\{" packages --glob "*.ts" --glob "!**/*.test.ts" --glob "!**/dist/**"
rg -n --no-ignore "console\\." packages --glob "*.ts" --glob "!**/*.test.ts" --glob "!**/dist/**" --glob "!**/scripts/**"
rg -n --no-ignore "as (Report|JobMeta|PendingItem|BaselineSnapshot|RunOutcome|IstanbulReport)" packages --glob "*.ts" --glob "!**/*.test.ts" --glob "!**/dist/**"
```

Tambem e importante que `git check-ignore -v packages/checks/coverage/src/coverage.ts` nao
retorne nada.

---

## 3. Achados adicionais

### COD-1.1 - `packages/checks/coverage` esta ignorado por Git e Biome

- Severidade: Critico
- Localizacao:
  - `.gitignore:3`
  - `biome.json:4`
  - `packages/checks/coverage/*`

Evidencia:

- `git check-ignore -v packages/checks/coverage/src/coverage.ts` aponta para
  `.gitignore:3:coverage/`.
- `git ls-files packages/checks/coverage` nao retorna arquivos.
- `package.json` referencia `@sentiness/check-coverage`.
- `pnpm-lock.yaml` referencia `link:packages/checks/coverage`.
- `pnpm exec biome check packages/checks/coverage --vcs-enabled=false` processa zero arquivos
  porque o proprio `biome.json` exclui `!**/coverage`.

Sintoma:

Um clone limpo nao teria o pacote `@sentiness/check-coverage`, mas o root `package.json` exige
`workspace:*`. Isso tende a quebrar install/build em outra maquina ou CI. Alem disso, o pacote
escapa de lint e de revisao por ignore, escondendo problemas reais como `thresholds?: any` em
`coverage.test.ts` e casts inseguros no parser.

Fix proposto:

1. Ajustar `.gitignore` para ignorar artefatos de coverage sem ignorar o pacote fonte. Exemplo:
   ignorar `/coverage/`, `/packages/*/coverage/` e `/packages/checks/*/coverage/`, mas
   des-ignorar `/packages/checks/coverage/`.
2. Ajustar `biome.json` para nao excluir o pacote fonte `packages/checks/coverage`.
3. Rodar Biome nesse pacote e corrigir formatacao/noExplicitAny.
4. Verificar que `git ls-files packages/checks/coverage/src/coverage.ts` passa a listar o
   arquivo depois do add.

Dependencias: deve vir antes de declarar Phase 5 completa.

---

### COD-1.2 - Comandos com argumentos posicionais estao quebrados no CLI

- Severidade: Critico
- Localizacao:
  - `packages/core/src/cli/commands/registry.ts:18-27`
  - `packages/core/src/cli/commands/registry.ts:54-64`
  - `packages/core/src/cli/commands/status.ts:10-14`
  - `packages/core/src/cli/commands/pending.ts:15-27`

Causa raiz:

`wrap(handler, deps)` assume que a action do `cac` recebe um unico objeto `args`. Isso e
verdade para comandos sem argumentos posicionais, mas `cac` passa posicionais como parametros
separados antes das options.

Sintomas confirmados:

- `pnpm sentiness status d8329203-71ea-42b4-ad14-574760d3dc52` retornou
  `Usage: sentiness status <jobId>`.
- `pnpm sentiness pending ack fake-id` imprimiu `[]`, ou seja, caiu no fluxo de listagem.

Impacto:

Mesmo que o background job fosse corrigido, o usuario nao consegue consultar status nem
acknowledge pending feedback pela CLI. Isso quebra a Fase C e o protocolo da Fase 6, que manda
agentes rodarem slow checks em background e fazerem polling via `sentiness status <jobId>`.

Fix proposto:

Escolher um dos dois caminhos:

1. Wrappers especificos por comando posicional:
   - `status`: `.action((jobId, args) => wrap(statusCommand, deps)({ ...args, _: [jobId] }))`
   - `pending`: `.action((positional, args) => wrap(pendingCommand, deps)({ ...args, _: positional }))`
2. Um wrapper generico `wrapWithPositionals` que recebe `...values`, trata o ultimo valor como
   options e coloca os anteriores em `args._`.

Testes necessarios:

- Teste de CLI real ou de `registerCommands` provando `status <jobId>` chama `statusCommand`
  com `args._[0]`.
- Teste de `pending ack <id>` chamando `PendingQueue.ack`.
- E2E pequeno com `node dist/cli/index.js status <jobId>` depois de criar um meta fake.

---

### COD-1.3 - Check errored pode retornar exit code 0

- Severidade: Critico
- Localizacao:
  - `packages/core/src/reporter/reporter.ts:121-124`
  - `packages/core/src/reporter/reporter.ts:167-175`

Causa raiz:

`buildReport` calcula `summary.status = "error"` quando ha checks com `status: "error"`, mas
`agentInstructions.blocking` so considera findings. Um check em erro normalmente nao tem
findings. `exitCodeFor` retorna `0` quando `summary.blocking === false`, ignorando
`summary.status`.

Sintoma esperado:

Se Biome, Knip, Stryker ou Coverage falham por parse/tooling e retornam `CheckResult` com
`status: "error"` e `findings: []`, o JSON diz que o run esta em erro, mas o processo pode
terminar com sucesso. Isso deixa CI e agentes declararem tarefa pronta sem um check valido.

Fix proposto:

Definir a politica de exit code:

- Opcao A: `summary.status === "error"` retorna `3` por falha de Sentiness/tooling.
- Opcao B: `summary.status === "error"` retorna `1`, tratando check error como bloqueio de
  qualidade.

Eu prefiro A quando o check nao conseguiu produzir resultado confiavel. O ponto essencial e:
nao pode ser `0`.

Teste necessario:

- `buildReport` com um check `status: "error"` e sem findings deve resultar em
  `exitCodeFor(report) !== 0`.

---

### COD-1.4 - `diff-filter` nao tem testes, apesar de ser o centro de baseline/diff/trend

- Severidade: Serio
- Localizacao:
  - `packages/core/src/baseline/diff-filter.ts`
  - ausencia de `packages/core/src/baseline/diff-filter.test.ts`

O `post-phase5-audit.md` diz que `compareMetrics` esta "implementada, testada e correta".
Na implementacao atual, nao encontrei nenhum teste para `applyBaseline`, `compareMetrics` ou
`applyBaselineToOutcome`.

Impacto:

Os bugs de metric regressions, diff filtering e idempotencia passam sem cobertura. Isso e
especialmente arriscado porque baseline e a ideia central do produto.

Fix proposto:

Criar `diff-filter.test.ts` com:

- finding em baseline e fora baseline;
- file dentro e fora de `changedFiles`;
- `diffOnly: true` e `false`;
- `introducedInDiff`;
- metric regression para `higher-is-better` e `lower-is-better`;
- `applyBaselineToOutcome` chamando `compareMetrics`;
- teste de idempotencia, idealmente com fast-check.

---

### COD-1.5 - `doctor` tem falso positivo de saude

- Severidade: Serio
- Localizacao: `packages/core/src/cli/commands/doctor.ts`

Esse ponto ja existe como AUD-3.2, mas a severidade deve subir porque foi confirmado no proprio
repo.

Evidencia:

- `pnpm sentiness doctor` retornou `ok: true` e listou `stryker`.
- `pnpm exec stryker --version` falhou com `Command "stryker" not found`.
- `sentiness check --tier=slow --compact` pulou Stryker com `skipReason: "stryker not found"`.

Impacto:

O usuario recebe um diagnostico "ok" enquanto um check habilitado nao esta disponivel. Para um
comando chamado `doctor`, isso e falso positivo operacional.

Fix proposto:

`doctor` deve chamar `detect()` de cada check habilitado usando um `CheckContext` minimo e
retornar `ok: false` quando algum check habilitado estiver indisponivel. Coverage pode continuar
`available: true` se o design for "run skips when report missing", mas Stryker/Knip/Biome nao.

---

### COD-1.6 - `@sentiness/check-coverage` esta fora das verificacoes de qualidade atuais

- Severidade: Serio
- Localizacao:
  - `packages/checks/coverage/src/coverage.ts`
  - `packages/checks/coverage/src/coverage.test.ts`

Este e efeito direto de COD-1.1, mas merece registro separado porque ha problemas concretos
escondidos:

- `coverage.test.ts` usa `thresholds?: any`, contrariando "No any".
- `coverage.ts` faz `JSON.parse(content) as IstanbulReport`, sem Zod ou narrowing.
- `coverage.ts` faz `ctx.checkConfig.thresholds as Record<string, number> | undefined`.
- O arquivo tem formatacao que Biome provavelmente alteraria, mas Biome nao esta olhando para
  esse pacote.

Fix proposto:

Depois de corrigir ignores, tratar coverage como qualquer outro check package: lint limpo,
schema de report Istanbul, sem `any`, e testes cobrindo paths relativos/absolutos em diff mode.

---

## 4. Roadmap corretivo combinado

### Onda 0 - Integridade do repositorio e CLI essencial

Fazer antes de qualquer outro trabalho:

1. COD-1.1 - parar de ignorar `packages/checks/coverage` em Git e Biome; limpar o pacote.
2. AUD-5.1 - mover `.sentiness-test-registry` para `os.tmpdir()` e limpar apos o teste.
3. AUD-1.1 - corrigir trigger-only no `check`.
4. COD-1.2 - corrigir wrapper de argumentos posicionais para `status` e `pending ack`.
5. AUD-1.2 - corrigir background job end-to-end com jobId conhecido antes do spawn e caminho
   real do CLI entrypoint.

Motivo: esses itens definem se o repo e a CLI sao confiaveis para os outros agentes.

---

### Onda 1 - Corretude do report e baseline

1. COD-1.3 - garantir exit code nao-zero para check errored.
2. AUD-1.5 - truncar findings por severidade.
3. AUD-1.6 - schema real para baseline.
4. COD-1.4 - criar testes de `diff-filter`.
5. AUD-1.3 - integrar `compareMetrics` em `applyBaselineToOutcome`.
6. AUD-3.5 - salvar baseline de forma atomica.

Motivo: esses itens protegem o contrato JSON que os agentes vao consumir.

---

### Onda 2 - Regras inegociaveis e persistencia

1. AUD-2.1 - schemas para `JobMeta`, `Report` persistido, `PendingItem` e coverage report.
2. AUD-2.2 - substituir catches mudos por log/degradacao explicita ou erro contextual.
3. AUD-2.4 - remover `new Date()` direto de `BaselineManager.accept`, reconciliando assinatura
   com a spec.
4. AUD-2.3 - trocar `console.log` do Prompter por writer injetado.

Motivo: reduz falhas silenciosas e deixa os arquivos persistidos recuperaveis.

---

### Onda 3 - Onboarding e UX local

1. AUD-3.2 / COD-1.5 - `doctor` chama `detect()`.
2. AUD-3.1 - `install-hooks` detecta package manager e hook manager, preserva hook existente e
   e idempotente.
3. AUD-3.3 - `init` oferece todos os checks implementados.
4. AUD-3.4 - Stryker resolve path do report a partir de config, pelo menos JSON inicialmente.

Motivo: depois que a base esta correta, o produto precisa ser instalavel sem destruir fluxo do
usuario.

---

### Onda 4 - Decisoes de produto antes de Phase H

1. AUD-1.4 - decidir como checks declaram direcao de metricas (`metricSpecs` no `Check`, config
   central, ou outro contrato).
2. AUD-1.7 - decidir se existe `--trend` explicito ou se regressao de metrica aparece em todo
   run com baseline.
3. AUD-4.* - limpar cheiros menores: ordenar jobs por `startedAt`, documentar `durationMs`,
   resolver fallback de category, melhorar IDs do Knip.

Motivo: esses itens importam antes de mais check packages, mas nao devem bloquear o conserto da
vertical slice atual.

---

## 5. Criterios de aceite revisados

O sprint corretivo deve ser considerado pronto quando:

- [ ] `git check-ignore -v packages/checks/coverage/src/coverage.ts` nao retorna nada.
- [ ] `git ls-files packages/checks/coverage/src/coverage.ts` lista o arquivo apos o add.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build` e `pnpm lint` passam nessa ordem.
- [ ] Rodar `pnpm test` antes de `pnpm lint` nao deixa lixo no working tree e nao quebra Biome.
- [ ] `pnpm sentiness check --trigger=post-edit --compact` executa o tier `fast` sem erro de
  mismatch.
- [ ] `pnpm sentiness check --background --tier=fast --compact` cria um job cujo child escreve
  `result.json` e atualiza `meta.json` para estado final.
- [ ] `pnpm sentiness status <jobId>` imprime o metadata do job correto.
- [ ] `pnpm sentiness pending ack <id>` reconhece o item e nao cai no fluxo de listagem.
- [ ] Um check com `status: "error"` e sem findings gera exit code nao-zero.
- [ ] `packages/core/src/baseline/diff-filter.test.ts` existe e cobre baseline, diff e metric
  regressions.
- [ ] `doctor` retorna indisponibilidade para checks habilitados cujo binario esta ausente.
- [ ] Varreduras usam `rg --no-ignore` ou mecanismo equivalente que cobre `packages/checks/*`.
- [ ] Nao ha `catch {}` mudo em codigo de runtime.
- [ ] Nao ha casts dos tipos persistidos (`Report`, `JobMeta`, `PendingItem`,
  `BaselineSnapshot`, `IstanbulReport`) sem schema/narrowing imediatamente ao lado.

---

## 6. Conclusao

Eu seguiria a recomendacao macro do `post-phase5-audit.md`: pausar Phase 6 e fechar um sprint
corretivo. Mas eu reordenaria o trabalho colocando integridade do repositorio, comandos
posicionais e exit code de check errored antes de alguns itens estruturais.

A vertical slice atual compila e os testes passam, mas isso e enganoso: parte do codigo fonte
do coverage check esta invisivel para Git/Biome, status/pending nao funcionam via CLI, background
job nao fecha round-trip, e erro de check pode virar sucesso de processo. Esses pontos precisam
entrar no plano junto com os AUDs ja propostos.

---

## 7. Atualizacao apos sprint corretivo

Data: 2026-04-29

Status: os bloqueadores da revisao pos-Fase 5 foram corrigidos. A proxima fase pode seguir,
com as ressalvas deliberadamente adiadas abaixo.

### Corrigido no sprint

- COD-1.1: `packages/checks/coverage` deixou de ficar invisivel para Git/Biome e o pacote foi
  limpo.
- AUD-5.1: teste de registry usa tempdir fora do repo e nao deixa lixo que quebra lint.
- AUD-1.1: `check --trigger=<name>` resolve o tier pela config quando `--tier` nao e passado.
- COD-1.2: comandos com posicionais (`status <jobId>`, `pending ack <id>`) chegam ao handler.
- AUD-1.2: background jobs recebem `jobId` real antes do spawn e usam o entrypoint correto da CLI.
- COD-1.3: check com `status: "error"` nao retorna exit code 0.
- AUD-1.5: truncacao preserva findings por severidade.
- AUD-1.3, AUD-1.4, AUD-1.6: baseline/diff/trend agora validam schema, integram metric
  regressions e respeitam `metricSpecs`.
- AUD-2.1, AUD-2.2, AUD-2.3, AUD-2.4: fronteiras persistidas tem schemas, catches relevantes
  logam contexto, `Prompter` usa writer injetado, e `BaselineManager.accept` recebe `Clock`.
- AUD-3.1: `install-hooks` detecta package manager e hook managers (`husky`, `lefthook`,
  `simple-git-hooks`), preserva hooks existentes e e idempotente.
- AUD-3.2, AUD-3.3, AUD-3.5: `doctor` chama `detect()`, `init` oferece todos os checks
  implementados, e baseline save e atomico.
- AUD-4.3, AUD-4.5, AUD-4.7, AUD-4.11, AUD-4.12, AUD-4.13, AUD-4.14: cheiros menores de
  concorrencia, jobs, env, category fallback, Knip e Prompter foram tratados.

### Validacao local

- `pnpm typecheck`: passa.
- `pnpm test`: passa.
- `pnpm lint`: passa.
- `pnpm build`: passa.
- `git diff --check`: passa.
- `pnpm sentiness check --trigger=post-edit --compact`: resolve `tier: "fast"`.
- `pnpm sentiness check --tier=fast --trend --compact`: reporta `mode: "trend"`.
- `pnpm sentiness pending ack fake-id`: reconhece o fluxo de `ack`.
- `pnpm sentiness doctor`: retorna `ok: false` quando checks habilitados nao estao instalados,
  como esperado.
- `git ls-files packages/checks/coverage/src/coverage.ts`: lista o arquivo.

### Limitacao de validacao

- Background detached: o contrato de args/jobId foi corrigido e coberto, mas o ambiente Codex
  mata subprocessos detached. O round-trip vivo (`result.json` + `meta.json` final) deve ser
  validado em terminal normal ou CI.

### Adiado deliberadamente

- Stryker `.js`/`.mjs` config: adiado porque importar config JS executa codigo do projeto do
  usuario e mistura seguranca, ambiente e formato de config. O suporte seguro atual cobre
  `checkConfig.reportPath`, `stryker.conf.json`, `stryker.config.json` e fallback padrao.
- ULID em vez de UUID para jobs: baixo retorno agora. `randomUUID` e permitido pela propria spec
  como fallback, e a listagem ja ordena por `startedAt`.
- PID reuse em background jobs: edge case real, mas a solucao correta e dependente de plataforma
  (`/proc` no Linux, outras APIs fora dele). Nao bloqueia adapters nem contrato JSON.
- `baseline init/update/accept/prune` ainda executam tiers separadamente: mantido porque a spec
  permite esse caminho. A duplicacao de codigo foi removida com helper compartilhado e o merge de
  `checkMetadata` foi corrigido; otimizar para uma run unica fica para quando houver custo real
  em repos grandes.
