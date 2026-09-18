# Exclusão de julgados e distribuições no painel administrativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao `admin.html` um botão "Excluir" que remove, na Câmara (CJ) e no Conselho (CREG), um julgado, uma distribuição do acervo, ou a distribuição junto com os julgados ligados a ela — com motivo obrigatório e a linha inteira guardada na auditoria.

**Architecture:** Três portas `SECURITY DEFINER` por colegiado, com a intenção no nome (`admin_excluir_julgado_*`, `admin_excluir_distribuicao_*`, `admin_excluir_distribuicao_e_julgados_*`), sobre um corpo interno revogado; cada linha apagada vira uma linha em `auditoria_admin` com `antes = to_jsonb(linha)` e `depois = {}`. No navegador, o `<dialog>` de duas etapas que já existe ganha um modo `perigo` (motivo obrigatório, preview obrigatório, rótulos e tom vermelho), e os detalhes de sessão e de distribuição ganham o botão na linha.

**Tech Stack:** HTML estático, JavaScript ES2022 sem build (esbuild só minifica), CSS puro com tokens em `:root`, PostgreSQL 15/17 (Supabase/PostgREST), Python 3.11 + psycopg2 para testes de banco, Node 22 `node:test` para testes de front.

**Spec:** `docs/superpowers/specs/2026-09-17-exclusao-painel-admin-design.md`

## Global Constraints

- Exclusão física: a linha sai de `acervo_*`/`julgados_*`; `auditoria_admin.antes` guarda `to_jsonb(linha)` completo e `depois` guarda `'{}'::jsonb`.
- Excluir só a distribuição **não** apaga julgados: eles recebem `acervo_id = null` e mantêm relator/unidade, defesa/recurso e datas copiados.
- Motivo obrigatório: o banco recusa `null`/vazio/só espaços com `errcode = '22023'`; o navegador recusa antes de chamar a porta, nas duas etapas.
- Nenhuma policy de DELETE é criada. Só as funções nomeadas apagam; o corpo compartilhado é revogado de `public, anon, authenticated, service_role`.
- Ordem das recusas no banco: `admin_exigir` (sessão → colegiado → papel) antes de qualquer validação de entrada.
- Vocabulário único na tela: "Excluir"/"Exclusão", "distribuição", "julgado". Nunca "sorteio" ou "rodada" para a linha do acervo.
- Só tokens existentes: `--danger`, `--danger-hover`, `--danger-soft`, `--danger-panel`, `--danger-panel-text`, `--danger-panel-border`, `--border-subtle`, `--muted`. Nenhuma cor, sombra ou raio novo.
- Antes de editar CSS/HTML (Tasks 2–4), rode `C:/Users/leonardo.amichi/.claude/skills/impeccable/scripts/impeccable context --target admin.html` e leia `C:/Users/leonardo.amichi/.claude/skills/impeccable/reference/craft-floor.md`.
- Publicação: a migração vai ao banco hospedado **antes** do front. `sql/schema.sql`, a migração local, os `.min.*` e os `?v=` terminam sincronizados.
- Trabalhe numa branch: `git switch -c feat/exclusao-painel-admin`.

---

## File Structure

- Create: `supabase/migrations/20260917140000_exclusao_painel_admin.sql` — as seis portas, os dois corpos e a `admin_auditoria` que acha o número de um registro excluído.
- Modify: `sql/schema.sql` — mesmo conteúdo no estado final (fim do arquivo) e `admin_auditoria` substituída no lugar.
- Modify: `tests/test_admin.py` — testes de banco das exclusões.
- Modify: `assets/js/admin.js` — modo `perigo` do diálogo, diálogos de exclusão, botão na linha, volta à lista, auditoria de exclusões.
- Modify: `admin.html` — ids para rótulo do motivo e texto da revisão; lead e meta description.
- Modify: `assets/css/index.css` — botão de linha, tom destrutivo do diálogo, larguras das colunas de Ações.
- Modify: `tests/test_frontend.mjs` — harness com os ids novos e testes do fluxo.
- Regenerate: `assets/js/admin.min.js`, `assets/css/index.min.css`, `?v=` dos HTMLs e `ASSET_VERSION` via `tools/versionar.mjs`.
- Modify: `README.md` (descrição de `test_admin.py`), `AUDITORIA.md` (contagens de testes).

---

### Task 1: Banco — portas de exclusão com retrato na auditoria

**Files:**
- Create: `supabase/migrations/20260917140000_exclusao_painel_admin.sql`
- Modify: `sql/schema.sql` (função `admin_auditoria`, ~linha 2019; fim do arquivo)
- Test: `tests/test_admin.py` (nova seção antes de `# ── Integridade`)

**Interfaces:**
- Produces (RPCs chamadas pelo front via `rpc/<nome>` com corpo `{ p_id, p_motivo }`):
  - `admin_excluir_julgado_cj(p_id bigint, p_motivo text) returns jsonb`
  - `admin_excluir_julgado_creg(p_id bigint, p_motivo text) returns jsonb`
  - `admin_excluir_distribuicao_cj(p_id bigint, p_motivo text) returns jsonb`
  - `admin_excluir_distribuicao_creg(p_id bigint, p_motivo text) returns jsonb`
  - `admin_excluir_distribuicao_e_julgados_cj(p_id bigint, p_motivo text) returns jsonb`
  - `admin_excluir_distribuicao_e_julgados_creg(p_id bigint, p_motivo text) returns jsonb`
  - Retorno de todas: `{ "operacao": text, "num_processo": text, "acervo": [bigint], "julgados": [bigint], "desvinculados": [bigint] }` — `acervo` = distribuições apagadas, `julgados` = julgados apagados, `desvinculados` = julgados que perderam o vínculo.
  - Operações gravadas em `auditoria_admin.operacao`: `excluir_julgado`, `excluir_distribuicao`, `excluir_distribuicao_e_julgados`.
  - `admin_auditoria(...)`: mesma assinatura; `num_processo` passa a vir do retrato quando o registro não existe mais.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/test_admin.py`, logo antes da linha `# ── Integridade ──────...`, acrescente:

```python
# ── Exclusão ─────────────────────────────────────────────────────────────────
# A primeira porta que DESTRÓI dado. O que se persegue: só admin chama, o
# motivo é exigido, a auditoria guarda a linha inteira, e excluir só a
# distribuição deixa os julgados de pé — sem vínculo, com a cópia intacta.

@teste
def exclusao_so_para_admin(cur):
    _, acervo_cj, julgado_cj = cenario_cj(cur)
    _, acervo_creg, julgado_creg = cenario_creg(cur)
    cur.connection.commit()

    escritas = [
        ("select public.admin_excluir_julgado_cj(%s, 'teste')", (julgado_cj,)),
        ("select public.admin_excluir_distribuicao_cj(%s, 'teste')", (acervo_cj,)),
        ("select public.admin_excluir_distribuicao_e_julgados_cj(%s, 'teste')", (acervo_cj,)),
        ("select public.admin_excluir_julgado_creg(%s, 'teste')", (julgado_creg,)),
        ("select public.admin_excluir_distribuicao_creg(%s, 'teste')", (acervo_creg,)),
        ("select public.admin_excluir_distribuicao_e_julgados_creg(%s, 'teste')", (acervo_creg,)),
    ]
    for sql, args in escritas:
        for nome in OPERADORES + ['sem-acesso']:
            autenticar(cur, nome)
            deve_negar(cur, sql, args)


@teste
def corpo_da_remocao_nao_e_porta(cur):
    """Só as funções que declaram a intenção ficam ao alcance do PostgREST."""
    _, acervo_cj, _ = cenario_cj(cur)
    _, acervo_creg, _ = cenario_creg(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    deve_negar(cur, "select public.admin_remover_acervo_cj(%s, true, 'excluir_distribuicao', 'x')",
               (acervo_cj,))
    autenticar(cur, 'lucas')
    deve_negar(cur, "select public.admin_remover_acervo_creg(%s, true, 'excluir_distribuicao', 'x')",
               (acervo_creg,))


@teste
def exclusao_exige_motivo(cur):
    _, acervo_id, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    for sql, args in [
        ('select public.admin_excluir_julgado_cj(%s, %s)', (julgado_id, '   ')),
        ('select public.admin_excluir_distribuicao_cj(%s, %s)', (acervo_id, None)),
        ('select public.admin_excluir_distribuicao_e_julgados_cj(%s, %s)', (acervo_id, '')),
    ]:
        autenticar(cur, 'lucas')
        deve_falhar(cur, sql, args, codigo='22023')

    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'id') == (julgado_id,)
    assert como_dono(cur, 'select count(*) from public.acervo_cj where id = %s', (acervo_id,)) == 1


@teste
def exclusao_recusa_registro_inexistente(cur):
    autenticar(cur, 'lucas')
    deve_falhar(cur, "select public.admin_excluir_julgado_cj(-1, 'x')", codigo='22023')
    autenticar(cur, 'lucas')
    deve_falhar(cur, "select public.admin_excluir_distribuicao_creg(-1, 'x')", codigo='22023')


@teste
def excluir_julgado_guarda_a_linha_inteira_na_auditoria(cur):
    num, acervo_id, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_excluir_julgado_cj(%s, 'importado em duplicidade')",
                (julgado_id,))
    retorno = cur.fetchone()[0]
    assert retorno['operacao'] == 'excluir_julgado'
    assert retorno['num_processo'] == num
    assert (retorno['acervo'], retorno['julgados'], retorno['desvinculados']) == ([], [julgado_id], [])

    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'id') is None
    assert como_dono(cur, 'select count(*) from public.acervo_cj where id = %s', (acervo_id,)) == 1
    [(operacao, antes, depois, motivo, feito_por)] = auditoria(cur, 'julgados_cj', julgado_id)
    assert operacao == 'excluir_julgado'
    assert (antes['num_processo'], antes['voto'], antes['relator']) == (num, 'Manter', 'CJ3')
    assert depois == {}
    assert motivo == 'importado em duplicidade'
    assert feito_por == 'lucas@goias.gov.br'


@teste
def excluir_so_a_distribuicao_desvincula_e_preserva_a_copia(cur):
    num, acervo_id, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_excluir_distribuicao_cj(%s, 'sorteio lançado em dobro')",
                (acervo_id,))
    retorno = cur.fetchone()[0]
    assert (retorno['acervo'], retorno['julgados'], retorno['desvinculados']) == \
        ([acervo_id], [], [julgado_id])

    cur.execute('reset role')
    assert como_dono(cur, 'select count(*) from public.acervo_cj where id = %s', (acervo_id,)) == 0
    assert julgado(cur, 'julgados_cj', julgado_id,
                   'acervo_id, relator, data_distribuicao::text') == (None, 'CJ3', '2026-06-18')
    [(op_a, antes_a, depois_a, _, _)] = auditoria(cur, 'acervo_cj', acervo_id)
    assert (op_a, antes_a['num_processo'], depois_a) == ('excluir_distribuicao', num, {})
    [(op_j, antes_j, depois_j, _, _)] = auditoria(cur, 'julgados_cj', julgado_id)
    assert (op_j, antes_j, depois_j) == \
        ('excluir_distribuicao', {'acervo_id': acervo_id}, {'acervo_id': None})


@teste
def excluir_distribuicao_e_julgados_apaga_os_dois(cur):
    num, acervo_id, julgado_id = cenario_cj(cur)
    segundo = como_dono(cur, """
        insert into public.julgados_cj (num_processo, data_sessao, pauta)
        values (%s, '2026-08-06', 27) returning id""", (num,))
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_excluir_distribuicao_e_julgados_cj(%s, 'processo de outro órgão')",
                (acervo_id,))
    retorno = cur.fetchone()[0]
    assert retorno['acervo'] == [acervo_id]
    assert sorted(retorno['julgados']) == sorted([julgado_id, segundo])
    assert retorno['desvinculados'] == []

    cur.execute('reset role')
    assert como_dono(cur, 'select count(*) from public.julgados_cj where num_processo = %s', (num,)) == 0
    assert como_dono(cur, 'select count(*) from public.acervo_cj where num_processo = %s', (num,)) == 0
    assert como_dono(cur, """select count(*) from public.auditoria_admin
                              where operacao = 'excluir_distribuicao_e_julgados'
                                and depois = '{}'::jsonb
                                and antes ->> 'num_processo' = %s""", (num,)) == 3


@teste
def exclusao_do_conselho_segue_a_mesma_regra(cur):
    num, acervo_id, julgado_id = cenario_creg(cur)
    outro_num, outro_acervo, outro_julgado = cenario_creg(cur)
    cur.connection.commit()
    autenticar(cur, 'sec-agr')
    cur.execute("select public.admin_excluir_distribuicao_creg(%s, 'unidade errada')", (acervo_id,))
    assert cur.fetchone()[0]['desvinculados'] == [julgado_id]
    cur.execute("select public.admin_excluir_distribuicao_e_julgados_creg(%s, 'duplicado')",
                (outro_acervo,))
    assert cur.fetchone()[0]['julgados'] == [outro_julgado]
    cur.execute("select public.admin_excluir_julgado_creg(%s, 'pauta errada')", (julgado_id,))
    assert cur.fetchone()[0]['julgados'] == [julgado_id]

    cur.execute('reset role')
    assert como_dono(cur, """select count(*) from public.julgados_creg
                              where num_processo in (%s, %s)""", (num, outro_num)) == 0
    [(_, antes, depois, _, _)] = auditoria(cur, 'acervo_creg', acervo_id)
    assert (antes['interessado'], depois) == ('Fulano de Tal', {})


@teste
def auditoria_identifica_o_processo_de_um_registro_excluido(cur):
    """Sem o retrato, a linha da exclusão dizia "processo não localizado"."""
    num, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_julgado_cj(%s, '{\"voto\":\"Anular\"}'::jsonb, null)",
                (julgado_id,))
    cur.execute("select public.admin_excluir_julgado_cj(%s, 'duplicado')", (julgado_id,))
    cur.execute("""select operacao, num_processo from public.admin_auditoria('CJ', 10, null)
                    where tabela = 'julgados_cj' and registro_id = %s
                    order by id""", (julgado_id,))
    assert cur.fetchall() == [('corrigir_julgado', num), ('excluir_julgado', num)]


@teste
def exclusoes_nao_deixam_erro_na_verificacao(cur):
    _, acervo_cj, _ = cenario_cj(cur)
    _, outro_cj, _ = cenario_cj(cur)
    _, acervo_creg, julgado_creg = cenario_creg(cur)
    cur.connection.commit()

    autenticar(cur, 'lucas')
    cur.execute("select public.admin_excluir_distribuicao_cj(%s, 'x')", (acervo_cj,))
    cur.execute("select public.admin_excluir_distribuicao_e_julgados_cj(%s, 'x')", (outro_cj,))
    cur.execute("select public.admin_excluir_distribuicao_creg(%s, 'x')", (acervo_creg,))
    cur.execute("select public.admin_excluir_julgado_creg(%s, 'x')", (julgado_creg,))
    cur.connection.commit()

    cur.execute('reset role')
    for arquivo in ['verificacao_cj.sql', 'verificacao_creg.sql']:
        cur.execute((RAIZ / 'sql' / arquivo).read_text(encoding='utf-8'))
        erros = [linha for linha in cur.fetchall() if linha[1] == 'ERRO']
        assert not erros, f'{arquivo}: {erros}'
```

Nota: o `order by id` do penúltimo teste ordena pela coluna `id` que `admin_auditoria` devolve.

- [ ] **Step 2: Rodar e ver falhar**

Run: `python tests/test_admin.py`
Expected: as dez funções novas aparecem como `FALHA ... UndefinedFunction: function public.admin_excluir_...` (ou `AssertionError` em `auditoria_identifica_o_processo_de_um_registro_excluido`); as demais continuam `ok`.

- [ ] **Step 3: Escrever a migração**

Crie `supabase/migrations/20260917140000_exclusao_painel_admin.sql`:

```sql
-- ── Exclusão pelo painel administrativo ──────────────────────────────────────
-- A porta que faltava: um registro que não deveria existir — distribuição
-- lançada em duplicidade na carga de ata, julgado de outro órgão importado da
-- pauta — só saía por SQL direto no banco, sem rastro nenhum.
--
-- As três regras de 20260908120000 continuam valendo:
--
--   1. as tabelas seguem sem policy de DELETE: só funções nomeadas apagam;
--   2. a intenção mora no NOME. excluir_julgado, excluir_distribuicao (os
--      julgados ficam, sem vínculo) e excluir_distribuicao_e_julgados são
--      portas diferentes, e não um booleano do cliente;
--   3. nada é silencioso. A auditoria guarda a LINHA INTEIRA em `antes` e `{}`
--      em `depois`. As correções guardam só as colunas tocadas; numa exclusão
--      todas foram, e o retrato é a única memória do registro — é dele que uma
--      restauração por SQL partiria. Isso inclui `interessado` do Conselho, que
--      já está no banco e continua legível só por admin do próprio órgão (RLS
--      de auditoria_admin).
--
-- O motivo é obrigatório aqui, e só aqui: numa correção o valor anterior
-- explica a si mesmo; numa exclusão não sobra registro para explicar nada.

-- ── Julgado ──────────────────────────────────────────────────────────────────
-- Nada referencia julgados_*: apagar a linha não derruba vínculo de ninguém.
--
-- Consequência que a tela avisa: sincronizar.py filtra pautas pela URL e insere
-- com `on conflict do nothing`. Se a AGR republicar a pauta numa URL nova, o
-- processo volta a ser importado.
create or replace function public.admin_excluir_julgado_cj(p_id bigint, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes public.julgados_cj%rowtype;
begin
  perform public.admin_exigir('CJ');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.julgados_cj where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  delete from public.julgados_cj j where j.id = p_id;
  perform public.auditar('CJ', 'excluir_julgado', 'julgados_cj', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', 'excluir_julgado', 'num_processo', antes.num_processo,
                            'acervo', '[]'::jsonb, 'julgados', jsonb_build_array(p_id),
                            'desvinculados', '[]'::jsonb);
end;
$$;

create or replace function public.admin_excluir_julgado_creg(p_id bigint, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes public.julgados_creg%rowtype;
begin
  perform public.admin_exigir('CREG');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.julgados_creg where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  delete from public.julgados_creg k where k.id = p_id;
  perform public.auditar('CREG', 'excluir_julgado', 'julgados_creg', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', 'excluir_julgado', 'num_processo', antes.num_processo,
                            'acervo', '[]'::jsonb, 'julgados', jsonb_build_array(p_id),
                            'desvinculados', '[]'::jsonb);
end;
$$;

-- ── Distribuição ─────────────────────────────────────────────────────────────
-- Um corpo, duas portas, como em admin_alterar_acervo_*. O que muda é o destino
-- dos julgados que apontam para a linha — e a FK (sem ON DELETE) exige que eles
-- saiam do caminho ANTES do DELETE:
--
--   excluir_distribuicao            -> desvincula. acervo_id NÃO está no
--                                      `update of` do gatilho de derivação,
--                                      então gravar null ali não redispara nada
--                                      e a cópia (relator/unidade, defesa/
--                                      recurso, datas) fica como está — é o
--                                      registro de quem levou o processo à mesa;
--   excluir_distribuicao_e_julgados -> apaga os julgados junto, cada um com o
--                                      seu retrato.
--
-- Ordem das travas igual à da correção de acervo: a distribuição primeiro, os
-- julgados depois.
create or replace function public.admin_remover_acervo_cj(
  p_id bigint, p_com_julgados boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes     public.acervo_cj%rowtype;
  vinculado public.julgados_cj%rowtype;
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
begin
  perform public.admin_exigir('CJ');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.acervo_cj where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  for vinculado in
    select * from public.julgados_cj j where j.acervo_id = p_id order by j.id for update
  loop
    if p_com_julgados then
      delete from public.julgados_cj j where j.id = vinculado.id;
      perform public.auditar('CJ', p_operacao, 'julgados_cj', vinculado.id,
                             to_jsonb(vinculado), '{}'::jsonb, p_motivo);
      julgados := julgados || vinculado.id;
    else
      update public.julgados_cj j
         set acervo_id = null, atualizado_em = now(), atualizado_por = public.auth_email()
       where j.id = vinculado.id;
      perform public.auditar('CJ', p_operacao, 'julgados_cj', vinculado.id,
                             jsonb_build_object('acervo_id', p_id),
                             jsonb_build_object('acervo_id', null), p_motivo);
      desvinculados := desvinculados || vinculado.id;
    end if;
  end loop;

  delete from public.acervo_cj a where a.id = p_id;
  perform public.auditar('CJ', p_operacao, 'acervo_cj', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', p_operacao, 'num_processo', antes.num_processo,
                            'acervo', jsonb_build_array(p_id), 'julgados', to_jsonb(julgados),
                            'desvinculados', to_jsonb(desvinculados));
end;
$$;

create or replace function public.admin_remover_acervo_creg(
  p_id bigint, p_com_julgados boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes     public.acervo_creg%rowtype;
  vinculado public.julgados_creg%rowtype;
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
begin
  perform public.admin_exigir('CREG');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.acervo_creg where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  for vinculado in
    select * from public.julgados_creg k where k.acervo_id = p_id order by k.id for update
  loop
    if p_com_julgados then
      delete from public.julgados_creg k where k.id = vinculado.id;
      perform public.auditar('CREG', p_operacao, 'julgados_creg', vinculado.id,
                             to_jsonb(vinculado), '{}'::jsonb, p_motivo);
      julgados := julgados || vinculado.id;
    else
      update public.julgados_creg k
         set acervo_id = null, atualizado_em = now(), atualizado_por = public.auth_email()
       where k.id = vinculado.id;
      perform public.auditar('CREG', p_operacao, 'julgados_creg', vinculado.id,
                             jsonb_build_object('acervo_id', p_id),
                             jsonb_build_object('acervo_id', null), p_motivo);
      desvinculados := desvinculados || vinculado.id;
    end if;
  end loop;

  delete from public.acervo_creg b where b.id = p_id;
  perform public.auditar('CREG', p_operacao, 'acervo_creg', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', p_operacao, 'num_processo', antes.num_processo,
                            'acervo', jsonb_build_array(p_id), 'julgados', to_jsonb(julgados),
                            'desvinculados', to_jsonb(desvinculados));
end;
$$;

create or replace function public.admin_excluir_distribuicao_cj(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_cj(p_id, false, 'excluir_distribuicao', p_motivo)
$$;

create or replace function public.admin_excluir_distribuicao_e_julgados_cj(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_cj(p_id, true, 'excluir_distribuicao_e_julgados', p_motivo)
$$;

create or replace function public.admin_excluir_distribuicao_creg(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_creg(p_id, false, 'excluir_distribuicao', p_motivo)
$$;

create or replace function public.admin_excluir_distribuicao_e_julgados_creg(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_creg(p_id, true, 'excluir_distribuicao_e_julgados', p_motivo)
$$;

-- ── Auditoria: o número de um registro que não existe mais ────────────────────
-- A busca pelo número ATUAL volta vazia depois da exclusão, e a linha dizia
-- "processo não localizado" justamente no registro mais importante do rastro.
-- O retrato da exclusão (depois = {}) guarda o último número; vale para a
-- própria linha da exclusão e para as correções que o registro recebeu antes
-- de sair. O índice (tabela, registro_id, id) atende a subconsulta.
create or replace function public.admin_auditoria(
  p_colegiado text, p_limite int default 50, p_antes_de bigint default null)
returns table (id bigint, operacao text, tabela text, registro_id bigint,
               num_processo text, antes jsonb, depois jsonb, motivo text,
               feito_por text, feito_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  select a.id, a.operacao, a.tabela, a.registro_id,
         -- Chave interna não identifica nada para quem opera o sistema: o
         -- rastro precisa dizer de QUAL processo se trata. É o número ATUAL do
         -- registro, não o da época da alteração — é ele que a pessoa tem em
         -- mãos ao procurar. Quando a própria alteração foi o número, o
         -- antes/depois do delta já conta a história.
         coalesce(
           case a.tabela
             when 'julgados_cj'   then (select j.num_processo from public.julgados_cj j
                                         where j.id = a.registro_id)
             when 'julgados_creg' then (select k.num_processo from public.julgados_creg k
                                         where k.id = a.registro_id)
             when 'acervo_cj'     then (select c.num_processo from public.acervo_cj c
                                         where c.id = a.registro_id)
             when 'acervo_creg'   then (select d.num_processo from public.acervo_creg d
                                         where d.id = a.registro_id)
           end,
           (select e.antes ->> 'num_processo'
              from public.auditoria_admin e
             where e.tabela = a.tabela
               and e.registro_id = a.registro_id
               and e.depois = '{}'::jsonb
             order by e.id desc
             limit 1)),
         a.antes, a.depois, a.motivo, a.feito_por, a.feito_em
    from public.auditoria_admin a
   where a.orgao = p_colegiado
     and (p_antes_de is null or a.id < p_antes_de)
   order by a.id desc
   limit greatest(1, least(coalesce(p_limite, 50), 500));
end;
$$;

-- ── Privilégios ──────────────────────────────────────────────────────────────
-- Os corpos não são portas: só as funções nomeadas, que declaram a intenção,
-- ficam ao alcance de quem chama pelo PostgREST.
revoke all on function public.admin_remover_acervo_cj(bigint, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_remover_acervo_creg(bigint, boolean, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_excluir_julgado_cj(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_julgado_creg(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_cj(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_creg(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_e_julgados_cj(bigint, text)
  from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_e_julgados_creg(bigint, text)
  from public, anon, service_role;
revoke all on function public.admin_auditoria(text, int, bigint) from public, anon, service_role;

grant execute on function public.admin_excluir_julgado_cj(bigint, text) to authenticated;
grant execute on function public.admin_excluir_julgado_creg(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_cj(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_creg(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_e_julgados_cj(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_e_julgados_creg(bigint, text) to authenticated;
grant execute on function public.admin_auditoria(text, int, bigint) to authenticated;
```

- [ ] **Step 4: Levar o mesmo conteúdo para `sql/schema.sql`**

Os testes carregam `sql/schema.sql`, não a migração.

1. Em `sql/schema.sql`, dentro de `create or replace function public.admin_auditoria` (~linha 2021), troque o bloco `case a.tabela ... end,` pelo `coalesce(case ... end, (select e.antes ->> 'num_processo' ...)),` exatamente como está na migração, incluindo o comentário "Registro excluído" da seção de auditoria. Mantenha o `drop function if exists public.admin_auditoria(text, int, bigint);` que já precede a função.
2. No fim de `sql/schema.sql`, cole da migração as seções **Julgado**, **Distribuição** e **Privilégios** (tudo, menos a seção de auditoria, que já foi tratada no item 1), com os comentários.

- [ ] **Step 5: Rodar e ver passar**

