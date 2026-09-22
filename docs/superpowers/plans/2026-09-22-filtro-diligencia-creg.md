# Filtro "Em diligência" no acervo do CREG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao painel `acervo-creg.html` um filtro que separe os processos pendentes que estão **em diligência** dos que apenas aguardam julgamento, para que a permanência longa de um processo parado por diligência pare de se confundir com atraso do relator.

**Architecture:** As diligências são um registro externo — uma planilha publicada que a equipe da AGR mantém à mão. Ela é sincronizada para `public.diligencias_creg` pelo mesmo caminho que as pautas da AGR já usam (GitHub Actions → Python → Postgres), e o recorte é feito em SQL, dentro das duas funções que o painel já chama. O navegador ganha só um par de pills e um parâmetro a mais na chamada; nenhuma regra de faixa ou de pendência é reimplementada em JavaScript.

**Tech Stack:** HTML estático, JavaScript ES2022 sem build (esbuild só minifica), CSS puro com tokens em `:root`, PostgreSQL 17 (Supabase/PostgREST), Python 3.11 + psycopg2 para sincronização e testes de banco, Node 22 `node:test` para testes de front.

---

## A regra do recorte

Quem marca o estado é a coluna `RETORNO` da planilha, confirmado com a
secretaria em 22/09/2026:

| `RETORNO` | significado |
|---|---|
| `NÃO` | diligência aberta — o processo está fora |
| `SIM` | o processo voltou |

> **Em diligência** = pendente no acervo **e** com diligência de `RETORNO = NÃO`
> e `data_diligencia >= data_distribuicao`.

Na planilha a linha encerrada também fica tachada e com o `SIM` em verde, mas o
recorte não lê formatação: o `?output=csv` não transporta tachado nem cor, e
regra que depende de formatação muda de significado num copiar-colar.

A guarda de data cobre a **redistribuição**: um processo que foi a diligência,
voltou, foi julgado e depois foi sorteado de novo volta a ser pendente sem estar
em diligência. É a irmã da correlação de datas que o CTE `pendentes` já faz.

`JULGADOS` não entra na regra — é campo de observação, e das 44 linhas de
22/09/2026 várias com a coluna vazia já tinham sessão. Célula de `RETORNO` em
branco também não conta como aberta: a convenção é explícita.

### O erro da primeira versão, registrado

A v1 definiu "em diligência" como *"pendente e com diligência registrada"* e
mostrou **6 falsos positivos** em produção — processos que tinham ido a
diligência, voltado, e apenas aguardavam pauta. "Aguarda pauta" não é "está
fora com a área técnica".

A causa raiz foi ter lido a planilha só pelo CSV: no texto puro, `RETORNO` era
`SIM` em 100% das linhas e pareceu ruído sem sinal. Não era ruído — era a
resposta, e as 44 linhas estavam todas encerradas. **O recorte devolvendo zero
é o comportamento correto**, não uma falha.

## Global Constraints

