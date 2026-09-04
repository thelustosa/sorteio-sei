# Controle de Acesso por Órgão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restringir interface, URLs, tabelas e RPCs para que cada usuário autenticado use somente os módulos CJ/CREG explicitamente autorizados.

**Architecture:** Uma tabela RLS associa `auth.uid()` a um ou mais órgãos e duas funções `SECURITY INVOKER` expõem somente a decisão do usuário atual. O bootstrap consulta essas permissões antes de carregar qualquer módulo; no banco, RLS protege operações diretas e todas as RPCs `SECURITY DEFINER` fazem uma verificação explícita do órgão.

**Tech Stack:** HTML estático, JavaScript ES2022, Node.js 22 `node:test`, Supabase Auth/PostgREST, PostgreSQL 15/17, Python 3.11 e psycopg2.

**Spec:** `docs/superpowers/specs/2026-09-03-controle-acesso-por-orgao-design.md`

## Global Constraints

- `alberto.estrela@goias.gov.br` recebe somente `CREG`.
- `terezinha.bueno@goias.gov.br` recebe somente `CJ`.
- `lucas.coelho@goias.gov.br` e `sec-agr@goias.gov.br` recebem `CJ` e `CREG`.
- Usuário sem permissão explícita não acessa nenhum módulo.
- A autorização nunca usa `raw_user_meta_data`, e-mail informado pelo navegador ou visibilidade da interface como fonte de confiança.
- Nenhuma chave `service_role`/secret é adicionada ao cliente; a publishable key existente continua sendo a única chave pública.
- RLS protege chamadas REST diretas e cada função `SECURITY DEFINER` valida o órgão antes de acessar dados.
- Os jobs diretos do Postgres continuam funcionando fora do papel `authenticated`.
- O banco hospedado deve ser protegido antes da publicação do frontend.
- Os arquivos fonte, minificados, HTMLs versionados, `sql/schema.sql`, a migração local e o ledger hospedado devem terminar sincronizados.

---

## File Structure

- Create: `tests/test_acesso.py` — integração PostgreSQL específica da matriz, RLS e RPCs.
- Modify: `tests/banco.py` — adiciona a representação mínima de `auth.users` ao Postgres descartável.
- Modify: `sql/schema.sql` — estado final repetível do modelo de permissões, políticas e guardas das RPCs.
- Create initially: `supabase/migrations/20260903160000_controle_acesso_por_orgao.sql` — migração única de produção; após aplicar via Supabase, renomear para a versão registrada pelo servidor caso seja diferente.
- Modify: `tests/test_frontend.mjs` — testes reais do carregamento, ocultação e redirecionamento.
- Modify: `assets/js/supabase.js` — consulta/canonicalização das permissões, ocultação de controles e erro de acesso.
- Modify: `assets/js/bootstrap.js` — gate anterior ao carregamento do módulo e redirecionamento de URL.
- Modify: `index.html` — marca todas as opções de CJ/CREG com `data-orgao`.
- Regenerate: `assets/js/supabase.min.js`, `assets/js/bootstrap.min.js` — artefatos publicados.
- Modify mechanically: `assets/js/supabase.js`, `index.html`, `julgados-cj.html`, `julgados-creg.html`, `acervo-cj.html`, `acervo-creg.html`, `historico-cj.html`, `historico-creg.html`, `404.html` — versão de assets calculada por `tools/versionar.mjs`.

---

### Task 1: Modelo de permissões e consulta do usuário atual

**Files:**
- Create: `tests/test_acesso.py`
- Modify: `tests/banco.py:47-56`
- Modify: `sql/schema.sql:1-20`
- Create: `supabase/migrations/20260903160000_controle_acesso_por_orgao.sql`

**Interfaces:**
- Consumes: `auth.uid() -> uuid` e `request.jwt.claims.sub` do harness existente.
- Produces: `public.permissoes_usuario(user_id uuid, orgao text)`, `public.orgaos_autorizados() returns table(orgao text)` e `public.tem_acesso_orgao(text) returns boolean`.

- [ ] **Step 1: Preparar o harness e escrever os testes vermelhos da matriz**

Em `tests/banco.py`, criar a tabela mínima usada pela FK e os usuários
determinísticos logo depois de criar o schema `auth`:

