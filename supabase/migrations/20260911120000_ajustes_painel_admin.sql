
-- ── Ajustes do painel administrativo ─────────────────────────────────────────
-- Seis defeitos encontrados em revisão da migração 20260908120000. Nenhum é
-- requisito novo: todos são o painel dizendo à pessoa algo diferente do que o
-- banco fez.
--
--   1. as guardas de data em branco do acervo testavam `->> ... is null`, que
--      não pega a string vazia — o inverso do idioma que as funções de julgado
--      já usavam (`nullif(...) is null`). Um `{"data_distribuicao": ""}`
--      passava pela validação e morria no cast, com erro cru do Postgres em vez
--      da mensagem de 22023 pensada para a tela;
--   2. `propagados` recebia todo julgado visitado, inclusive os que não mudaram
--      (delta vazio, nenhuma linha de auditoria). O painel anunciava "3
--      julgados seguiram a correção" enquanto o rastro guardava 2;
--   3. renumerar só os julgados derruba o vínculo com o acervo — o gatilho
--      procura o número novo num acervo que não o tem — e isso saía do rastro
--      mas não do retorno: `desvinculados` só era preenchido no ramo do acervo;
--   4. admin_processos_acervo devolvia a decisão da Câmara por `decisao`, que
--      CAI no texto legado de `recurso` quando `defesa` é nula. O formulário de
--      correção lia esse valor como se fosse o campo armazenado, e podia
--      mostrar "Defesa: Sim → Não" para uma linha que vai de NULL para false —
--      divergindo da própria auditoria. Agora a coluna booleana vai à parte:
--      `decisao` continua sendo o que se LÊ na tabela (com o legado, como em
--      processos_acervo_cj), `defesa` é o que se EDITA;
--   5. a auditoria identificava cada linha pela chave interna ("Julgado nº
--      3417") e não trazia o número do processo — o único identificador que
--      quem opera o sistema reconhece;
--   6. a correção do número do processo alcança todas as distribuições e todos
--      os julgados que carregam aquele número, e o painel não tinha como
--      mostrar quais antes de gravar. admin_registros_do_processo é esse
--      preview.

-- ── Leitura: a decisão editável separada da que se lê ─────────────────────────
-- O drop é obrigatório: o parâmetro não muda, mas a lista de colunas do retorno
-- muda, e `create or replace` recusa alterar o tipo de retorno de uma função.
drop function if exists public.admin_processos_acervo(text, date, timestamptz, text);

create or replace function public.admin_processos_acervo(
  p_colegiado text, p_data date, p_sorteado_em timestamptz default null,
  p_origem text default null)
returns table (id bigint, ordem int, num_processo text, destino text, assunto text,
               decisao text, defesa boolean, interessado text, origem text,
               julgados int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  -- `is not distinct from` e não `=`: o carimbo de uma rodada pode ser nulo, e
  -- um `=` com nulo devolveria lista vazia justamente para ela.
  --
  -- `decisao` e `defesa` são a mesma coluna vista de dois lugares, e é de
  -- propósito. `decisao` é o que a TABELA mostra, e segue a regra que
  -- processos_acervo_cj documenta: defesa nula cai no texto legado de
  -- `recurso`, porque relê-lo como defesa inventaria a decisão. `defesa` é o
  -- que o FORMULÁRIO edita, e aí só o valor armazenado serve — o legado como
  -- "antes" faria a confirmação prometer uma mudança diferente da que a
  -- auditoria registra.
  select a.id, a.ordem, a.num_processo, a.relator, a.assunto,
         case when a.defesa is null then a.recurso
              when a.defesa        then 'Sim'
              else 'Não' end,
         a.defesa,
         null::text, a.origem,
         (select count(*)::int from public.julgados_cj j where j.acervo_id = a.id)
    from public.acervo_cj a
   where p_colegiado = 'CJ'
     and a.data_distribuicao = p_data
     and a.sorteado_em is not distinct from p_sorteado_em
     and (p_origem is null or a.origem = p_origem)
   union all
  select b.id, b.ordem, b.num_processo, b.unidade, b.assunto, b.recurso,
         null::boolean, b.interessado, b.origem,
         (select count(*)::int from public.julgados_creg k where k.acervo_id = b.id)
    from public.acervo_creg b
   where p_colegiado = 'CREG'
     and b.data_distribuicao = p_data
     and b.sorteado_em is not distinct from p_sorteado_em
     and (p_origem is null or b.origem = p_origem)
   order by 2 nulls last, 3;
end;
$$;

-- ── Leitura: a auditoria diz de qual processo se trata ────────────────────────
-- Mesmo motivo do drop acima: o retorno ganha uma coluna.
drop function if exists public.admin_auditoria(text, int, bigint);

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
         a.antes, a.depois, a.motivo, a.feito_por, a.feito_em
    from public.auditoria_admin a
   where a.orgao = p_colegiado
     and (p_antes_de is null or a.id < p_antes_de)
   order by a.id desc
   limit greatest(1, least(coalesce(p_limite, 50), 500));
end;
$$;

-- ── Leitura: o que a correção de número vai alcançar ─────────────────────────
-- A renumeração não é a edição de uma linha: alcança TODA distribuição e TODO
-- julgado que carregam aquele número, e o painel abria o diálogo a partir de
-- uma linha só. Sem este preview a pessoa confirmava sem saber quantos
-- registros mudam de nome — e é operação sem desfazer.
create or replace function public.admin_registros_do_processo(
  p_colegiado text, p_num_processo text)
returns table (origem_registro text, registro_id bigint, data_referencia date,
               pauta int, destino text, vinculado boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  select 'acervo'::text, a.id, a.data_distribuicao, null::int, a.relator, null::boolean
    from public.acervo_cj a
   where p_colegiado = 'CJ' and a.num_processo = p_num_processo
   union all
  select 'julgados'::text, j.id, j.data_sessao, j.pauta, j.relator, j.acervo_id is not null
    from public.julgados_cj j
   where p_colegiado = 'CJ' and j.num_processo = p_num_processo
   union all
  select 'acervo'::text, b.id, b.data_distribuicao, null::int, b.unidade, null::boolean
    from public.acervo_creg b
   where p_colegiado = 'CREG' and b.num_processo = p_num_processo
   union all
  select 'julgados'::text, k.id, k.data_sessao, k.pauta, k.unidade, k.acervo_id is not null
    from public.julgados_creg k
   where p_colegiado = 'CREG' and k.num_processo = p_num_processo
   order by 1, 3, 2;
end;
$$;

revoke all on function public.admin_processos_acervo(text, date, timestamptz, text)
  from public, anon, service_role;
revoke all on function public.admin_auditoria(text, int, bigint)
  from public, anon, service_role;
revoke all on function public.admin_registros_do_processo(text, text)
  from public, anon, service_role;
grant execute on function public.admin_processos_acervo(text, date, timestamptz, text) to authenticated;
grant execute on function public.admin_auditoria(text, int, bigint) to authenticated;
grant execute on function public.admin_registros_do_processo(text, text) to authenticated;

-- ── Escrita: guardas de vazio e contagem honesta da propagação ────────────────
create or replace function public.admin_alterar_acervo_cj(
  p_id bigint, p_campos jsonb, p_propagar boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis constant text[] := array['relator', 'data_distribuicao', 'assunto',
                                     'defesa', 'ordem'];
  -- O que julgados_cj copia do acervo. Só mudança NESTES campos propaga.
  copiados  constant text[] := array['relator', 'defesa', 'data_distribuicao'];
  antes    public.acervo_cj%rowtype;
  depois   public.acervo_cj%rowtype;
  j_antes  public.julgados_cj%rowtype;
  j_depois public.julgados_cj%rowtype;
  delta      jsonb;
  j_delta    jsonb;
  propagados bigint[] := '{}';
begin
  perform public.admin_exigir('CJ');
  perform public.admin_validar_campos(p_campos, editaveis);

  if p_campos ? 'relator'
     and coalesce(p_campos ->> 'relator', '') !~ '^CJ[1-9][0-9]*$' then
    raise exception 'cadeira invalida: %', coalesce(p_campos ->> 'relator', '(vazio)')
      using errcode = '22023';
  end if;

  -- nullif, e não `->> ... is null`: a chave presente com string vazia é o que
  -- um <input type="date"> limpo manda, e é exatamente o caso que esta guarda
  -- existe para recusar. Sem o nullif ela passava direto e o ''::date estourava
  -- com erro cru do Postgres — a mesma razão que fez as funções de julgado
  -- adotarem o idioma, e o único idioma usado daqui para baixo.
  if p_campos ? 'data_distribuicao' then
    if nullif(p_campos ->> 'data_distribuicao', '') is null then
      raise exception 'a data de distribuicao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_distribuicao')::date > current_date then
      raise exception 'distribuicao no futuro: %', p_campos ->> 'data_distribuicao'
        using errcode = '22023';
    end if;
  end if;

  if p_campos ? 'assunto' and nullif(btrim(coalesce(p_campos ->> 'assunto', '')), '') is null then
    raise exception 'o assunto nao pode ficar vazio' using errcode = '22023';
  end if;

  -- coalesce e não uma segunda condição depois do `and`: o Postgres não garante
  -- ordem de avaliação entre os operandos, e ''::int ESTOURA em vez de recusar
  -- com mensagem. Aqui o vazio já virou null antes de qualquer cast — e ordem
  -- em branco é apagar a ordem, que é legítimo.
  if p_campos ? 'ordem' and coalesce(nullif(p_campos ->> 'ordem', '')::int, 1) <= 0 then
    raise exception 'ordem invalida: %', p_campos ->> 'ordem' using errcode = '22023';
  end if;

  select * into antes from public.acervo_cj where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  begin
    update public.acervo_cj a
       set relator = case when p_campos ? 'relator'
                          then p_campos ->> 'relator' else a.relator end,
           data_distribuicao = case when p_campos ? 'data_distribuicao'
                                    then (p_campos ->> 'data_distribuicao')::date
                                    else a.data_distribuicao end,
           assunto = case when p_campos ? 'assunto'
                          then p_campos ->> 'assunto' else a.assunto end,
           defesa  = case when p_campos ? 'defesa'
                          then (nullif(p_campos ->> 'defesa', ''))::boolean else a.defesa end,
           ordem   = case when p_campos ? 'ordem'
                          then nullif(p_campos ->> 'ordem', '')::int else a.ordem end
     where a.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe esta distribuicao (mesmo processo, data e cadeira)'
      using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), editaveis);
  if delta <> '{}'::jsonb then
    perform public.auditar('CJ', p_operacao, 'acervo_cj', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  if p_propagar and delta ?| copiados then
    for j_antes in
      select * from public.julgados_cj j where j.acervo_id = p_id order by j.id for update
    loop
      -- Gravar valores NÃO nulos aqui é o que mantém o vínculo no lugar: o
      -- gatilho redispara, o coalesce preserva o que acabamos de gravar, e a
      -- busca pela data nova reencontra esta mesma linha do acervo.
      update public.julgados_cj j
         set relator = depois.relator,
             defesa  = depois.defesa,
             data_distribuicao = depois.data_distribuicao,
             atualizado_em = now(), atualizado_por = public.auth_email()
       where j.id = j_antes.id
       returning * into j_depois;

      j_delta := public.admin_delta(to_jsonb(j_antes), to_jsonb(j_depois),
                                    copiados || array['acervo_id']);
      -- Dentro do `if`, e não depois dele: um julgado que já carregava o valor
      -- corrigido não gera linha de auditoria, e contá-lo fazia o painel
      -- anunciar mais julgados alterados do que o rastro registra. O que
      -- `propagados` conta é o que MUDOU.
      if j_delta <> '{}'::jsonb then
        perform public.auditar('CJ', p_operacao, 'julgados_cj', j_antes.id,
          public.admin_fatiar(to_jsonb(j_antes), j_delta),
          public.admin_fatiar(to_jsonb(j_depois), j_delta), p_motivo);
        propagados := propagados || j_antes.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'acervo_cj', 'operacao', p_operacao,
                            'alterados', delta, 'propagados', to_jsonb(propagados));
end;
$$;

create or replace function public.admin_alterar_acervo_creg(
  p_id bigint, p_campos jsonb, p_propagar boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis constant text[] := array['unidade', 'data_distribuicao', 'assunto',
                                     'recurso', 'ordem', 'interessado'];
  -- interessado NÃO propaga: julgados_creg não tem a coluna. É campo da tela do
  -- sorteio, para a secretaria reconhecer o processo na ata.
  copiados  constant text[] := array['unidade', 'assunto', 'recurso', 'data_distribuicao'];
  antes    public.acervo_creg%rowtype;
  depois   public.acervo_creg%rowtype;
  k_antes  public.julgados_creg%rowtype;
  k_depois public.julgados_creg%rowtype;
  delta      jsonb;
  k_delta    jsonb;
  propagados bigint[] := '{}';
begin
  perform public.admin_exigir('CREG');
  perform public.admin_validar_campos(p_campos, editaveis);

  if p_campos ? 'unidade'
     and coalesce(p_campos ->> 'unidade', '') !~ '^CREG[1-9][0-9]*$' then
    raise exception 'unidade invalida: %', coalesce(p_campos ->> 'unidade', '(vazio)')
      using errcode = '22023';
  end if;

  -- Mesmo idioma da Câmara: nullif pega a chave presente com string vazia, que
  -- é o que um <input type="date"> limpo manda — e sem ele o ''::date estourava
  -- com erro cru do Postgres em vez da mensagem pensada para a tela.
  if p_campos ? 'data_distribuicao' then
    if nullif(p_campos ->> 'data_distribuicao', '') is null then
      raise exception 'a data de distribuicao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_distribuicao')::date > current_date then
      raise exception 'distribuicao no futuro: %', p_campos ->> 'data_distribuicao'
        using errcode = '22023';
    end if;
  end if;

  if p_campos ? 'ordem' and coalesce(nullif(p_campos ->> 'ordem', '')::int, 1) <= 0 then
    raise exception 'ordem invalida: %', p_campos ->> 'ordem' using errcode = '22023';
  end if;

  select * into antes from public.acervo_creg where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  begin
    update public.acervo_creg b
       set unidade = case when p_campos ? 'unidade'
                          then p_campos ->> 'unidade' else b.unidade end,
           data_distribuicao = case when p_campos ? 'data_distribuicao'
                                    then (p_campos ->> 'data_distribuicao')::date
                                    else b.data_distribuicao end,
           assunto = case when p_campos ? 'assunto'
                          then p_campos ->> 'assunto' else b.assunto end,
           recurso = case when p_campos ? 'recurso'
                          then p_campos ->> 'recurso' else b.recurso end,
           ordem   = case when p_campos ? 'ordem'
                          then nullif(p_campos ->> 'ordem', '')::int else b.ordem end,
           interessado = case when p_campos ? 'interessado'
                              then p_campos ->> 'interessado' else b.interessado end
     where b.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe esta distribuicao (mesmo processo, data e unidade)'
      using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), editaveis);
  if delta <> '{}'::jsonb then
    perform public.auditar('CREG', p_operacao, 'acervo_creg', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  if p_propagar and delta ?| copiados then
    for k_antes in
      select * from public.julgados_creg k where k.acervo_id = p_id order by k.id for update
    loop
      update public.julgados_creg k
         set unidade = depois.unidade,
             assunto = depois.assunto,
             recurso = depois.recurso,
             data_distribuicao = depois.data_distribuicao,
             atualizado_em = now(), atualizado_por = public.auth_email()
       where k.id = k_antes.id
       returning * into k_depois;

      k_delta := public.admin_delta(to_jsonb(k_antes), to_jsonb(k_depois),
                                    copiados || array['acervo_id']);
      -- Como na Câmara: conta quem mudou, que é quem deixou rastro.
      if k_delta <> '{}'::jsonb then
        perform public.auditar('CREG', p_operacao, 'julgados_creg', k_antes.id,
          public.admin_fatiar(to_jsonb(k_antes), k_delta),
          public.admin_fatiar(to_jsonb(k_depois), k_delta), p_motivo);
        propagados := propagados || k_antes.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'acervo_creg', 'operacao', p_operacao,
                            'alterados', delta, 'propagados', to_jsonb(propagados));