- **A CJ não muda.** `resumo_acervo_cj` e `processos_acervo_cj` não são tocadas; `acervo-cj.html` não ganha o controle. O que separa os dois colegiados é a tabela `COLEGIADOS` no topo de `assets/js/acervo.js`, e é só lá que a diferença pode morar.
- `p_diligencia boolean default null`: `null` = todo o acervo pendente (o comportamento de hoje, byte a byte), `true` = só em diligência, `false` = só fora de diligência. Os três estão expostos na tela, como os três segmentos do controle. O default é o que mantém o corpo `{}` que o front envia hoje funcionando.
- No JavaScript, o de-para valor→parâmetro usa `?? null` e nunca `||`: `false` é um recorte válido e `||` o trocaria por `null`, fazendo "Sem diligência" mostrar tudo.
- O filtro compõe com `p_ordem` e `p_unidade` por `and`, como os dois já compõem entre si. Nenhum parâmetro tem precedência sobre outro.
- A definição de "pendente" e a lista de faixas continuam existindo **uma vez em cada função** e idênticas entre as duas, como já estão. O filtro entra como mais um predicado sobre o CTE `pendentes`, nunca como um segundo CTE de faixas.
- `resumo_acervo_creg` e `processos_acervo_creg` trocam de assinatura: precisam de `drop function if exists` com a assinatura **antiga** antes do `create`, e de `revoke`/`grant` com a assinatura **nova**. As duas já são `drop`+`create` no schema — atualizar as três linhas de cada.
- A sincronização **substitui** a tabela inteira a cada rodada (`delete` + `insert` numa transação). A planilha é a fonte; 44 linhas não justificam lógica de diff.
- A sincronização **recusa-se a gravar** se o cabeçalho da planilha não for o esperado ou se o parse resultar em zero linhas. Sem essa guarda, uma reestruturação da planilha esvaziaria a tabela em silêncio e o filtro passaria a devolver zero sem erro nenhum.
- A coluna `INTERESSADO` da planilha **não** é importada, pela mesma razão que `acervo_creg.interessado` não é preenchido por importação (ver o comentário na tabela). Nas linhas recentes ela nem traz interessado: traz `CREG3`.
- Só tokens de cor existentes. O controle reusa `.pill`, que já existe para os filtros de exclusão do sorteio.
- **O repositório é público e a planilha não é.** Nem o endereço dela nem o conteúdo dela entram num commit: a URL é segredo do Actions, e a fixture é sintética. O segredo tira a URL do repositório, mas não torna a planilha privada — restringir na origem é decisão da AGR.
- Publicação: a migração vai ao banco hospedado **antes** do front. `sql/schema.sql`, a migração, os `.min.*` e os `?v=` terminam sincronizados.
- Branch: `feat/filtro-diligencia` (já é a branch atual).

---

## File Structure

- Create: `supabase/migrations/20260922100000_filtro_diligencia_creg.sql` — tabela `diligencias_creg` e as duas funções do CREG com o parâmetro novo.
- Modify: `sql/schema.sql` — mesmo conteúdo no estado final: tabela na seção do CREG, funções substituídas no lugar.
- Create: `sincronizacao/diligencias.py` — baixa, valida e grava a planilha.
- Modify: `.github/workflows/sincronizar-julgados.yml` — um step a mais, mesmo segredo, mesma cadência.
- Modify: `acervo-creg.html` — o `<fieldset>` com as duas pills no cabeçalho do painel.
- Modify: `assets/js/acervo.js` — `diligencia: true` no CREG, estado do filtro, parâmetro nas duas chamadas, vazio condicional, subtítulo do Excel.
- Modify: `assets/css/index.css` — o agrupamento das pills no cabeçalho do acervo.
- Create: `tests/fixtures/diligencias.csv` — a **estrutura** da planilha de 22/09/2026 (44 linhas, 41 processos distintos, `23/9/2025`, 13 `JULGADOS` preenchidos) com conteúdo sintético. A cópia literal não pode ser commitada: o repositório é público e a planilha não é.
- Modify: `tests/test_creg.py` — o recorte em SQL.
- Modify: `tests/test_sincronizacao.py` — o parser e as guardas.
- Modify: `tests/test_frontend.mjs` — o controle e a chamada.
- Modify: `tests/test_workflows.py` — o step novo.
- Regenerate: `assets/js/acervo.min.js`, `assets/css/index.min.css`, `?v=` dos HTMLs e `ASSET_VERSION` via `tools/versionar.mjs`.
- Modify: `README.md` — funcionalidade, versão 3.10.0, notas da migração e descrição dos testes.
- **Não** mexer em `AUDITORIA.md`: é um relatório datado de 15/09/2026, fixado no commit `9712d04`. As contagens de teste ali são o que aquela auditoria mediu, não um número vivo.

---

### Task 1: Banco — tabela das diligências e o parâmetro nas duas funções

**Files:**
- Create: `supabase/migrations/20260922100000_filtro_diligencia_creg.sql`
- Modify: `sql/schema.sql` (seção "CREG · Acervo" para a tabela; `resumo_acervo_creg` ~linha 1201 e `processos_acervo_creg` ~linha 1276)
- Test: `tests/test_creg.py`

**Interfaces:**
- Produces: `public.diligencias_creg (id, num_processo, data_diligencia, descricao, retorno, julgados, linha, atualizado_em)`.
  - `num_processo` com o mesmo `check (~ '^[0-9]{15}$')` de `acervo_creg`.
  - `linha` é a posição na planilha: desempata quando duas diligências do mesmo processo caem na mesma data.
  - Índice em `num_processo` — é por ele que as duas funções entram.
  - RLS ligada, **sem policy de leitura**: como `acervo_creg`, a tabela é fechada ao navegador e só as funções `security definer` a alcançam.