```python
self.executar("""create role anon; create role authenticated; create role service_role;
                create schema auth;
                create table auth.users (
                  id uuid primary key,
                  email text not null unique
                );
                insert into auth.users (id, email) values
                  ('00000000-0000-0000-0000-000000000001', 'secretaria@goias.gov.br'),
                  ('00000000-0000-0000-0000-000000000011', 'alberto.estrela@goias.gov.br'),
                  ('00000000-0000-0000-0000-000000000012', 'terezinha.bueno@goias.gov.br'),
                  ('00000000-0000-0000-0000-000000000013', 'lucas.coelho@goias.gov.br'),
                  ('00000000-0000-0000-0000-000000000014', 'sec-agr@goias.gov.br'),
                  ('00000000-0000-0000-0000-000000000015', 'sem-acesso@goias.gov.br');
                create function auth.uid() returns uuid language sql stable
                set search_path = '' as $$
                  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb
                          ->> 'sub')::uuid
                $$;""")
```

Criar `tests/test_acesso.py` com um Postgres descartável, aplicar
`sql/schema.sql` e inserir as seis permissões da matriz para os usuários que o
harness já criou. Seguir o registrador `@teste` e o bloco `if __name__ ==
'__main__'` usados em `test_cj.py`, pois a CI executa o arquivo diretamente em
vez de invocar pytest. Usar este helper para alternar a
identidade real do papel `authenticated`:

```python
USUARIOS = {
    'alberto': '00000000-0000-0000-0000-000000000011',
    'terezinha': '00000000-0000-0000-0000-000000000012',
    'lucas': '00000000-0000-0000-0000-000000000013',
    'sec-agr': '00000000-0000-0000-0000-000000000014',
    'sem-acesso': '00000000-0000-0000-0000-000000000015',
}

def autenticar(cur, nome):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({'sub': USUARIOS[nome],
                             'role': 'authenticated',
                             'email': f'{nome}@goias.gov.br'}),))
    cur.execute('set local role authenticated')

def permissoes(cur):
    cur.execute('select orgao from public.orgaos_autorizados() order by orgao')
    return [linha[0] for linha in cur.fetchall()]

def test_matriz_de_permissoes(cur):
    for nome, esperado in {
        'alberto': ['CREG'],
        'terezinha': ['CJ'],
        'lucas': ['CJ', 'CREG'],
        'sec-agr': ['CJ', 'CREG'],
        'sem-acesso': [],
    }.items():
        autenticar(cur, nome)
        assert permissoes(cur) == esperado
```

Acrescentar testes que, como Alberto, `select * from
public.permissoes_usuario` devolve somente a própria linha e que `INSERT`,
`UPDATE` e `DELETE` falham com `InsufficientPrivilege`.

- [ ] **Step 2: Executar o teste e confirmar o vermelho correto**

Run: `python tests/test_acesso.py`

Expected: FAIL porque `public.permissoes_usuario` e
`public.orgaos_autorizados()` ainda não existem. Falha de conexão ou sintaxe no
harness não conta como vermelho correto.

- [ ] **Step 3: Criar a migração pela CLI descoberta e manter um nome local determinístico**

Como a CLI global não está instalada, descobrir a interface da versão obtida
por `npx` e criar o arquivo por ela:

```powershell
npx --yes supabase --help
npx --yes supabase migration new --help
npx --yes supabase migration new controle_acesso_por_orgao
```

Confirmar que o único arquivo novo termina em
`_controle_acesso_por_orgao.sql`. Enquanto a versão hospedada ainda não existe,
renomeá-lo para
`supabase/migrations/20260903160000_controle_acesso_por_orgao.sql` para os
passos locais. Depois da aplicação remota, a Task 6 ajustará esse prefixo à
versão efetivamente registrada, se necessário.

- [ ] **Step 4: Implementar o modelo mínimo no schema e na migração**

Adicionar ao início de `sql/schema.sql`, depois dos comentários introdutórios:

```sql
create table if not exists public.permissoes_usuario (
  user_id uuid not null references auth.users(id) on delete cascade,
  orgao text not null check (orgao in ('CJ', 'CREG')),
  primary key (user_id, orgao)
);

alter table public.permissoes_usuario enable row level security;

drop policy if exists "usuario le as proprias permissoes"
  on public.permissoes_usuario;
create policy "usuario le as proprias permissoes"
  on public.permissoes_usuario for select to authenticated
  using (user_id = (select auth.uid()));

revoke all privileges on table public.permissoes_usuario
  from anon, authenticated;
grant select on public.permissoes_usuario to authenticated;

create or replace function public.tem_acesso_orgao(p_orgao text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.permissoes_usuario p
     where p.user_id = (select auth.uid())
       and p.orgao = p_orgao
  )
$$;

create or replace function public.orgaos_autorizados()
returns table (orgao text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.orgao
    from public.permissoes_usuario p
   where p.user_id = (select auth.uid())
   order by p.orgao
$$;

revoke all on function public.tem_acesso_orgao(text)
  from public, anon, service_role;
revoke all on function public.orgaos_autorizados()
  from public, anon, service_role;
grant execute on function public.tem_acesso_orgao(text) to authenticated;
grant execute on function public.orgaos_autorizados() to authenticated;
```

