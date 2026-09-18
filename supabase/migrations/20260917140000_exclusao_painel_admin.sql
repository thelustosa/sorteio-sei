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