end;
$$;

-- ── Escrita: renumerar julgados também desvincula, e isso volta ao chamador ───
create or replace function public.admin_corrigir_processo_cj(
  p_num_atual text, p_num_novo text, p_escopo text default 'tudo',
  p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha_a public.acervo_cj%rowtype;
  linha_j public.julgados_cj%rowtype;
  nova_j  public.julgados_cj%rowtype;
  acervo        bigint[] := '{}';
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
  encontrados int;
begin
  perform public.admin_exigir('CJ');

  -- O check de 15 dígitos existe em acervo_creg e não na Câmara; a porta exige
  -- nos dois, para não abrir aqui o ERRO "Número de processo fora do padrão".
  if coalesce(p_num_atual, '') !~ '^[0-9]{15}$'
     or coalesce(p_num_novo, '') !~ '^[0-9]{15}$' then
    raise exception 'numero de processo fora do padrao (15 digitos)' using errcode = '22023';
  end if;

  if p_num_atual = p_num_novo then
    raise exception 'o numero novo e igual ao atual' using errcode = '22023';
  end if;

  if coalesce(p_escopo, '') not in ('tudo', 'acervo', 'julgados') then
    raise exception 'escopo desconhecido: %', p_escopo using errcode = '22023';
  end if;

  select count(*) into encontrados from (
    select 1 from public.acervo_cj a where a.num_processo = p_num_atual
     union all
    select 1 from public.julgados_cj j where j.num_processo = p_num_atual) t;
  if encontrados = 0 then
    raise exception 'processo % nao encontrado', p_num_atual using errcode = '22023';
  end if;

  if p_escopo in ('tudo', 'acervo') then
    for linha_a in
      select * from public.acervo_cj a where a.num_processo = p_num_atual
       order by a.id for update
    loop
      begin
        update public.acervo_cj a set num_processo = p_num_novo where a.id = linha_a.id;
      exception when unique_violation then
        raise exception 'ja existe esta distribuicao com o numero %', p_num_novo
          using errcode = '23505';
      end;
      perform public.auditar('CJ', 'corrigir_processo', 'acervo_cj', linha_a.id,
        jsonb_build_object('num_processo', p_num_atual),
        jsonb_build_object('num_processo', p_num_novo), p_motivo);
      acervo := acervo || linha_a.id;
    end loop;
  end if;

  if p_escopo in ('tudo', 'julgados') then
    for linha_j in
      select * from public.julgados_cj j where j.num_processo = p_num_atual
       order by j.id for update
    loop
      begin
        update public.julgados_cj j set num_processo = p_num_novo where j.id = linha_j.id
        returning * into nova_j;
      exception when unique_violation then
        raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
      end;
      perform public.auditar('CJ', 'corrigir_processo', 'julgados_cj', linha_j.id,
        jsonb_build_object('num_processo', p_num_atual, 'acervo_id', linha_j.acervo_id),
        jsonb_build_object('num_processo', p_num_novo, 'acervo_id', nova_j.acervo_id),
        p_motivo);
      julgados := julgados || linha_j.id;
      -- Com escopo 'julgados' nenhuma linha do acervo carrega o número novo, e o
      -- gatilho DERRUBA o vínculo — o que é a verdade do que ficou, mas era
      -- verdade só no rastro: `desvinculados` voltava vazio e o painel não tinha
      -- o que avisar. Com 'tudo' o acervo foi renumerado antes e o vínculo se
      -- mantém, então este ramo não acrescenta nada lá.
      if nova_j.acervo_id is null and linha_j.acervo_id is not null then
        desvinculados := desvinculados || linha_j.id;
      end if;
    end loop;
  elsif p_escopo = 'acervo' then
    -- Sem renumerar os julgados, o vínculo passaria a apontar para um processo
    -- DIFERENTE — o ERRO "Julgado apontando para processo diferente no acervo"
    -- de verificacao_cj.sql. Tocar num_processo com o mesmo valor redispara o
    -- gatilho, que rederiva e DERRUBA o vínculo em vez de deixá-lo mentir.
    -- Julgado sem acervo é apenas AVISO, e é a verdade do que ficou.
    for linha_j in
      select * from public.julgados_cj j where j.acervo_id = any (acervo)
       order by j.id for update
    loop
      update public.julgados_cj j set num_processo = j.num_processo where j.id = linha_j.id
      returning * into nova_j;
      if nova_j.acervo_id is distinct from linha_j.acervo_id then
        perform public.auditar('CJ', 'corrigir_processo', 'julgados_cj', linha_j.id,
          jsonb_build_object('acervo_id', linha_j.acervo_id),
          jsonb_build_object('acervo_id', nova_j.acervo_id), p_motivo);
        desvinculados := desvinculados || linha_j.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'num_processo', jsonb_build_object('antes', p_num_atual, 'depois', p_num_novo),
    'acervo', to_jsonb(acervo), 'julgados', to_jsonb(julgados),
    'desvinculados', to_jsonb(desvinculados));