Na migração, repetir o estado estrutural e semear a matriz sem UUID fixo. Antes
do `INSERT`, validar os quatro e-mails:

```sql
do $$
declare
  ausentes text[];
begin
  select array_agg(e.email order by e.email)
    into ausentes
    from (values
      ('alberto.estrela@goias.gov.br'),
      ('terezinha.bueno@goias.gov.br'),
      ('lucas.coelho@goias.gov.br'),
      ('sec-agr@goias.gov.br')
    ) e(email)
   where not exists (
     select 1 from auth.users u where lower(u.email) = e.email
   );

  if cardinality(ausentes) > 0 then
    raise exception 'usuarios ausentes para permissoes: %', ausentes;
  end if;
end
$$;

insert into public.permissoes_usuario (user_id, orgao)
select u.id, x.orgao
  from (values
    ('alberto.estrela@goias.gov.br', 'CREG'),
    ('terezinha.bueno@goias.gov.br', 'CJ'),
    ('lucas.coelho@goias.gov.br', 'CJ'),
    ('lucas.coelho@goias.gov.br', 'CREG'),
    ('sec-agr@goias.gov.br', 'CJ'),
    ('sec-agr@goias.gov.br', 'CREG')
  ) x(email, orgao)
  join auth.users u on lower(u.email) = x.email
on conflict (user_id, orgao) do nothing;
```

- [ ] **Step 5: Executar os testes e confirmar o verde**

Run: `python tests/test_acesso.py`

Expected: PASS para matriz, isolamento da leitura e bloqueio de mutações.

Run: `python tests/test_cj.py && python tests/test_creg.py`

Expected: todas as verificações existentes continuam passando após a criação
de `auth.users` no harness.

- [ ] **Step 6: Commit**

```powershell
git add tests/banco.py tests/test_acesso.py sql/schema.sql supabase/migrations/20260903160000_controle_acesso_por_orgao.sql
git commit -m "feat(db): adicionar permissoes por orgao"
```

---

### Task 2: Aplicar a autorização a tabelas e RPCs

**Files:**
- Modify: `tests/test_acesso.py`
- Modify: `sql/schema.sql:583-621,1162-1183,1244-1411`
- Modify: `supabase/migrations/20260903160000_controle_acesso_por_orgao.sql`

**Interfaces:**
- Consumes: `public.tem_acesso_orgao(p_orgao text) -> boolean` da Task 1.
- Produces: políticas RLS restritas e erro `SQLSTATE 42501` nas oito RPCs públicas quando o órgão não é permitido.

- [ ] **Step 1: Escrever testes vermelhos para as operações diretas**

Adicionar casos parametrizados a `tests/test_acesso.py`. Cada caso abre uma
transação nova, autentica o usuário e executa como `authenticated`:

```python
def deve_negar(cur, sql, args=None):
    try:
        cur.execute(sql, args)
        raise AssertionError(f'operacao proibida foi aceita: {sql}')
    except psycopg2.errors.InsufficientPrivilege:
        cur.connection.rollback()

def test_alberto_so_opera_tabelas_creg(cur):
    autenticar(cur, 'alberto')
    cur.execute("""insert into public.acervo_creg
                   (num_processo, unidade, data_distribuicao, origem)
                   values ('202600029009901', 'CREG1', current_date, 'sorteio')""")
    cur.connection.rollback()

    autenticar(cur, 'alberto')
    deve_negar(cur, """insert into public.acervo_cj
                        (num_processo, relator, data_distribuicao, origem)
                        values ('202600029009902', 'CJ1', current_date, 'sorteio')""")
```

Criar o caso simétrico para Terezinha, casos positivos para Lucas e `sec-agr`,
e casos negativos de `SELECT` em `julgados_cj`/`julgados_creg`. Para `SELECT`,
RLS permissiva costuma devolver zero linhas em vez de lançar erro; semear uma
linha como `postgres` e afirmar que o usuário proibido recebe `[]`.

- [ ] **Step 2: Escrever testes vermelhos para todas as RPCs privilegiadas**

Testar a matriz abaixo, sempre exigindo sucesso no órgão permitido e
`InsufficientPrivilege` no oposto:

```python
RPCS = {
    'CJ': [
        'select * from public.resumo_acervo_cj()',
        'select * from public.processos_acervo_cj(null, null)',
        "select public.registrar_votos('[]'::jsonb)",
        "select * from public.historico_sorteios('CJ')",
        "select * from public.processos_sorteio('CJ', current_date, null)",
    ],
    'CREG': [
        'select * from public.resumo_acervo_creg()',
        'select * from public.processos_acervo_creg(null, null)',
        "select public.registrar_votos_creg('[]'::jsonb)",
        "select * from public.historico_sorteios('CREG')",
        "select * from public.processos_sorteio('CREG', current_date, null)",
    ],
}
```

