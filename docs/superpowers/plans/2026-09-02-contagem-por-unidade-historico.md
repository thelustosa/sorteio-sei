# Contagem por unidade no histórico de sorteios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir, em cada linha do histórico, a quantidade de processos enviada para cada CREG ou cadeira da CJ.

**Architecture:** A RPC agrupa primeiro as linhas por rodada e destino e devolve uma lista JSON ordenada em `distribuicao`, preservando `destinos` para compatibilidade. O frontend transforma essa lista em grupos semânticos compactos e mantém fallback para o contrato antigo. Uma fixture com distribuições equilibradas e desiguais permite validar densidade, quebra e centralização no Chrome.

**Tech Stack:** PostgreSQL/Supabase RPC, JavaScript sem framework, CSS, testes Node `node:test`, testes PostgreSQL/Python e Chrome.

**Spec:** `docs/superpowers/specs/2026-09-02-contagem-por-unidade-historico.md`

## Global Constraints

- Preservar `destinos text[]` e aceitar respostas sem `distribuicao` durante o rollout.
- Não fazer N+1: a lista inteira continua vindo de uma única chamada a `rpc/historico_sorteios`.
- Manter `STABLE`, `SECURITY DEFINER`, `search_path = ''`, checagem de `auth.uid()` e privilégio apenas para `authenticated`.
- Centralizar os destinos e permitir quebra somente entre grupos completos.
- Não criar commits automaticamente porque o worktree já contém alterações do usuário.

---

### Task 1: Contrato visual do frontend

**Files:**
- Modify: `tests/test_frontend.mjs:1330-1383`
- Modify: `assets/js/historico.js:161-225`

**Interfaces:**
- Consumes: `sorteio.distribuicao?: Array<{ destino: string, processos: number }>` e `sorteio.destinos: string[]`.
- Produces: `.historico-destinos-lista`, `.historico-destino`, `.historico-destino-sigla` e `.historico-destino-contagem` dentro da célula existente.

- [x] **Step 1: Escrever o teste que exige sigla e contagem em CREG e CJ**

```js
assert.deepEqual(destinosDa(linhas(page)[0]), [
  { destino: 'CJ1', processos: '7' },
  { destino: 'CJ2', processos: '7' },
  { destino: 'CJ3', processos: '7' },
  { destino: 'CJ4', processos: '7' },
  { destino: 'CJ5', processos: '6' }
]);
```

- [x] **Step 2: Rodar o teste e confirmar falha pelo markup ausente**

Run: `node --test --test-name-pattern="quantidade.*destino" tests/test_frontend.mjs`

Expected: FAIL porque a célula atual contém somente texto com as siglas.

- [x] **Step 3: Implementar normalização, fallback e markup mínimo**

```js
function distribuicaoDo(sorteio) {
  if (Array.isArray(sorteio.distribuicao)) return sorteio.distribuicao;
  return (sorteio.destinos || []).map(destino => ({ destino, processos: null }));
}
```

Criar um grupo por item, acrescentando a cápsula apenas quando `processos` for inteiro não negativo, e definir `aria-label` completo na célula.

- [x] **Step 4: Rodar o teste focal e a suíte do frontend**

Run: `node --test --test-name-pattern="quantidade.*destino" tests/test_frontend.mjs`

Run: `node --test tests/test_frontend.mjs`

Expected: PASS.

### Task 2: Agregação por destino na RPC

**Files:**
- Modify: `tests/test_cj.py:1634-1648`
- Modify: `sql/schema.sql:1305-1350`
- Modify: `supabase/migrations/20260902111342_contar_processos_por_destino_historico.sql`

**Interfaces:**
- Consumes: linhas de `public.acervo_cj` (`relator`) e `public.acervo_creg` (`unidade`) agrupadas por `(data_distribuicao, sorteado_em)`.
- Produces: `distribuicao jsonb` como array ordenado de objetos `{destino, processos}`.

- [x] **Step 1: Escrever teste PostgreSQL com distribuição desigual**

Inserir duas linhas adicionais em `CREG2` na rodada semeada de 27/08 e exigir:

```python
assert distribuicao == [
    {'destino': 'CREG2', 'processos': 3},
    {'destino': 'CREG4', 'processos': 1},
]
```

- [x] **Step 2: Rodar e confirmar falha por coluna inexistente**

Run: `python tests/test_cj.py`

Expected: FAIL ao selecionar `distribuicao` da função atual.

- [x] **Step 3: Recriar a função com agregação em duas etapas**

Para cada colegiado, a subconsulta agrupa por rodada e destino com `count(*)::int`; a consulta externa usa `sum(processos)::int`, `array_agg(destino order by destino)` e:

```sql
jsonb_agg(
  jsonb_build_object('destino', destino, 'processos', processos)
  order by destino
)
```

Como `RETURNS TABLE` muda, executar `drop function if exists public.historico_sorteios(text)` dentro da mesma migração antes de recriar, revogar o acesso padrão e conceder somente a `authenticated`.

- [x] **Step 4: Rodar os testes PostgreSQL**

Run: `python tests/test_cj.py`

Expected: PASS, incluindo soma, ordem, autenticação e privilégios.

### Task 3: Tratamento visual e fixture

**Files:**
- Modify: `assets/css/index.css:1494-1501`
- Modify: `tests/fixtures/historico-visual.html:71-100`

**Interfaces:**
- Consumes: markup criado na Task 1.
- Produces: grupos centralizados, contagem tabular em cápsula e quebra somente entre destinos.

- [x] **Step 1: Atualizar a fixture com `distribuicao` variada**

Cobrir 1, 2, 3, 4 e 5 destinos, totais pequenos e grandes e divisão desigual; a soma deve coincidir com `processos` em cada rodada.

- [x] **Step 2: Implementar o CSS aprovado**

```css
.historico-destinos-lista { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.historico-destino { display: inline-flex; align-items: center; white-space: nowrap; }
.historico-destino-contagem { font-variant-numeric: tabular-nums; }
```

Completar borda, espaçamento e cores com os tokens existentes, sem aumentar desnecessariamente a altura de linha.

- [x] **Step 3: Validar no Chrome**

Abrir `tests/fixtures/historico-visual.html?linhas=20`, verificar semanticamente 20 linhas e inspecionar visualmente desktop e viewport estreita. Confirmar também abrir/fechar o detalhe sem reintroduzir o destaque persistente.

### Task 4: Assets e verificação final

**Files:**
- Regenerate: `assets/js/historico.min.js`
- Regenerate: `assets/css/index.min.css`
- Modify mechanically: páginas versionadas e `assets/js/supabase.js`/`.min.js` via `tools/versionar.mjs`

- [x] **Step 1: Minificar os assets alterados**

Run: `npx.cmd --yes esbuild@0.28.2 assets/js/historico.js --minify-syntax --minify-whitespace --outfile=assets/js/historico.min.js`

Run: `npx.cmd --yes esbuild@0.28.2 assets/css/index.css --minify --outfile=assets/css/index.min.css`

- [x] **Step 2: Atualizar o hash de versão**

Run: `node tools/versionar.mjs`

- [x] **Step 3: Executar verificação completa**

Run: `node --test tests/test_frontend.mjs`

Run: `node tests/test_assets.mjs`

Run: `node tests/test_sorteio.mjs`

Run: `python tests/test_cj.py`

Run: `git diff --check`

Expected: todos os comandos terminam com código 0.