- Produces: `resumo_acervo_creg(p_diligencia boolean default null)` e `processos_acervo_creg(p_ordem int default null, p_unidade text default null, p_diligencia boolean default null)` — mesmos retornos de hoje.
- Consumes: nada novo.

**Steps:**
- [ ] Escrever a migração: a tabela, o índice, a RLS e as duas funções inteiras (drop com assinatura antiga → create → revoke/grant com a nova).
- [ ] Nas duas funções, acrescentar ao CTE `pendentes` o predicado do recorte, escrito uma vez em cada, idêntico:
      `exists (select 1 from public.diligencias_creg d where d.num_processo = a.num_processo and d.data_diligencia >= a.data_distribuicao)`
      comparado a `p_diligencia` com `(p_diligencia is null or <exists> = p_diligencia)`.
- [ ] Comentar no schema **por que** o recorte não olha `julgados`, com os números da conferência de 22/09/2026 — senão a próxima pessoa "conserta" usando a coluna.
- [ ] Copiar o estado final para `sql/schema.sql`, nos lugares certos (a tabela junto das outras do CREG, as funções substituídas onde estão).
- [ ] Testes em `tests/test_creg.py`, numa seção nova: recorte `true`/`false`/`null` soma o total de hoje; a guarda de data exclui o processo redistribuído depois da diligência; `p_diligencia` combina com `p_ordem` e com `p_unidade`; o total do resumo bate com a contagem do detalhe sob o mesmo filtro; as funções da CJ continuam com a assinatura antiga.

**Verify:** `python tests/test_creg.py` e `python tests/test_cj.py` passam.

---

### Task 2: Sincronização da planilha

**Files:**
- Create: `sincronizacao/diligencias.py`
- Create: `tests/fixtures/diligencias.csv`
- Modify: `tests/test_sincronizacao.py`

**Interfaces:**
- Produces: `python sincronizacao/diligencias.py --dsn … [--simular]`, resumo em JSON no stdout como `sincronizar.py`.
- Produces: `analisar(texto) -> list[Diligencia]` — separada do download, que é o que o teste exercita.
- Consumes: `SUPABASE_DB_URL`; a planilha publicada, pelo endereço `output=csv`.

**Steps:**
- [ ] Módulo SEM a URL no código: ela vem da variável `DILIGENCIAS_CSV_URL` (segredo do Actions). O link de publicação do Google é credencial de leitura e este repositório é público — mesma razão de `SUPABASE_DB_URL` e `dados/*.sql` ficarem fora do Git. O resumo em JSON também não pode imprimi-la: ele vai para o log do Actions. Teste de trava contra reintroduzir um default.
- [ ] Allowlist de host própria: o `pub` responde 307 para um host `*.googleusercontent.com` que **varia**, e o handler de redirecionamento do `agr.py` o rejeitaria. Permitir `docs.google.com` e o sufixo `.googleusercontent.com`, sempre sobre https.
- [ ] `analisar` com o `csv` da stdlib: conferir o cabeçalho contra a lista esperada e levantar se divergir; descartar linha com processo fora de `^\d{15}$`; data com `%d/%m/%Y` **tolerante a dia e mês sem zero à esquerda** (a planilha traz `23/9/2025`).
- [ ] Gravação: `delete` + `execute_values` numa transação só; abortar antes do delete se `analisar` devolveu zero linhas.
- [ ] `--simular` não abre transação de escrita.
- [ ] Fixture: a estrutura da planilha de 22/09/2026, 44 linhas, com o `23/9/2025` preservado e o conteúdo anonimizado (interessado, descrição, número de processo e texto de retorno).
- [ ] Testes: as 44 linhas saem do fixture; a data sem zero à esquerda vira `2025-09-23`; processo inválido é descartado sem derrubar a rodada; cabeçalho alterado levanta e nada é gravado; planilha vazia levanta antes do delete.

**Verify:** `python tests/test_sincronizacao.py` passa.

---

### Task 3: Workflow

**Files:**
- Modify: `.github/workflows/sincronizar-julgados.yml`
- Modify: `tests/test_workflows.py`