Preservar testes separados para anônimo (`28000`) e colegiado desconhecido
(`22023`), provando que a nova guarda não apaga os contratos atuais.

- [ ] **Step 3: Executar os testes e confirmar que as permissões amplas ainda vazam**

Run: `python tests/test_acesso.py`

Expected: FAIL porque Alberto ainda insere/lê CJ, Terezinha ainda insere/lê
CREG e as funções privilegiadas ainda aceitam ambos.

- [ ] **Step 4: Restringir as políticas diretas**

Em `sql/schema.sql` e na migração, substituir as expressões `true`:

```sql
create policy "usuario com acesso cj pode inserir"
  on public.acervo_cj for insert to authenticated
  with check ((select public.tem_acesso_orgao('CJ')));

create policy "usuario com acesso cj pode ler"
  on public.julgados_cj for select to authenticated
  using ((select public.tem_acesso_orgao('CJ')));

create policy "usuario com acesso creg pode inserir"
  on public.acervo_creg for insert to authenticated
  with check ((select public.tem_acesso_orgao('CREG')));

create policy "usuario com acesso creg pode ler"
  on public.julgados_creg for select to authenticated
  using ((select public.tem_acesso_orgao('CREG')));
```

Remover pelos nomes tanto as políticas antigas quanto as novas antes de
recriá-las, mantendo `schema.sql` reaplicável.

- [ ] **Step 5: Adicionar a guarda explícita às RPCs**

Depois da validação de sessão de cada RPC específica, incluir:

```sql
if not (select public.tem_acesso_orgao('CJ')) then
  raise exception 'acesso ao orgao CJ nao autorizado'
    using errcode = '42501';
end if;
```

Usar `CREG` nas três RPCs equivalentes. Em `historico_sorteios` e
`processos_sorteio`, primeiro preservar a validação de `p_colegiado` e depois
usar:

```sql
if not (select public.tem_acesso_orgao(p_colegiado)) then
  raise exception 'acesso ao orgao % nao autorizado', p_colegiado
    using errcode = '42501';
end if;
```

Repetir no arquivo de migração as oito definições completas de função; não usar
uma alteração textual parcial que deixe a produção diferente do estado final.

- [ ] **Step 6: Executar testes específicos e regressão de banco**

Run: `python tests/test_acesso.py`

Expected: PASS para todas as combinações permitidas e negadas.

Antes da regressão, no setup de `test_cj.py` e `test_creg.py`, logo após aplicar
`sql/schema.sql`, autorizar o usuário genérico que os testes existentes usam:

```python
PG.executar("""insert into public.permissoes_usuario (user_id, orgao) values
  ('00000000-0000-0000-0000-000000000001', 'CJ'),
  ('00000000-0000-0000-0000-000000000001', 'CREG')
on conflict (user_id, orgao) do nothing""")
```

Run: `python tests/test_cj.py`

Expected: PASS com o usuário de teste autorizado nos dois órgãos.

Run: `python tests/test_creg.py`

Expected: PASS com o mesmo usuário de teste autorizado nos dois órgãos.

- [ ] **Step 7: Commit**

```powershell
git add tests/test_acesso.py tests/test_cj.py tests/test_creg.py sql/schema.sql supabase/migrations/20260903160000_controle_acesso_por_orgao.sql
git commit -m "feat(db): restringir dados e funcoes por orgao"
```

---

### Task 3: Funções de autorização no cliente

**Files:**
- Modify: `tests/test_frontend.mjs`
- Modify: `assets/js/supabase.js:45-95,196-285`

**Interfaces:**
- Consumes: `api('rpc/orgaos_autorizados', {method: 'POST', body: '{}'}) -> Array<{orgao: string}>`.
- Produces: `buscarOrgaosAutorizados() -> Promise<Set<'CJ'|'CREG'>>`, `aplicarVisibilidadePorOrgao(Set, root)` e um `Error` marcado com `status = 403` e `semPermissao = true`.

- [ ] **Step 1: Escrever testes vermelhos para consulta e normalização**

No harness VM de `tests/test_frontend.mjs`, expor as novas funções ao final da
avaliação de `supabase.js` e registrar as chamadas de `api`. Cobrir:

```javascript
test('consulta no banco e aceita somente CJ e CREG sem duplicar', async () => {
  const pedidos = [];
  const page = supabasePage(async (caminho, opcoes) => {
    pedidos.push([caminho, opcoes]);
    return [{ orgao: 'CREG' }, { orgao: 'CJ' }, { orgao: 'CREG' }, { orgao: 'X' }];
  });

  assert.deepEqual([...await page.buscarOrgaosAutorizados()].sort(), ['CJ', 'CREG']);
  assert.equal(pedidos[0][0], 'rpc/orgaos_autorizados');
  assert.equal(pedidos[0][1].method, 'POST');
});
```

Adicionar teste de resposta vazia e confirmar que uma rejeição de rede é
propagada, não convertida em conjunto vazio.

- [ ] **Step 2: Executar o teste e confirmar o vermelho**

Run: `node --test --test-name-pattern="orgao|permiss" tests/test_frontend.mjs`

Expected: FAIL porque `buscarOrgaosAutorizados` ainda não existe.

- [ ] **Step 3: Implementar a consulta e a visibilidade mínima**

Em `assets/js/supabase.js`:

```javascript
const ORGAOS_CONHECIDOS = new Set(['CJ', 'CREG']);

async function buscarOrgaosAutorizados() {
  const linhas = await api('rpc/orgaos_autorizados', {
    method: 'POST',
    body: '{}'
  });
  return new Set((linhas || [])
    .map(linha => linha.orgao)
    .filter(orgao => ORGAOS_CONHECIDOS.has(orgao)));
}

function aplicarVisibilidadePorOrgao(orgaos, raiz = document) {
  raiz.querySelectorAll('[data-orgao]').forEach(elemento => {
    elemento.hidden = !orgaos.has(elemento.dataset.orgao);
  });
}

function erroSemPermissao() {
  return Object.assign(
    new Error('Seu usuário não possui acesso liberado. Procure o responsável pela manutenção.'),
    { status: 403, semPermissao: true }
  );
}
```

- [ ] **Step 4: Testar ocultação real dos elementos**

Adicionar três elementos `data-orgao` ao DOM mínimo e afirmar:

```javascript
page.aplicarVisibilidadePorOrgao(new Set(['CREG']), document);
assert.equal(controleCreg.hidden, false);
assert.equal(controleCj.hidden, true);

page.aplicarVisibilidadePorOrgao(new Set(['CJ', 'CREG']), document);
assert.equal(controleCreg.hidden, false);
assert.equal(controleCj.hidden, false);
```

Run: `node --test --test-name-pattern="orgao|permiss" tests/test_frontend.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/test_frontend.mjs assets/js/supabase.js
git commit -m "feat(web): consultar permissoes do usuario"
```

---

### Task 4: Gate de páginas, redirecionamento e navegação visível

**Files:**
- Modify: `tests/test_frontend.mjs`
- Modify: `assets/js/bootstrap.js:4-88`
- Modify: `assets/js/supabase.js:230-285`
- Modify: `index.html:89-128`

**Interfaces:**
- Consumes: `buscarOrgaosAutorizados`, `aplicarVisibilidadePorOrgao` e `erroSemPermissao` da Task 3.
- Produces: `resolverDestinoPermitido(paginaId, orgaos) -> string|null` e `carregarPaginaAutenticada()` que nunca chama `carregarScript` antes da autorização.

- [ ] **Step 1: Escrever testes vermelhos para a matriz de rotas**

Extrair `bootstrap.js` no VM do teste e cobrir a função pura:

```javascript
assert.equal(resolverDestinoPermitido('acervo-cj', new Set(['CREG'])), './acervo-creg.html');
assert.equal(resolverDestinoPermitido('julgados-creg', new Set(['CJ'])), './julgados-cj.html');
assert.equal(resolverDestinoPermitido('historico-cj', new Set(['CREG'])), './historico-creg.html');
assert.equal(resolverDestinoPermitido('acervo-cj', new Set(['CJ', 'CREG'])), null);
assert.equal(resolverDestinoPermitido('sorteio', new Set(['CJ'])), null);
```

Adicionar teste assíncrono provando a ordem: enquanto
`buscarOrgaosAutorizados()` estiver pendente, `carregarScript` não é chamado;
depois da resposta permitida, ele é chamado uma vez. No caso proibido,
`location.replace` recebe o equivalente e `carregarScript` permanece sem
chamadas.

- [ ] **Step 2: Executar e confirmar o vermelho**

Run: `node --test --test-name-pattern="redirecion|autoriza|carrega.*permiss" tests/test_frontend.mjs`

Expected: FAIL porque o bootstrap carrega o módulo antes de consultar o banco e
não conhece destinos equivalentes.

- [ ] **Step 3: Declarar órgão e família de cada página**