Run: `python tests/test_admin.py`
Expected: todas `ok`, inclusive `schema_pode_ser_reaplicado`; última linha `68/68 testes passaram.` (58 atuais + 10 novas; se o total de partida for outro, o critério é zero `FALHA`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260917140000_exclusao_painel_admin.sql sql/schema.sql tests/test_admin.py
git commit -m "feat(db,admin): portas de exclusão de julgado e distribuição com retrato na auditoria"
```

---

### Task 2: Painel — modo destrutivo do diálogo e os dois fluxos de exclusão

**Files:**
- Modify: `admin.html` (lead, meta description, bloco `.admin-review-intro`, label do motivo)
- Modify: `assets/js/admin.js` (constantes do topo, `pintarProcessosDaSessao`, `pintarProcessosDoSorteio`, `abrirDialogo`, `passo`, nova seção `// ── Exclusão`)
- Test: `tests/test_frontend.mjs` (`adminPage` e testes novos ao fim da seção do painel)

**Interfaces:**
- Consumes: as seis RPCs da Task 1 (`rpc/admin_excluir_julgado_{cj,creg}`, `rpc/admin_excluir_distribuicao_{cj,creg}`, `rpc/admin_excluir_distribuicao_e_julgados_{cj,creg}`), corpo `{ p_id, p_motivo }`, retorno `{ operacao, num_processo, acervo, julgados, desvinculados }`; `rpc/admin_julgados_do_acervo` já existente.
- Produces:
  - `abrirDialogo({ ..., perigo = false })` — com `perigo: true`: motivo obrigatório, falha do `impacto` bloqueia a revisão, rótulos de exclusão, `dialogo.dataset.tom = 'perigo'`, `btnAvancarEdicao` com classe `button-perigo` na etapa 2.
  - `impacto()` pode devolver `string[]` (como hoje) ou `{ titulo?: string, tom?: 'perigo'|'atencao', itens: string[] }`; o `tom` vai para `edicaoImpacto.dataset.tom`.
  - Classe de botão de linha `admin-acao-perigo` (via `botaoDeLinha(..., { tom: 'perigo' })`), estilizada na Task 4.
  - Ids em `admin.html`: `edicaoMotivoRotulo`, `edicaoMotivoOpcional`, `edicaoRevisaoTitulo`, `edicaoRevisaoTexto`.

- [ ] **Step 1: Atualizar o harness e escrever os testes que falham**

Em `tests/test_frontend.mjs`, na função `adminPage`, acrescente os quatro ids à lista de `document.add(id, 'div')`:

```js
   'edicaoImpactoTitulo', 'edicaoImpactoLista', 'edicaoErro', 'edicaoEtapaRotulo',
   'edicaoMotivoRotulo', 'edicaoMotivoOpcional', 'edicaoRevisaoTitulo', 'edicaoRevisaoTexto']
```

No fim da seção do painel administrativo, acrescente:

```js
// ── Exclusão ─────────────────────────────────────────────────────────────────
// A primeira ação do painel que não deixa nada no lugar. O que se persegue: o
// motivo é exigido nas duas etapas, a lista do que some não pode faltar, cada
// alcance bate na sua porta, e uma correção aberta depois não herda o vermelho.
const RESULTADO_EXCLUSAO = { operacao: 'excluir_julgado', num_processo: '202600000000001',
                             acervo: [], julgados: [41], desvinculados: [] };

async function abrirExclusaoNaSessao(chamadas, respostas = {}) {
  const page = adminPage({ api: apiDoPainel(chamadas, respostas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.acao(0, 'Abrir sessão').dispatch('click');
  await wait();
  page.acao(0, 'Excluir').dispatch('click');
  return page;
}

async function abrirExclusaoNaDistribuicao(chamadas, respostas = {}) {
  const page = adminPage({ api: apiDoPainel(chamadas, respostas) });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('sorteios').dispatch('click');
  await wait();
  page.acao(0, 'Abrir distribuição').dispatch('click');
  await wait();
  page.acao(0, 'Excluir').dispatch('click');
  return page;
}

test('excluir e a ultima acao da linha e diz de qual processo', async () => {
  for (const abrir of ['sessao', 'distribuicao']) {
    const page = adminPage({ api: apiDoPainel([]) });
    await page.inicializarAdmin(new Set(['CJ']));
    if (abrir === 'distribuicao') {
      page.botaoDeAba('sorteios').dispatch('click');
      await wait();
      page.acao(0, 'Abrir distribuição').dispatch('click');
    } else {
      page.acao(0, 'Abrir sessão').dispatch('click');
    }
    await wait();
    const botoes = page.linhasDaTabela()[0].children
      .find(c => c.dataset.label === 'Ações').children[0].children;
    const ultimo = botoes.at(-1);
    assert.equal(ultimo.textContent, 'Excluir', abrir);
    assert.equal(ultimo.getAttribute('aria-label'), 'Excluir processo 202600000000001', abrir);
    assert.ok(ultimo.classList.contains('admin-acao-perigo'), abrir);
  }
});

test('exclusao nao avanca sem motivo, nem na revisao', async () => {
  const chamadas = [];
  const page = await abrirExclusaoNaSessao(chamadas);
  const motivo = page.document.getElementById('edicaoMotivo');
  assert.equal(motivo.required, true);
  assert.equal(page.document.getElementById('edicaoMotivoOpcional').hidden, true);
  assert.equal(page.document.getElementById('edicaoMotivoRotulo').textContent, 'Motivo da exclusão');

  page.form.dispatch('submit');
  await wait();
  assert.equal(page.document.getElementById('edicaoEtapaConfirmacao').hidden, true);
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent,
    /Informe o motivo da exclusão/);

  motivo.value = 'importado em duplicidade';
  page.form.dispatch('submit');
  await wait();
  assert.equal(page.document.getElementById('edicaoEtapaConfirmacao').hidden, false);

  motivo.value = '   ';
  page.form.dispatch('submit');
  await wait();
  assert.ok(!chamadas.some(c => c.caminho.startsWith('rpc/admin_excluir')),
    'o motivo apagado na revisão também barra a gravação');
});

test('excluir so o julgado chama a porta do julgado e diz o que continua', async () => {
  const chamadas = [];
  const page = await abrirExclusaoNaSessao(chamadas,
    { 'rpc/admin_excluir_julgado_cj': RESULTADO_EXCLUSAO });
  assert.equal(page.campo('alcance').value, 'julgado', 'o padrão é o alcance mais estreito');
  page.document.getElementById('edicaoMotivo').value = 'importado em duplicidade';
  page.form.dispatch('submit');
  await wait();

  assert.equal(page.document.getElementById('edicaoImpactoTitulo').textContent, 'Depois da exclusão');
  assert.equal(page.document.getElementById('edicaoImpacto').dataset.tom, 'atencao');
  assert.match(page.document.getElementById('edicaoImpactoLista').children.at(-1).textContent,
    /republicar a pauta/);
  assert.equal(page.document.getElementById('edicaoRevisaoTitulo').textContent, 'Revise antes de excluir');
  assert.equal(page.dialogo.dataset.tom, 'perigo');
  const botao = page.document.getElementById('btnAvancarEdicao');
  assert.equal(botao.textContent, 'Excluir definitivamente');
  assert.ok(botao.classList.contains('button-perigo'));

  page.form.dispatch('submit');
  await wait();
  const gravacao = chamadas.find(c => c.caminho === 'rpc/admin_excluir_julgado_cj');
  assert.deepEqual(gravacao.corpo, { p_id: 41, p_motivo: 'importado em duplicidade' });
  assert.equal(page.avisos.at(-1).texto, 'Exclusão gravada: 1 julgado do processo 202600000000001.');
  assert.equal(page.avisos.at(-1).tipo, 'sucesso');
});

test('excluir o julgado com a distribuicao usa o acervo_id e lista o que some', async () => {
  const chamadas = [];
  const page = await abrirExclusaoNaSessao(chamadas);
  page.campo('alcance').value = 'tudo';
  page.document.getElementById('edicaoMotivo').value = 'processo de outro órgão';
  page.form.dispatch('submit');
  await wait();

  const lista = page.document.getElementById('edicaoImpactoLista').children;
  assert.equal(page.document.getElementById('edicaoImpactoTitulo').textContent,
    'Registros que serão excluídos');
  assert.equal(page.document.getElementById('edicaoImpacto').dataset.tom, 'perigo');
  assert.equal(lista[0].textContent, 'Distribuição de 18/06/2026 — CJ3');
  assert.match(lista[1].textContent, /^Julgado da sessão de 09\/07\/2026 · pauta 24 — Manter \/ Julgado$/);

  page.form.dispatch('submit');
  await wait();
  const gravacao = chamadas.find(c => c.caminho === 'rpc/admin_excluir_distribuicao_e_julgados_cj');
  assert.deepEqual(gravacao.corpo, { p_id: 7, p_motivo: 'processo de outro órgão' });
});

test('excluir so a distribuicao avisa quem ficou sem vinculo', async () => {
  const chamadas = [];
  const page = await abrirExclusaoNaDistribuicao(chamadas, {
    'rpc/admin_excluir_distribuicao_cj': {
      operacao: 'excluir_distribuicao', num_processo: '202600000000001',
      acervo: [7], julgados: [], desvinculados: [41]
    }
  });
  assert.equal(page.campo('alcance').value, 'distribuicao');
  page.document.getElementById('edicaoMotivo').value = 'lançada em dobro';
  page.form.dispatch('submit');
  await wait();
  assert.match(page.document.getElementById('edicaoImpactoLista').children.at(-1).textContent,
    /fica sem distribuição vinculada$/);
  page.form.dispatch('submit');
  await wait();

  assert.ok(chamadas.some(c => c.caminho === 'rpc/admin_excluir_distribuicao_cj' && c.corpo.p_id === 7));
  assert.equal(page.avisos.at(-1).tipo, 'atencao');
  assert.match(page.avisos.at(-1).texto,
    /^Exclusão gravada: 1 distribuição do processo 202600000000001\. 1 julgado ficou sem distribuição vinculada/);
});

test('falha ao listar o alcance impede a revisao da exclusao', async () => {
  const chamadas = [];
  const page = await abrirExclusaoNaDistribuicao(chamadas, {
    'rpc/admin_julgados_do_acervo': () => { throw new Error('rede caiu'); }
  });
  page.campo('alcance').value = 'tudo';
  page.document.getElementById('edicaoMotivo').value = 'duplicado';
  page.form.dispatch('submit');
  await wait();

  assert.equal(page.document.getElementById('edicaoEtapaConfirmacao').hidden, true);
  assert.match(page.document.getElementById('edicaoErro').children[0].textContent,
    /Não foi possível listar o que a exclusão alcança/);
  page.form.dispatch('submit');
  await wait();
  assert.ok(!chamadas.some(c => c.caminho.startsWith('rpc/admin_excluir')));
});

test('correcao aberta depois de uma exclusao nao herda o tom destrutivo', async () => {
  const page = await abrirExclusaoNaSessao([]);
  page.dialogo.close();
  page.acao(0, 'Corrigir dados').dispatch('click');

  assert.equal(page.dialogo.dataset.tom, '');
  assert.equal(page.document.getElementById('edicaoMotivo').required, false);
  assert.equal(page.document.getElementById('edicaoMotivoOpcional').hidden, false);
  assert.equal(page.document.getElementById('edicaoMotivoRotulo').textContent, 'Motivo da alteração');
  assert.equal(page.document.getElementById('edicaoRevisaoTitulo').textContent, 'Revise antes de gravar');
  const botao = page.document.getElementById('btnAvancarEdicao');
  assert.equal(botao.textContent, 'Revisar alteração');
  assert.equal(botao.classList.contains('button-perigo'), false);
});

test('excluir o ultimo processo da sessao volta para a lista de datas', async () => {
  const chamadas = [];
  let excluido = false;
  const page = await abrirExclusaoNaSessao(chamadas, {
    'rpc/admin_excluir_julgado_cj': () => { excluido = true; return RESULTADO_EXCLUSAO; },
    'rpc/admin_processos_sessao': () => (excluido ? [] : PROCESSOS_SESSAO)
  });
  page.document.getElementById('edicaoMotivo').value = 'duplicado';
  page.form.dispatch('submit');
  await wait();
  page.form.dispatch('submit');
  for (let i = 0; i < 4; i++) await wait();

  assert.equal(chamadas.at(-1).caminho, 'rpc/admin_sessoes');
  assert.equal(page.document.getElementById('btnVoltar').hidden, true);
});

test('o html do dialogo expoe os textos que mudam com a intencao', () => {
  const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  for (const id of ['edicaoMotivoRotulo', 'edicaoMotivoOpcional', 'edicaoRevisaoTitulo', 'edicaoRevisaoTexto']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<label for="edicaoMotivo"><span id="edicaoMotivoRotulo">Motivo da alteração<\/span>/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/test_frontend.mjs`
Expected: os nove testes novos falham (`TypeError: Cannot read properties of undefined (reading 'dispatch')` ao procurar o botão "Excluir", e o teste do HTML por falta dos ids); os existentes continuam passando.

- [ ] **Step 3: Ajustar `admin.html`**

1. Meta description (linha 9): `content="Painel administrativo do Sorteio de Processos SEI: correção e exclusão auditáveis de registros de sorteio e de sessões de julgamento da AGR."`
2. Lead (linha 43): `<p class="lead">Correção e exclusão dos registros de sorteio e das sessões de julgamento.</p>`
3. Revisão (linha 264), troque por:

```html
                <div><h3 id="edicaoRevisaoTitulo">Revise antes de gravar</h3><p id="edicaoRevisaoTexto">Nada foi alterado até você confirmar.</p></div>
```

4. Label do motivo (linha 277), troque por:

```html
              <label for="edicaoMotivo"><span id="edicaoMotivoRotulo">Motivo da alteração</span> <span id="edicaoMotivoOpcional" class="small">opcional</span></label>
```

- [ ] **Step 4: Generalizar o diálogo em `assets/js/admin.js`**

4a. Em `OPERACOES_LEGIVEIS`, acrescente as três operações:

```js
const OPERACOES_LEGIVEIS = {
  corrigir_julgado: 'Correção de julgado',
  religar_julgado: 'Religação ao acervo',
  corrigir_acervo: 'Correção de distribuição',
  redistribuir: 'Redistribuição',
  corrigir_processo: 'Correção do número do processo',
  excluir_julgado: 'Exclusão de julgado',
  excluir_distribuicao: 'Exclusão de distribuição',
  excluir_distribuicao_e_julgados: 'Exclusão de distribuição e julgados'
};
```

4b. Logo depois de `const btnFecharEdicao = ...`, acrescente:

```js
const edicaoMotivoRotulo = document.getElementById('edicaoMotivoRotulo');
const edicaoMotivoOpcional = document.getElementById('edicaoMotivoOpcional');
const edicaoRevisaoTitulo = document.getElementById('edicaoRevisaoTitulo');
const edicaoRevisaoTexto = document.getElementById('edicaoRevisaoTexto');

// As palavras do diálogo por intenção. Uma exclusão não pode pedir para "gravar
// alteração" de algo que vai deixar de existir, nem prometer que "nada foi
// alterado" quando o que está em jogo é o registro inteiro.
const ROTULOS_DO_DIALOGO = {
  correcao: {
    revisar: 'Revisar alteração', confirmar: 'Confirmar e gravar', gravando: 'Gravando…',
    gravado: 'Alteração gravada.', motivo: 'Motivo da alteração',
    revisaoTitulo: 'Revise antes de gravar', revisaoTexto: 'Nada foi alterado até você confirmar.'
  },
  exclusao: {
    revisar: 'Revisar exclusão', confirmar: 'Excluir definitivamente', gravando: 'Excluindo…',
    gravado: 'Exclusão gravada.', motivo: 'Motivo da exclusão',
    revisaoTitulo: 'Revise antes de excluir',
    // Não repete a garantia de auditoria: a dica do motivo já a dá, e o
    // DESIGN.md pede uma vez por tela. O que falta dizer é que não há volta.
    revisaoTexto: 'Nada foi excluído até você confirmar. Este painel não desfaz a exclusão.'
  }
};
```

4c. Substitua `abrirDialogo` inteira por:

```js
// `tituloImpacto` nomeia a lista da etapa 2. O padrão é o da correção de
// distribuição, que lista julgados; a renumeração lista distribuições E
// julgados, e herdar o título fazia a lista dizer que eram só julgados.
//
// `perigo` é a exclusão: motivo obrigatório, lista do alcance obrigatória,
// palavras próprias e o vermelho da ação destrutiva.
function abrirDialogo({ titulo, resumo, campos, montarDelta, impacto, gravar, mensagem,
                        tituloImpacto = 'Julgados que serão alterados junto', perigo = false }) {
  // avancar() é assíncrono nas DUAS etapas, e o <form> aceita submit por Enter
  // além do clique no botão. Sem a trava `avancando`, um segundo submit durante
  // a consulta de impacto reentrava com `delta` já preenchido e caía direto na
  // gravação: a etapa de confirmação era pulada justamente na operação que
  // propaga. A trava é DESTE diálogo, não da página: global, a gravação lenta de
  // uma janela fechada no meio deixava o botão da janela seguinte mudo.
  const rotulos = ROTULOS_DO_DIALOGO[perigo ? 'exclusao' : 'correcao'];
  dialogoAtual = { montarDelta, impacto, gravar, mensagem, perigo, rotulos,
                   delta: null, avancando: false };

  // A janela é uma só: tudo que a exclusão muda é desfeito aqui, senão uma
  // correção aberta depois herdava o vermelho, o motivo obrigatório e as palavras.
  dialogo.dataset.tom = perigo ? 'perigo' : '';
  edicaoRevisaoTitulo.textContent = rotulos.revisaoTitulo;
  edicaoRevisaoTexto.textContent = rotulos.revisaoTexto;
  edicaoMotivoRotulo.textContent = rotulos.motivo;
  edicaoMotivoOpcional.hidden = perigo;
  edicaoMotivo.required = perigo;

  edicaoTitulo.textContent = titulo;
  edicaoResumo.textContent = resumo;
  edicaoCampos.replaceChildren(...campos);
  edicaoMotivo.value = '';
  edicaoErro.hidden = true;
  edicaoImpacto.hidden = true;
  edicaoImpacto.dataset.tom = '';
  edicaoImpactoTitulo.textContent = tituloImpacto;
  edicaoImpactoLista.replaceChildren();
  edicaoEtapaCampos.hidden = false;
  edicaoEtapaConfirmacao.hidden = true;
  edicaoEtapaRotulo.textContent = 'Etapa 1 de 2';
  // A janela anterior pode ter sido fechada com o botão ainda em "Verificando…"
  // ou "Gravando…". A espera dela não toca mais no botão (ver passo), então quem
  // o devolve ao estado da etapa 1 é quem abre a janela nova.
  alternarBotaoCarregando(btnAvancar, false);
  btnAvancar.textContent = rotulos.revisar;
  btnAvancar.classList.remove('button-perigo');
  btnAvancar.disabled = false;

  dialogo.showModal();
  // Religar ao acervo não tem campo nenhum: ali o foco vai para a ação.
  (edicaoCampos.querySelector('input, select') || edicaoMotivo).focus();
}
```

4d. Em `passo(atual)`, faça quatro trocas:

(i) Logo depois de `const naTela = () => dialogoAtual === atual;`, acrescente:

```js
  const { rotulos } = atual;

  // O motivo é a única explicação que sobra de um registro excluído. Conferido
  // nas duas etapas porque o campo continua editável na revisão; o banco confere
  // de novo, mas responde com frase sem acento.
  if (atual.perigo && !edicaoMotivo.value.trim()) {
    mostrarErroNoDialogo('Informe o motivo da exclusão.');
    edicaoMotivo.focus();
    return;
  }
```

(ii) Substitua o bloco `if (atual.impacto) { ... }` inteiro por:

```js
    if (atual.impacto) {
      // O botão vira indicador durante a consulta: rotulado "Revisar alteração"
      // e clicável, ele dizia que a etapa 1 ainda não terminou enquanto a
      // resposta vinha.
      alternarBotaoCarregando(btnAvancar, true, 'Verificando…');
      let resposta = [];
      let falhou = false;
      try {
        resposta = await atual.impacto();
      } catch (_) {
        // Na correção o preview é informativo: falhar nele não impede a
        // confirmação, e inventar "nenhum julgado afetado" seria pior que
        // omiti-lo. Na exclusão a lista É o que deixa de existir, e confirmar
        // sem ela seria apagar às cegas.
        falhou = true;
      }

      // A janela foi fechada enquanto o impacto vinha: não há etapa 2 para
      // montar, e a lista e o botão na tela, se houver, são de outra janela.
      if (!naTela()) return;
      alternarBotaoCarregando(btnAvancar, false, rotulos.revisar);
      if (falhou && atual.perigo) {
        mostrarErroNoDialogo('Não foi possível listar o que a exclusão alcança. Tente novamente.');
        return;
      }

      // A lista, ou `{ titulo, tom, itens }` quando título e tom dependem da
      // escolha da etapa 1: o alcance da exclusão decide se a lista é do que
      // some ou do que continua.
      const { titulo, tom, itens = [] } = Array.isArray(resposta)
        ? { itens: resposta }
        : (resposta || {});
      if (titulo) edicaoImpactoTitulo.textContent = titulo;
      edicaoImpacto.dataset.tom = tom || '';
      if (itens.length) {
        edicaoImpactoLista.replaceChildren(...itens.map(texto => {
          const item = document.createElement('li');
          item.textContent = texto;
          return item;
        }));
        edicaoImpacto.hidden = false;
      }
    }
```

(iii) Na transição para a etapa 2, troque `btnAvancar.textContent = 'Confirmar e gravar';` por:

```js
    btnAvancar.textContent = rotulos.confirmar;
    // Vermelho só aqui: na etapa 1 o botão apenas leva à revisão.
    btnAvancar.classList.toggle('button-perigo', atual.perigo);
```

(iv) Na etapa 2, troque `alternarBotaoCarregando(btnAvancar, true, 'Gravando…');` por `alternarBotaoCarregando(btnAvancar, true, rotulos.gravando);`, `aviso(texto || 'Alteração gravada.', tom || 'sucesso');` por `aviso(texto || rotulos.gravado, tom || 'sucesso');`, e no `finally` `'Confirmar e gravar'` por `rotulos.confirmar`.

- [ ] **Step 5: Os fluxos de exclusão em `assets/js/admin.js`**

5a. Acrescente, antes de `// ── Ligação ──`, a seção:

```js
// ── Exclusão ─────────────────────────────────────────────────────────────────
// Três portas por colegiado, e a intenção mora no nome de cada uma, como em
// corrigir × redistribuir: excluir o julgado; excluir a distribuição, cujos
// julgados ficam sem vínculo; excluir a distribuição com os julgados. Da sessão
// se chega à terceira pelo acervo_id — é a mesma operação, vista do julgado.
function excluir(porta, id, motivo) {
  return api(`rpc/${porta}_${VOCABULARIO[orgao].sufixo}`, {
    method: 'POST',
    body: JSON.stringify({ p_id: id, p_motivo: motivo })
  });
}

async function julgadosVinculados(acervoId) {
  const julgados = await api('rpc/admin_julgados_do_acervo', {
    method: 'POST',
    body: JSON.stringify({ p_colegiado: orgao, p_acervo_id: acervoId })
  });
  return (Array.isArray(julgados) ? julgados : []).map(j =>
    `Julgado da sessão de ${dataBR(j.data_sessao)}${vazio(j.pauta) ? '' : ` · pauta ${j.pauta}`}`
      + ` — ${ou(j.voto)} / ${ou(j.status)}`);
}

// O que some junto com a distribuição: ela e TODOS os julgados que a copiaram,
// inclusive os de sessões que a pessoa não está vendo agora.
async function registrosDaDistribuicao(acervoId, dataDistribuicao, destino) {
  return [`Distribuição de ${dataBR(dataDistribuicao)} — ${ou(destino)}`,
          ...await julgadosVinculados(acervoId)];
}

// Último do grupo, e o CSS o afasta dos vizinhos: o erro de mira mais caro da
// linha é cair em Excluir querendo Religar. "Excluir" se repete em toda linha,
// então o nome acessível diz de qual processo.
function botaoExcluir(numProcesso, aoClicar) {
  const botao = botaoDeLinha('Excluir', aoClicar, { tom: 'perigo' });
  botao.setAttribute('aria-label', `Excluir processo ${numProcesso}`);
  return botao;
}

// A sessão ou a distribuição aberta pode ter perdido o último processo. Os
// detalhes olham esta marca antes de desenhar a lista vazia.
function marcarExclusao() {
  if (detalhe) detalhe.aposExclusao = true;
}

function mensagemDeExclusao(resultado) {
  const quantos = chave => (Array.isArray(resultado?.[chave]) ? resultado[chave].length : 0);
  const partes = [];
  if (quantos('acervo')) partes.push(plural(quantos('acervo'), 'distribuição', 'distribuições'));
  if (quantos('julgados')) partes.push(plural(quantos('julgados'), 'julgado', 'julgados'));
  if (!partes.length) return null;

  const texto = `Exclusão gravada: ${partes.join(' e ')} do processo ${resultado.num_processo}.`;
  const desvinculados = quantos('desvinculados');
  // Julgado que perdeu o vínculo não é comemoração: sai no tom de atenção, como
  // na renumeração, e diz o que fazer.
  return desvinculados
    ? {
        texto: `${texto} ${plural(desvinculados, 'julgado ficou', 'julgados ficaram')} sem distribuição `
          + 'vinculada — use "Religar ao acervo" se o processo tiver outra distribuição.',
        tom: 'atencao'
      }
    : texto;
}

function abrirExclusaoDeJulgado(linha) {
  const vinculado = !!linha.acervo_id;
  const alcances = [
    { valor: 'julgado', rotulo: 'Somente este julgado' },
    ...(vinculado
      ? [{ valor: 'tudo', rotulo: 'O julgado e a distribuição vinculada, com os demais julgados dela' }]
      : [])
  ];

  abrirDialogo({
    perigo: true,
    titulo: 'Excluir julgado',
    resumo: `Processo ${linha.num_processo} · sessão de ${dataBR(detalhe.data)}`
      + (vazio(detalhe.pauta) ? '' : `, pauta ${detalhe.pauta}`),
    // Uma opção só não é escolha: sem vínculo, o alcance é o próprio julgado.
    campos: vinculado
      ? [campoSelecao({ nome: 'alcance', rotulo: 'O que excluir', valor: 'julgado',
                        opcoes: alcances, rotuloVazio: '— selecione —' })]
      : [],
    montarDelta() {
      this.alcance = vinculado ? valorDoCampo('alcance') : 'julgado';
      const escolhido = alcances.find(a => a.valor === this.alcance);
      if (!escolhido) throw new Error('Escolha o que excluir.');
      return [{ rotulo: 'O que excluir', texto: escolhido.rotulo }];
    },
    async impacto() {
      if (this.alcance === 'tudo') {
        return {
          titulo: 'Registros que serão excluídos', tom: 'perigo',
          itens: await registrosDaDistribuicao(linha.acervo_id, linha.data_distribuicao, linha.destino)
        };
      }
      return {
        titulo: 'Depois da exclusão', tom: 'atencao',
        itens: [
          ...(vinculado ? [`A distribuição de ${dataBR(linha.data_distribuicao)} continua no acervo.`] : []),
          // sincronizar.py filtra por URL e insere com `on conflict do nothing`.
          'Se a AGR republicar a pauta desta sessão, a sincronização volta a importar o processo.'
        ]
      };
    },
    async gravar(motivo) {
      const resultado = this.alcance === 'tudo'
        ? await excluir('admin_excluir_distribuicao_e_julgados', linha.acervo_id, motivo)
        : await excluir('admin_excluir_julgado', linha.id, motivo);
      marcarExclusao();
      return resultado;
    },
    mensagem: mensagemDeExclusao
  });
}

function abrirExclusaoDeDistribuicao(linha) {
  const quantos = Number(linha.julgados) || 0;
  const alcances = quantos
    ? [
        { valor: 'distribuicao',
          rotulo: `Somente a distribuição — ${plural(quantos, 'julgado fica', 'julgados ficam')} sem vínculo` },
        { valor: 'tudo',
          rotulo: `A distribuição e ${plural(quantos, 'julgado vinculado', 'julgados vinculados')}` }
      ]
    : [{ valor: 'distribuicao', rotulo: 'A distribuição' }];

  abrirDialogo({
    perigo: true,
    titulo: 'Excluir distribuição',
    resumo: `Processo ${linha.num_processo} · distribuição de ${dataBR(detalhe.data)} · ${ou(linha.destino)}`,
    campos: quantos
      ? [campoSelecao({ nome: 'alcance', rotulo: 'O que excluir', valor: 'distribuicao',
                        opcoes: alcances, rotuloVazio: '— selecione —' })]
      : [],
    montarDelta() {
      this.alcance = quantos ? valorDoCampo('alcance') : 'distribuicao';
      const escolhido = alcances.find(a => a.valor === this.alcance);
      if (!escolhido) throw new Error('Escolha o que excluir.');
      return [{ rotulo: 'O que excluir', texto: escolhido.rotulo }];
    },
    async impacto() {
      if (this.alcance === 'tudo') {
        return {
          titulo: 'Registros que serão excluídos', tom: 'perigo',
          itens: await registrosDaDistribuicao(linha.id, detalhe.data, linha.destino)
        };
      }
      const julgados = quantos ? await julgadosVinculados(linha.id) : [];
      return {
        titulo: 'Depois da exclusão', tom: 'atencao',
        itens: [
          // O histórico e a ata só leem o que veio do sorteio eletrônico.
          'O processo deixa de constar no acervo'
            + (linha.origem === 'sorteio' ? ', no histórico de sorteios e na ata gerada a partir dele.' : '.'),
          ...julgados.map(texto => `${texto} — fica sem distribuição vinculada`)
        ]
      };
    },
    async gravar(motivo) {
      const porta = this.alcance === 'tudo'
        ? 'admin_excluir_distribuicao_e_julgados'
        : 'admin_excluir_distribuicao';
      const resultado = await excluir(porta, linha.id, motivo);
      marcarExclusao();
      return resultado;
    },
    mensagem: mensagemDeExclusao
  });
}
```

5b. Em `pintarProcessosDaSessao`, no topo, troque o bloco `if (!linhas.length) { ... }` por:

```js
  if (!linhas.length) {
    // A exclusão levou o último processo: a sessão deixou de existir, e só a
    // lista de datas ainda diz a verdade.
    if (detalhe.aposExclusao) {
      detalhe = null;
      return carregar();
    }
    return semRegistros('Nenhum processo nesta sessão',
      'A sessão não tem processos registrados.');
  }
```

e acrescente o botão ao fim do grupo de ações:

```js
      celulaDeAcoes([
        botaoDeLinha('Corrigir dados', () => abrirCorrecaoDeJulgado(linha), { tom: 'primario' }),
        botaoDeLinha('Corrigir número', () => abrirCorrecaoDeNumero(linha.num_processo)),
        botaoDeLinha('Religar ao acervo', () => religarJulgado(linha)),
        botaoExcluir(linha.num_processo, () => abrirExclusaoDeJulgado(linha))
      ]),
```

5c. Em `pintarProcessosDoSorteio`, idem:

```js
  if (!linhas.length) {
    // Mesmo caso da sessão: a exclusão levou o último processo da distribuição.
    if (detalhe.aposExclusao) {
      detalhe = null;
      return carregar();
    }
    return semRegistros('Nenhum processo nesta distribuição',
      'A distribuição não tem processos registrados.');
  }
```

```js
      celulaDeAcoes([
        botaoDeLinha('Corrigir dados', () => abrirAlteracaoDeAcervo(linha, 'corrigir'), { tom: 'primario' }),
        botaoDeLinha('Redistribuir', () => abrirAlteracaoDeAcervo(linha, 'redistribuir')),
        botaoDeLinha('Corrigir número', () => abrirCorrecaoDeNumero(linha.num_processo)),
        botaoExcluir(linha.num_processo, () => abrirExclusaoDeDistribuicao(linha))
      ]),
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test tests/test_frontend.mjs`
Expected: `# fail 0`. Em especial continuam passando `segundo envio durante a consulta de impacto nao pula a confirmacao`, `o corpo enviado leva so o campo que mudou` e os testes de renumeração (o `impacto` que devolve array segue funcionando).

- [ ] **Step 7: Commit**

```bash
git add admin.html assets/js/admin.js tests/test_frontend.mjs
git commit -m "feat(admin): excluir julgado, distribuição ou os dois, com motivo e revisão obrigatórios"
```

---

### Task 3: Auditoria — ler uma exclusão

**Files:**
- Modify: `assets/js/admin.js` (`pintarAuditoria` e nova constante perto de `CAMPOS_LEGIVEIS`)
- Test: `tests/test_frontend.mjs`

**Interfaces:**
- Consumes: linhas de `rpc/admin_auditoria` da Task 1, onde exclusão = `depois` vazio (`{}`) e `antes` = linha inteira; `OPERACOES_LEGIVEIS` já com as três exclusões (Task 2).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Escrever o teste que falha**

Ao fim da seção `// ── Exclusão` de `tests/test_frontend.mjs`:

```js
test('auditoria mostra o que o registro excluido guardava', async () => {
  const page = adminPage({
    api: apiDoPainel([], {
      'rpc/admin_auditoria': [{
        id: 9, operacao: 'excluir_julgado', tabela: 'julgados_cj', registro_id: 41,
        num_processo: '202600000000001',
        antes: { id: 41, num_processo: '202600000000001', data_sessao: '2026-07-09', pauta: 24,
                 voto: 'Manter', status: 'Julgado', relator: 'CJ3', dias_dt: 21, periodo_dt: '3T26',
                 acervo_id: 7, criado_em: '2026-07-09T12:00:00Z' },
        depois: {}, motivo: 'duplicado', feito_por: 'admin@goias.gov.br',
        feito_em: '2026-09-17T12:00:00Z'
      }]
    })
  });
  await page.inicializarAdmin(new Set(['CJ']));
  page.botaoDeAba('auditoria').dispatch('click');
  await wait();

  const linha = page.linhasDaTabela()[0];
  assert.equal(linha.children.find(c => c.dataset.label === 'Operação').textContent, 'Exclusão de julgado');
  const itens = linha.children.find(c => c.dataset.label === 'Alteração')
    .children[0].children.map(li => li.textContent);
  assert.deepEqual(itens, ['Data da sessão: 09/07/2026', 'Número da pauta: 24', 'Relator: CJ3',
                           'Voto: Manter', 'Status: Julgado'],
    'o retrato vira "campo: valor", sem seta e sem colunas calculadas');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/test_frontend.mjs`
Expected: FAIL em `auditoria mostra o que o registro excluido guardava` — `itens` sai `[]`, porque hoje a lista percorre as chaves de `depois`.

- [ ] **Step 3: Implementar**

Depois de `const campoLegivel = ...` em `assets/js/admin.js`:

```js
// O que identifica um registro excluído na auditoria. O retrato guarda a linha
// inteira; colunas calculadas (dias_dt, periodo_dt), chaves e carimbos internos
// só atrapalhariam a leitura de quem procura o que sumiu.
const CAMPOS_DO_RETRATO = ['data_sessao', 'pauta', 'data_distribuicao', 'relator', 'unidade',
                           'assunto', 'voto', 'status'];
```

Em `pintarAuditoria`, substitua o trecho de `const mudancas = document.createElement('ul');` até o fim do `forEach` que preenche `mudancas` por:

```js
    const mudancas = document.createElement('ul');
    mudancas.className = 'admin-delta admin-delta-compacta';
    // Exclusão grava `depois` vazio: não há "de → para", há o que o registro era.
    const excluido = Object.keys(linha.depois || {}).length === 0;
    const itens = excluido
      ? CAMPOS_DO_RETRATO
          .filter(campo => !vazio(linha.antes?.[campo]))
          .map(campo => `${campoLegivel(campo)}: ${legivel(linha.antes[campo])}`)
      : Object.keys(linha.depois).map(campo =>
          `${campoLegivel(campo)}: ${legivel(linha.antes?.[campo])} → ${legivel(linha.depois[campo])}`);
    itens.forEach(texto => {
      const item = document.createElement('li');
      item.textContent = texto;
      mudancas.appendChild(item);
    });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/test_frontend.mjs`
Expected: `# fail 0` — inclusive o teste existente que espera `Distribuição vinculada: ` na religação.

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin.js tests/test_frontend.mjs
git commit -m "feat(admin): auditoria mostra o retrato do registro excluído"
```

---

### Task 4: CSS — botão na linha, tom destrutivo e colunas de Ações

**Files:**
- Modify: `assets/css/index.css` (bloco `.admin-acao` ~linha 3477; larguras `processos-sessao`/`processos-sorteio` ~linhas 3352–3375 e `min-width` ~3411; bloco `.admin-impacto` ~3666; `@media screen and (max-width: 960px)` ~3771)
- Test: `tests/test_frontend.mjs`

**Interfaces:**
- Consumes: `admin-acao-perigo` (Task 2), `.admin-dialog[data-tom='perigo']`, `.admin-impacto[data-tom='perigo'|'atencao']`, `#btnAvancarEdicao.button-perigo`.
- Produces: nada consumido por outras tasks.

Antes de começar: `impeccable context --target admin.html` e leitura de `craft-floor.md` (ver Global Constraints).

- [ ] **Step 1: Escrever o teste que falha**

```js
test('excluir so fica vermelho sob o ponteiro ou o foco, e a confirmacao usa os tokens de perigo', () => {
  const css = readFileSync(new URL('../assets/css/index.css', import.meta.url), 'utf8');
  assert.match(css, /\.admin-acao-perigo\s*\{[^}]*color:\s*var\(--muted\)/s,
    'vermelho em repouso em toda linha seria um alarme permanente');
  assert.match(css,
    /\.admin-acao-perigo:hover,\s*\.admin-acao-perigo:focus-visible\s*\{[^}]*color:\s*var\(--danger\)/s);
  assert.match(css, /\.admin-dialog-actions \.button-perigo\s*\{[^}]*background:\s*var\(--danger\)/s);
  assert.match(css, /\.admin-impacto\[data-tom='perigo'\]\s*\{[^}]*background:\s*var\(--danger-panel\)/s);
  assert.match(css, /\.admin-dialog\[data-tom='perigo'\] \.admin-review-icon\s*\{[^}]*color:\s*var\(--danger\)/s);

  const largura = (visao, filho) => Number(css.match(new RegExp(
    `\\.admin-table\\[data-visao='${visao}'\\] thead th:nth-child\\(${filho}\\)\\s*\\{[^}]*width:\\s*([\\d.]+)%`))?.[1]);
  const minimo = visao => Number(css.match(new RegExp(
    `\\.admin-table\\[data-visao='${visao}'\\]\\s*\\{[^}]*min-width:\\s*(\\d+)px`))?.[1]);
  assert.ok(minimo('processos-sessao') * largura('processos-sessao', 2) / 100 >= 440,
    'quatro botões cabem na coluna de Ações da sessão');
  assert.ok(minimo('processos-sorteio') * largura('processos-sorteio', 3) / 100 >= 440,
    'quatro botões cabem na coluna de Ações da distribuição');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/test_frontend.mjs`
Expected: FAIL no teste novo (`.admin-acao-perigo` não existe). O teste existente `tabela administrativa explica a rolagem...` continua passando.

- [ ] **Step 3: Implementar**

3a. Logo depois de `.admin-acao-primario:hover { ... }`:

```css
/* Excluir fica neutro em repouso: vermelho em toda linha da tabela seria um
   alarme permanente, e a One Alert Color Rule guarda a cor para quando a ação
   destrutiva está de fato sob o ponteiro ou o foco — o mesmo acordo do
   .btn-excluir do sorteador. O anel de foco continua o verde de todo o sistema.
   O afastamento extra separa o erro de mira mais caro da linha. */
.admin-acao-perigo { margin-left: 6px; border-color: var(--border-subtle); color: var(--muted); }
.admin-acao-perigo:hover,
.admin-acao-perigo:focus-visible { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
```

3b. Substitua as larguras e mínimos das duas visões de detalhe (a soma de cada visão continua 100%; Vínculo mantém ≥ 212px, que o teste existente exige):

```css
.admin-table[data-visao='processos-sessao'] thead th:nth-child(1) { width: 13%; }
.admin-table[data-visao='processos-sessao'] thead th:nth-child(2) { width: 35%; }
.admin-table[data-visao='processos-sessao'] thead th:nth-child(3) { width: 6%; }
.admin-table[data-visao='processos-sessao'] thead th:nth-child(4) { width: 7%; }
.admin-table[data-visao='processos-sessao'] thead th:nth-child(5) { width: 9%; }
.admin-table[data-visao='processos-sessao'] thead th:nth-child(6) { width: 17%; }
.admin-table[data-visao='processos-sessao'] thead th:nth-child(7) { width: 13%; }

.admin-table[data-visao='processos-sorteio'] thead th:nth-child(1) { width: 6%; }
.admin-table[data-visao='processos-sorteio'] thead th:nth-child(2) { width: 14%; }
.admin-table[data-visao='processos-sorteio'] thead th:nth-child(3) { width: 36%; }
.admin-table[data-visao='processos-sorteio'] thead th:nth-child(4) { width: 8%; }
.admin-table[data-visao='processos-sorteio'] thead th:nth-child(5) { width: 18%; }
.admin-table[data-visao='processos-sorteio'] thead th:nth-child(6) { width: 9%; }

.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(1) { width: 5%; }
.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(2) { width: 13%; }
.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(3) { width: 34%; }
.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(4) { width: 7%; }
.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(5) { width: 12%; }
.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(6) { width: 9%; }
.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(7) { width: 14%; }
.admin-table[data-visao='processos-sorteio'][data-orgao='CREG'] thead th:nth-child(8) { width: 6%; }
```

```css
.admin-table[data-visao='processos-sessao'] { min-width: 1320px; }
.admin-table[data-visao='processos-sorteio'] { min-width: 1320px; }
```

Atualize o comentário acima das larguras de sessão acrescentando: "A coluna de Ações cresceu com Excluir; o mínimo da tabela subiu para 1320px para ela caber sem apertar Vínculo."

3c. Logo depois de `.admin-impacto li { ... }`:

```css
/* Exclusão: o mesmo diálogo, com o vermelho só onde há destruição — o ícone da
   revisão, a lista do que deixa de existir e o botão que confirma. Quando a
   lista é do que CONTINUA (data-tom='atencao'), ela fica no teal de sempre. */
.admin-dialog[data-tom='perigo'] .admin-review-icon { background: var(--danger-soft); color: var(--danger); }
.admin-impacto[data-tom='perigo'] { border-color: var(--danger-panel-border); background: var(--danger-panel); }
.admin-impacto[data-tom='perigo'] h3,
.admin-impacto[data-tom='perigo'] li { color: var(--danger-panel-text); }
.admin-dialog-actions .button-perigo { border-color: var(--danger); background: var(--danger); }
.admin-dialog-actions .button-perigo:hover:not(:disabled) { border-color: var(--danger-hover); background: var(--danger-hover); }
```

3d. Dentro de `@media screen and (max-width: 960px)`, logo depois de `.admin-acao { width: 100%; }`:

```css
  .admin-acao-perigo { margin: 6px 0 0; }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/test_frontend.mjs`
Expected: `# fail 0`.

- [ ] **Step 5: Detector e inspeção visual (uma rodada)**

Run: `C:/Users/leonardo.amichi/.claude/skills/impeccable/scripts/impeccable detect --json admin.html assets/css/index.css assets/js/admin.js`
Expected: nenhum achado novo nas linhas tocadas. Corrija o que for desta mudança num lote só.

Inspeção manual (precisa de login de admin, então é feita por quem tem a credencial): sirva o site com `python -m http.server 8080`, abra `http://localhost:8080/admin.html`, entre, e confira em 1440px e em 390px:
1. Sessão e Distribuição (CJ e CREG): os quatro botões cabem numa linha no desktop, sem rolagem dentro da célula; no celular, Excluir é o último da pilha, com o respiro maior.
2. Excluir em repouso é neutro; no hover e no Tab fica vermelho, com o anel verde.
3. Etapa 2 de "A distribuição e N julgados": ícone vermelho suave, painel vermelho, botão sólido vermelho "Excluir definitivamente".
4. Etapa 2 de "Somente este julgado": painel teal "Depois da exclusão".
5. Abrir "Corrigir dados" depois de fechar uma exclusão: tudo verde de novo, motivo "opcional".

Se o item 1 falhar, suba o `min-width` das duas visões em passos de 40px e ajuste a assertiva `>= 440` do teste para a largura medida.

- [ ] **Step 6: Commit**

```bash
git add assets/css/index.css tests/test_frontend.mjs
git commit -m "style(admin): botão Excluir na linha e tom destrutivo da confirmação"
```

---

### Task 5: Publicação e documentação

**Files:**
- Regenerate: `assets/js/admin.min.js`, `assets/css/index.min.css`, `?v=` em todos os HTMLs e `ASSET_VERSION` em `assets/js/supabase.js` (+ `supabase.min.js`)
- Modify: `README.md` (~linha 454), `AUDITORIA.md` (~linhas 142–144)
- Possibly rename: `supabase/migrations/20260917140000_exclusao_painel_admin.sql`

**Interfaces:**
- Consumes: tudo das Tasks 1–4.
- Produces: banco hospedado e site publicados em sincronia.

- [ ] **Step 1: Aplicar a migração no banco hospedado (antes do front)**

Com o MCP do Supabase: `apply_migration` no projeto `giipnmpfclfudkzflwsv`, nome `exclusao_painel_admin`, conteúdo integral de `supabase/migrations/20260917140000_exclusao_painel_admin.sql`. Depois `list_migrations` e, se a versão registrada for diferente de `20260917140000`, renomeie o arquivo local para a versão do servidor.

Confira no hospedado:

```sql
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (p.proname like 'admin_excluir_%' or p.proname like 'admin_remover_acervo_%')
 order by 1;
```

Expected: 8 linhas; as seis `admin_excluir_*` com `authenticated = true`, as duas `admin_remover_acervo_*` com `false`.

- [ ] **Step 2: Gerar minificados e versão**

```powershell
npx --yes esbuild@0.28.2 assets/css/index.css --minify --outfile=assets/css/index.min.css
npx --yes esbuild@0.28.2 assets/js/admin.js --minify-syntax --minify-whitespace --outfile=assets/js/admin.min.js
node tools/versionar.mjs
npx --yes esbuild@0.28.2 assets/js/supabase.js --minify-syntax --minify-whitespace --outfile=assets/js/supabase.min.js
```

(O versionador grava `ASSET_VERSION` em `supabase.js`; por isso o `supabase.min.js` é gerado depois dele.)

- [ ] **Step 3: Rodar todas as suítes afetadas**

Run:
```bash
python tests/test_admin.py
python tests/test_acesso.py
node --test tests/test_frontend.mjs
node --test tests/test_assets.mjs
```
Expected: nenhuma `FALHA`/`# fail 0` em todas. `test_assets.mjs` confirma que os `?v=` batem com os hashes.

- [ ] **Step 4: Documentação**

`README.md`, descrição de `tests/test_admin.py` (~linha 454): troque o fim da frase por "…redistribuição com preservação de histórico, exclusão de julgado e de distribuição (com ou sem os julgados vinculados, motivo obrigatório e retrato completo na auditoria), integridade transacional e gravação imutável na trilha `auditoria_admin`."

`AUDITORIA.md` (~linhas 142–144): atualize `tests/test_frontend.mjs` e `tests/test_admin.py` para os totais `N/N` impressos no Step 3.

- [ ] **Step 5: Commit e PR**

```bash
git add assets/css/index.min.css assets/js/admin.min.js assets/js/supabase.js assets/js/supabase.min.js *.html README.md AUDITORIA.md supabase/migrations
git commit -m "chore(admin): publica a exclusão no painel (minificados, versão e documentação)"
git push -u origin feat/exclusao-painel-admin
```

Abra o PR para `main` com o resumo das três portas, a decisão de desvincular (e não bloquear) e a confirmação de que a migração já está no banco hospedado.

---

## Self-review

- **Cobertura do pedido:** botão de exclusão para CREG e CJ (Tasks 1–2, com testes CJ no front e CJ+CREG no banco); acervo (`admin_excluir_distribuicao_*`), julgados (`admin_excluir_julgado_*`) e os dois juntos (`admin_excluir_distribuicao_e_julgados_*`, alcançável da sessão e da distribuição); design guiado pelo brief do `/impeccable` (Task 4 + spec).
- **Decisões confirmadas aplicadas:** exclusão física com retrato (Task 1, `to_jsonb(antes)` / `'{}'`); desvincular em vez de bloquear (corpo `admin_remover_acervo_*`, ramo `else`); motivo obrigatório (banco, Task 1; navegador nas duas etapas, Task 2).
- **Estados do brief:** sem escolha quando há uma opção (Task 2, `campos: []`); preview obrigatório (Task 2 passo ii); volta à lista (Task 2, 5b/5c); aviso de atenção para desvinculados (`mensagemDeExclusao`); auditoria legível e com número (Tasks 1 e 3).
- **Consistência de nomes:** `perigo`, `rotulos`, `button-perigo`, `admin-acao-perigo`, `data-tom` (`perigo`/`atencao`), `aposExclusao`, `alcance` (`julgado`/`distribuicao`/`tudo`) são os mesmos em JS, CSS e testes.
- **Fora do escopo, de propósito:** restaurar pela tela (o retrato permite por SQL), exclusão em lote, exclusão por número em todo o colegiado.