**Steps:**
- [ ] Step "Sincronizar diligências" depois do step das pautas, mesmo `SUPABASE_DB_URL`, respeitando `inputs.simular`.
- [ ] O step roda mesmo se a sincronização das pautas falhar (`if: always()`), e a falha dele pinta o job de vermelho: são fontes independentes, e uma pauta fora do ar não é razão para a tabela de diligências envelhecer.
- [ ] Teste do contrato do agendamento em `tests/test_workflows.py`, no estilo do arquivo (leitura do YAML como texto).

**Verify:** `python tests/test_workflows.py` passa.

---

### Task 4: Painel

**Files:**
- Modify: `acervo-creg.html`, `assets/js/acervo.js`, `assets/css/index.css`
- Test: `tests/test_frontend.mjs`

**Interfaces:**
- Consumes: `rpc/resumo_acervo_creg` e `rpc/processos_acervo_creg` com `p_diligencia`.

**Steps:**
- [ ] Antes de editar CSS/HTML, rodar `C:/Users/leonardo.amichi/.claude/skills/impeccable/scripts/impeccable context --target acervo-creg.html` e ler `craft-floor.md`.
- [ ] `acervo-creg.html`: um `<fieldset>` com legenda visível e dois `<input type="radio" name="recorte">` — "Todo o acervo" e "Em diligência" — dentro de `.acervo-header`. Radio nativo entrega papel, grupo, setas do teclado e anúncio do leitor de tela sem uma linha de ARIA; é a mesma escolha que o `<dialog>` da página já fez.
- [ ] `assets/js/acervo.js`: `diligencia: true` só em `COLEGIADOS.creg`; o bloco do controle sai da tela quando a chave é falsa, de modo que `acervo-cj.html` não o vê nem o consulta.
- [ ] Estado do recorte numa variável só, lida por `carregarAcervo` e por `abrirDetalhe` — se as duas divergirem, a célula abre um número diferente do que mostrava, que é o defeito que o comentário do detalhe já adverte.
- [ ] Trocar o recorte chama `carregarAcervo()`. Total, subtítulo, Excel e PDF derivam de `linhasAtuais` e acompanham sem mudança.
- [ ] Vazio condicional: "Acervo zerado" está errado sob filtro — sob "Em diligência" a mensagem é "Nenhum processo em diligência".
- [ ] Subtítulo do Excel e do PDF ganham o recorte ativo, senão o arquivo exportado não diz o que ele é.
- [ ] Card de detalhe: coluna "Em diligência desde", preenchida com `data_diligencia`. Com 6 processos, a lista sem a data não informa nada; a data já está na tabela e sai no mesmo `select`. Só no CREG e só sob o recorte `true`.
- [ ] Testes em `tests/test_frontend.mjs`: trocar o recorte refaz a chamada com `p_diligencia` certo; o detalhe herda o recorte; a página da CJ não desenha o controle nem manda o parâmetro.

**Verify:** `node tests/test_frontend.mjs` e `node --check assets/js/acervo.js` passam.

---

### Task 5: Fecho

**Steps:**
- [ ] `node tools/versionar.mjs`; regerar `index.min.css` e os `.min.js` com o esbuild fixado na CI (`esbuild@0.28.2`).
- [ ] Versão 3.9.2 → 3.10.0 no rodapé dos HTMLs e no README.
- [ ] README: a funcionalidade na seção do Acervo, `sincronizacao/diligencias.py` onde os outros scripts estão, a descrição dos testes novos.
- [ ] Rodar a suíte inteira como a CI roda.

**Verify:** `for t in tests/test_*.py; do python "$t"; done`, `for t in tests/test_*.mjs; do node "$t"; done`, e `git diff --exit-code` limpo depois de versionar e minificar.

---

## Em aberto

- A planilha é mantida à mão e sem disciplina nas colunas de texto. Se um dia a AGR passar a fechar `JULGADOS`, o recorte **continua correto** — ele não depende da coluna. Mas vale reavaliar se aí a coluna passa a valer como sinal adicional.
- Os 6 processos em diligência são todos CREG3. Se isso se mantiver, o filtro é na prática um filtro de uma unidade só; não muda a implementação, mas muda o que o painel comunica.