Ampliar `PAGINAS` em `assets/js/bootstrap.js` sem mudar nomes de arquivos ou
inicializadores:

```javascript
const PAGINAS = {
  sorteio: { arquivo: 'index.min.js', iniciar: 'inicializarSorteio', texto: 'Preparando o sorteio…' },
  'julgados-cj': { orgao: 'CJ', familia: 'julgados', arquivo: 'julgados.min.js', iniciar: 'inicializarJulgados', texto: 'Preparando as pautas…', carregamentoLocal: true },
  'julgados-creg': { orgao: 'CREG', familia: 'julgados', arquivo: 'julgados-creg.min.js', iniciar: 'inicializarJulgadosCreg', texto: 'Preparando as sessões…', carregamentoLocal: true },
  'acervo-cj': { orgao: 'CJ', familia: 'acervo', arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' },
  'acervo-creg': { orgao: 'CREG', familia: 'acervo', arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' },
  'historico-cj': { orgao: 'CJ', familia: 'historico', arquivo: 'historico.min.js', iniciar: 'inicializarHistorico', texto: 'Preparando o histórico…' },
  'historico-creg': { orgao: 'CREG', familia: 'historico', arquivo: 'historico.min.js', iniciar: 'inicializarHistorico', texto: 'Preparando o histórico…' }
};

const DESTINOS = {
  CJ: { acervo: './acervo-cj.html', julgados: './julgados-cj.html', historico: './historico-cj.html' },
  CREG: { acervo: './acervo-creg.html', julgados: './julgados-creg.html', historico: './historico-creg.html' }
};
```

`resolverDestinoPermitido` devolve `null` para página compartilhada ou
permitida; para página proibida, escolhe o primeiro órgão permitido na ordem
`CJ`, `CREG` e devolve o equivalente da mesma família.

- [ ] **Step 4: Colocar a consulta antes do módulo**

No início do `try` de `carregarPaginaAutenticada`:

```javascript
const orgaos = await buscarOrgaosAutorizados();
if (orgaos.size === 0) throw erroSemPermissao();

const destino = resolverDestinoPermitido(document.body.dataset.page, orgaos);
if (destino) {
  location.replace(destino);
  return;
}

aplicarVisibilidadePorOrgao(orgaos);
await carregarScript(`assets/js/${paginaAtual.arquivo}?v=${ASSET_VERSION}`);
```

No tratamento do erro `semPermissao`, chamar `encerrarSessao()`, reexibir
`loginScreen`, ocultar `btnSair` e preencher `loginErro`. Para falha de rede,
preservar a sessão e o botão de tentar novamente. Não tratar erro de rede como
permissão vazia.

- [ ] **Step 5: Marcar toda a navegação por órgão**

Em `index.html`, acrescentar `data-orgao="CREG"` ou `data-orgao="CJ"` aos oito
controles: dois botões de sorteio e os seis links de acervo, histórico e
julgados. Exemplo:

```html
<button id="btnCreg" class="mode-button" type="button" data-orgao="CREG">Conselho Regulador (CREG)</button>
<button id="btnCj" class="mode-button" type="button" data-orgao="CJ">Câmara de Julgamento (CJ)</button>
```

Adicionar teste que lê `index.html`, encontra exatamente quatro controles por
órgão e confirma que nenhum destino CJ/CREG ficou sem marcador.

- [ ] **Step 6: Executar os testes do gate e a suíte frontend completa**

Run: `node --test --test-name-pattern="redirecion|autoriza|orgao|permiss" tests/test_frontend.mjs`

Expected: PASS.

Run: `node --test tests/test_frontend.mjs`

Expected: PASS sem regressões no login, renovação de sessão, acervo, julgados e
histórico.

- [ ] **Step 7: Commit**

```powershell
git add tests/test_frontend.mjs assets/js/bootstrap.js assets/js/supabase.js index.html
git commit -m "feat(web): bloquear modulos sem permissao"
```

---

### Task 5: Artefatos publicados e regressão local completa

**Files:**
- Regenerate: `assets/js/supabase.min.js`
- Regenerate: `assets/js/bootstrap.min.js`
- Modify mechanically: `assets/js/supabase.js`, `index.html`, `julgados-cj.html`, `julgados-creg.html`, `acervo-cj.html`, `acervo-creg.html`, `historico-cj.html`, `historico-creg.html`, `404.html`

**Interfaces:**
- Consumes: fontes verdes das Tasks 1–4.
- Produces: os mesmos bytes que a etapa “Conferir versão e arquivos minificados” da CI recria.

- [ ] **Step 1: Validar sintaxe antes de gerar**

```powershell
Get-ChildItem assets/js/*.js,tools/*.mjs,tests/*.mjs | ForEach-Object { node --check $_.FullName }
```