end;
$$;

create or replace function public.admin_corrigir_processo_creg(
  p_num_atual text, p_num_novo text, p_escopo text default 'tudo',
  p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha_b public.acervo_creg%rowtype;
  linha_k public.julgados_creg%rowtype;
  nova_k  public.julgados_creg%rowtype;
  acervo        bigint[] := '{}';
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
  encontrados int;
begin
  perform public.admin_exigir('CREG');

  if coalesce(p_num_atual, '') !~ '^[0-9]{15}$'
     or coalesce(p_num_novo, '') !~ '^[0-9]{15}$' then
    raise exception 'numero de processo fora do padrao (15 digitos)' using errcode = '22023';
  end if;

  if p_num_atual = p_num_novo then
    raise exception 'o numero novo e igual ao atual' using errcode = '22023';
  end if;

  if coalesce(p_escopo, '') not in ('tudo', 'acervo', 'julgados') then
    raise exception 'escopo desconhecido: %', p_escopo using errcode = '22023';
  end if;

  select count(*) into encontrados from (
    select 1 from public.acervo_creg b where b.num_processo = p_num_atual
     union all
    select 1 from public.julgados_creg k where k.num_processo = p_num_atual) t;
  if encontrados = 0 then
    raise exception 'processo % nao encontrado', p_num_atual using errcode = '22023';
  end if;

  if p_escopo in ('tudo', 'acervo') then
    for linha_b in
      select * from public.acervo_creg b where b.num_processo = p_num_atual
       order by b.id for update
    loop
      begin
        update public.acervo_creg b set num_processo = p_num_novo where b.id = linha_b.id;
      exception when unique_violation then
        raise exception 'ja existe esta distribuicao com o numero %', p_num_novo
          using errcode = '23505';
      end;
      perform public.auditar('CREG', 'corrigir_processo', 'acervo_creg', linha_b.id,
        jsonb_build_object('num_processo', p_num_atual),
        jsonb_build_object('num_processo', p_num_novo), p_motivo);
      acervo := acervo || linha_b.id;
    end loop;
  end if;

  if p_escopo in ('tudo', 'julgados') then
    for linha_k in
      select * from public.julgados_creg k where k.num_processo = p_num_atual
       order by k.id for update
    loop
      begin
        update public.julgados_creg k set num_processo = p_num_novo where k.id = linha_k.id
        returning * into nova_k;
      exception when unique_violation then
        raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
      end;
      perform public.auditar('CREG', 'corrigir_processo', 'julgados_creg', linha_k.id,
        jsonb_build_object('num_processo', p_num_atual, 'acervo_id', linha_k.acervo_id),
        jsonb_build_object('num_processo', p_num_novo, 'acervo_id', nova_k.acervo_id),
        p_motivo);
      julgados := julgados || linha_k.id;
      if nova_k.acervo_id is null and linha_k.acervo_id is not null then
        desvinculados := desvinculados || linha_k.id;
      end if;
    end loop;
  elsif p_escopo = 'acervo' then
    for linha_k in
      select * from public.julgados_creg k where k.acervo_id = any (acervo)
       order by k.id for update
    loop
      update public.julgados_creg k set num_processo = k.num_processo where k.id = linha_k.id
      returning * into nova_k;
      if nova_k.acervo_id is distinct from linha_k.acervo_id then
        perform public.auditar('CREG', 'corrigir_processo', 'julgados_creg', linha_k.id,
          jsonb_build_object('acervo_id', linha_k.acervo_id),
          jsonb_build_object('acervo_id', nova_k.acervo_id), p_motivo);
        desvinculados := desvinculados || linha_k.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'num_processo', jsonb_build_object('antes', p_num_atual, 'depois', p_num_novo),
    'acervo', to_jsonb(acervo), 'julgados', to_jsonb(julgados),
    'desvinculados', to_jsonb(desvinculados));
end;
$$;

revoke all on function public.admin_alterar_acervo_cj(bigint, jsonb, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_alterar_acervo_creg(bigint, jsonb, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_corrigir_processo_cj(text, text, text, text)
  from public, anon, service_role;
revoke all on function public.admin_corrigir_processo_creg(text, text, text, text)
  from public, anon, service_role;
grant execute on function public.admin_corrigir_processo_cj(text, text, text, text) to authenticated;
grant execute on function public.admin_corrigir_processo_creg(text, text, text, text) to authenticated;