Expected: exit code 0 para todos os arquivos.

- [ ] **Step 2: Gerar os JavaScripts alterados**

```powershell
npx --yes esbuild@0.28.2 assets/js/supabase.js --minify-syntax --minify-whitespace --outfile=assets/js/supabase.min.js
npx --yes esbuild@0.28.2 assets/js/bootstrap.js --minify-syntax --minify-whitespace --outfile=assets/js/bootstrap.min.js
node tools/versionar.mjs
```

Como o versionador altera `ASSET_VERSION` dentro de `supabase.js`, repetir a
minificação desse arquivo e executar o versionador uma segunda vez para provar
estabilidade:

```powershell
npx --yes esbuild@0.28.2 assets/js/supabase.js --minify-syntax --minify-whitespace --outfile=assets/js/supabase.min.js
node tools/versionar.mjs
```

Expected: a segunda execução imprime a mesma versão e não muda mais arquivos.

- [ ] **Step 3: Executar todas as suítes**

```powershell
node tests/test_sorteio.mjs
node --test tests/test_frontend.mjs
node tests/test_assets.mjs
python tests/test_acesso.py
python tests/test_cj.py
python tests/test_creg.py
python tests/test_sincronizacao.py
python tests/test_workflows.py
```

Expected: todas passam; testes que dependem de planilhas externas podem ser
marcados como pulados conforme o comportamento documentado do repositório.

- [ ] **Step 4: Reproduzir a checagem mecânica da CI**

Executar os mesmos comandos da etapa de geração da CI e então:

```powershell
git diff --exit-code -- assets/css/index.min.css assets/js/*.min.js assets/js/supabase.js *.html
git diff --check
```

Expected: o primeiro comando não encontra deriva gerada e o segundo não
encontra whitespace inválido.

- [ ] **Step 5: Commit**

```powershell
git add assets/js/supabase.js assets/js/supabase.min.js assets/js/bootstrap.min.js index.html julgados-cj.html julgados-creg.html acervo-cj.html acervo-creg.html historico-cj.html historico-creg.html 404.html
git commit -m "build: publicar controle de acesso por orgao"
```

---

### Task 6: Implantação e verificação no Supabase hospedado

**Files:**
- Rename when required: `supabase/migrations/20260903160000_controle_acesso_por_orgao.sql` para o prefixo exato registrado por `supabase_apply_migration`.

**Interfaces:**
- Consumes: SQL integral da migração local e project ID `giipnmpfclfudkzflwsv` (`sorteio-sei`).
- Produces: matriz real, políticas/RPCs protegidas, advisors revisados e ledger alinhado ao arquivo local.

- [ ] **Step 1: Confirmar estado remoto imediatamente antes da alteração**

Usar o app Supabase para listar migrações, consultar os quatro e-mails em
`auth.users`, consultar `pg_policies` e confirmar que não apareceu uma migração
concorrente com o mesmo nome. Nenhuma consulta deve retornar ou registrar
senhas/tokens.

- [ ] **Step 2: Rodar advisors pré-implantação**

Executar `supabase_get_advisors` para `security` e `performance` no projeto
`giipnmpfclfudkzflwsv`. Registrar separadamente achados preexistentes; não
expandir este trabalho para problemas não causados pela mudança.

- [ ] **Step 3: Aplicar a migração pelo app Supabase**

Ler o arquivo local integral e chamar `supabase_apply_migration` no mesmo
script de orquestração, para não reconstruir ou truncar o SQL:

```javascript
const arquivo = await tools.exec_command({
  // -Encoding UTF8 é obrigatório: sem ele o PowerShell 5.1 lê pelo codepage
  // ANSI e o arquivo chega ao banco com todo acento corrompido — foi o que
  // aconteceu aqui, e a migration 20260904131343 teve de recriar as 8 RPCs.
  cmd: 'Get-Content -Raw -Encoding UTF8 supabase\\migrations\\20260903160000_controle_acesso_por_orgao.sql',
  workdir: 'C:\\Users\\leonardo.amichi\\Documents\\sorteio-sei-auth'
});
await tools.mcp__codex_apps__supabase_apply_migration({
  project_id: 'giipnmpfclfudkzflwsv',
  name: 'controle_acesso_por_orgao',
  query: arquivo.output
});
```

O campo `query` deve receber os bytes reais lidos do arquivo, não texto
reconstruído manualmente. Não publicar o frontend se essa chamada falhar.

- [ ] **Step 4: Alinhar o nome local ao ledger remoto**

Chamar `supabase_list_migrations`, localizar `controle_acesso_por_orgao` e
comparar sua versão com `20260903160000`. Se o servidor registrar outra versão,
usar exatamente os dígitos devolvidos pelo campo `version` como prefixo do
mesmo arquivo local e repetir os testes de migração. Antes do rename, resolver
os dois caminhos absolutos e confirmar que ambos ficam dentro de
`C:\Users\leonardo.amichi\Documents\sorteio-sei-auth\supabase\migrations`.

- [ ] **Step 5: Verificar estrutura e matriz reais**

Com `supabase_execute_sql`, consultar:

```sql
select u.email, array_agg(p.orgao order by p.orgao) as orgaos
  from auth.users u
  join public.permissoes_usuario p on p.user_id = u.id
 where lower(u.email) in (
   'alberto.estrela@goias.gov.br', 'terezinha.bueno@goias.gov.br',
   'lucas.coelho@goias.gov.br', 'sec-agr@goias.gov.br'
 )
 group by u.email
 order by u.email;
```

Expected: Alberto `[CREG]`, Terezinha `[CJ]`, Lucas e `sec-agr` `[CJ,CREG]`.

Também consultar `pg_policies`, `information_schema.role_routine_grants` e
`pg_get_functiondef` para provar que as quatro políticas têm predicado por
órgão, as duas funções auxiliares não são executáveis por `anon`/`PUBLIC`, e as
oito RPCs privilegiadas contêm a guarda `tem_acesso_orgao`.

- [ ] **Step 6: Exercitar decisões permitidas e negadas no banco real sem persistir dados**

Em transações com `SET LOCAL ROLE authenticated` e `set_config` apontando para
os UUIDs reais já consultados, executar `orgaos_autorizados`, uma RPC permitida
e a RPC equivalente proibida para Alberto e Terezinha. Encerrar com `ROLLBACK`.
O permitido deve responder; o proibido deve produzir `42501`. Para Lucas e
`sec-agr`, ambas as RPCs devem responder. Não inserir processos reais neste
teste.

- [ ] **Step 7: Rodar advisors pós-implantação**

Executar novamente advisors `security` e `performance`. Expected: nenhum novo
aviso causado por `permissoes_usuario`, suas políticas ou funções. Se houver
novo aviso, corrigir primeiro no schema/migração, aplicar uma migração corretiva
nomeada e repetir as verificações; não ocultar ou ignorar o achado.

- [ ] **Step 8: Commit de alinhamento, se necessário**

Se o prefixo da migração mudou ou uma correção foi necessária:

```powershell
git add supabase/migrations sql/schema.sql tests
git commit -m "chore(db): alinhar migracao de permissoes"
```

Run: `git status --short`

Expected: árvore limpa.

---

### Task 7: Auditoria final dos critérios de aceite

**Files:**
- Verify only: `docs/superpowers/specs/2026-09-03-controle-acesso-por-orgao-design.md`
- Verify only: todos os arquivos e estados produzidos nas Tasks 1–6

**Interfaces:**
- Consumes: testes locais, schema/migração, estado do projeto hospedado e artefatos publicados.
- Produces: evidência requisito a requisito e entrega final sem trabalho pendente.

- [ ] **Step 1: Mapear evidência para cada usuário**

Registrar a saída dos testes e consultas que prova:

- Alberto: CREG permitido; CJ negado em navegação, URL, RLS e RPC.
- Terezinha: CJ permitido; CREG negado em navegação, URL, RLS e RPC.
- Lucas e `sec-agr`: CJ e CREG permitidos.
- Usuário não mapeado: nenhum módulo carregado e nenhuma operação de dados.

- [ ] **Step 2: Mapear evidência para cada camada**

Confirmar explicitamente:

- oito controles de navegação marcados e filtrados;
- seis páginas específicas cobertas pela matriz de redirecionamento;
- módulo funcional carregado somente depois de `orgaos_autorizados`;
- quatro políticas RLS sem `true` permissivo;
- oito RPCs `SECURITY DEFINER` com guarda de órgão;
- nenhuma alteração nas regras de login, refresh token, logout ou jobs diretos.

- [ ] **Step 3: Repetir verificação limpa final**

```powershell
node --test tests/test_frontend.mjs
python tests/test_acesso.py
python tests/test_cj.py
python tests/test_creg.py
git diff --check
git status --short
```

Expected: testes verdes, nenhuma deriva e árvore limpa.

- [ ] **Step 4: Encerrar o objetivo somente com toda evidência presente**

Marcar o objetivo como concluído apenas quando o banco hospedado, os arquivos
locais, os testes e todos os critérios acima estiverem verificados. Informar ao
usuário os commits, a versão da migração remota, os resultados das suítes e
qualquer limitação concreta de teste manual que tenha permanecido.
