-- Correções da revisão de Vista/Retirado no CREG (issues #62 e #63).
--
-- 1. julgados_creg.acervo_id passa a ON DELETE SET NULL: apagar um retorno
--    (decisão desfeita, julgado excluído) não pode travar no julgado da pauta
--    seguinte que se vinculou a ele.
-- 2. O gatilho de retorno trata Vista/Retirado pelos dois lados (voto OU
--    status), diz qual processo falhou e não data o retorno no futuro.
-- 3. A correção administrativa do julgado lê e grava o destino da Vista.
-- 4. As portas administrativas do acervo recusam linhas de retorno, que são
--    derivadas do julgado.
-- 5. Backfill dos Retirados gravados pela página antes do gatilho.

-- Um retorno some quando a decisão que o criou é desfeita ou excluída, e o
-- julgado da pauta seguinte pode estar vinculado a ele. Sem o set null, a
-- correção ou a exclusão do julgado original falhava por causa dessa FK.
-- O julgado fica sem vínculo, como em excluir_distribuicao, e "Religar ao
-- acervo" refaz o vínculo.
alter table public.julgados_creg drop constraint if exists julgados_creg_acervo_id_fkey;
alter table public.julgados_creg add constraint julgados_creg_acervo_id_fkey
  foreign key (acervo_id) references public.acervo_creg (id) on delete set null;


create or replace function public.julgados_creg_sincronizar_retorno()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  destino text;
  interessado_original text;
begin
  if new.atualizado_em is null then
    return new;
  end if;

  -- Corrigir apenas metadados de um julgamento sem retorno não é uma nova
  -- decisão. Isso preserva o histórico importado e as correções administrativas.
  if tg_op = 'UPDATE' then
    if old.voto is not distinct from new.voto
       and old.status is not distinct from new.status
       and old.unidade_vista is not distinct from new.unidade_vista
       and not exists (select 1 from public.acervo_creg a
                        where a.retorno_julgado_id = new.id) then
      return new;
    end if;
  end if;

  -- Vista e Retirado valem pelos dois lados: um só dos campos com esse rótulo
  -- e o outro com rótulo diferente é incoerente. Um campo ainda em branco não
  -- é: a decisão está pela metade, a linha continua pendente na página de
  -- julgados e o retorno só nasce quando os dois campos baterem.
  if (new.voto in ('Vista', 'Retirado') or new.status in ('Vista', 'Retirado'))
     and new.voto <> new.status then
    raise exception 'Processo %: voto % e status % não combinam. Vista e Retirado exigem voto e status iguais.',
      new.num_processo, new.voto, new.status
      using errcode = '22023';
  end if;

  if new.voto = 'Vista' then
    if coalesce(new.unidade_vista, '') not in ('CREG1', 'CREG2', 'CREG3', 'CREG4') then
      raise exception 'Processo %: voto Vista exige unidade de destino (CREG1 a CREG4).',
        new.num_processo
        using errcode = '22023';
    end if;
    destino := new.unidade_vista;
  elsif new.voto = 'Retirado' then
    if coalesce(new.unidade, '') !~ '^CREG[1-4]$' then
      raise exception 'Processo %: voto Retirado exige unidade atual CREG1 a CREG4, e o processo não tem distribuição no acervo.',
        new.num_processo
        using errcode = '22023';
    end if;
    destino := new.unidade;
  end if;

  if destino is not null and new.status = new.voto then
    select a.interessado into interessado_original
      from public.acervo_creg a where a.id = new.acervo_id;

    -- Retirado pode ser registrado antes da sessão. O retorno vale a partir da
    -- gravação, e não da data futura: com dias negativos o processo cairia fora
    -- de todas as faixas do painel.
    insert into public.acervo_creg
      (num_processo, unidade, data_distribuicao, assunto, recurso,
       interessado, origem, retorno_julgado_id)
    values
      (new.num_processo, destino, least(new.data_sessao, current_date), new.assunto,
       new.recurso, interessado_original, 'retorno', new.id)
    on conflict on constraint acervo_creg_retorno_unico do update
      set num_processo = excluded.num_processo,
          unidade = excluded.unidade,
          data_distribuicao = excluded.data_distribuicao,
          assunto = excluded.assunto,
          recurso = excluded.recurso,
          interessado = coalesce(excluded.interessado, acervo_creg.interessado);
  else
    -- Desfazer uma decisão provisória remove apenas o retorno que ela criou;
    -- a distribuição original e o julgamento continuam preservados.
    delete from public.acervo_creg a where a.retorno_julgado_id = new.id;
  end if;

  return new;
end;
$$;


create or replace function public.admin_corrigir_julgado_creg(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis  constant text[] := array['voto', 'status', 'data_sessao', 'pauta',
                                      'unidade_vista'];
  observados constant text[] := array['voto', 'status', 'data_sessao', 'pauta',
                                      'unidade_vista', 'acervo_id', 'unidade', 'assunto',
                                      'recurso', 'data_distribuicao'];
  antes  public.julgados_creg%rowtype;
  depois public.julgados_creg%rowtype;
  delta  jsonb;
begin
  perform public.admin_exigir('CREG');
  perform public.admin_validar_campos(p_campos, editaveis);

  -- A lista do Conselho é mais longa que a da Câmara, e é a de
  -- registrar_votos_creg.
  if p_campos ? 'voto' and nullif(p_campos ->> 'voto', '') is not null
     and p_campos ->> 'voto' not in ('Manter', 'Anular', 'Aprovação', 'Indeferimento',
                                     'Extinção', 'Retirado', 'Vista') then
    raise exception 'voto fora do permitido: %', p_campos ->> 'voto' using errcode = '22023';
  end if;

  if p_campos ? 'status' and nullif(p_campos ->> 'status', '') is not null
     and p_campos ->> 'status' not in ('Julgado', 'Retirado', 'Vista',
                                       'Sobrestado', 'Prejudicado') then
    raise exception 'status fora do permitido: %', p_campos ->> 'status' using errcode = '22023';
  end if;

  if p_campos ? 'data_sessao' then
    if nullif(p_campos ->> 'data_sessao', '') is null then
      raise exception 'a data da sessao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_sessao')::date > current_date then
      raise exception 'sessao no futuro: %', p_campos ->> 'data_sessao' using errcode = '22023';
    end if;
  end if;

  -- coalesce, e não uma segunda condição depois do `and`: o Postgres não
  -- garante ordem de avaliação entre os operandos, e ''::int ESTOURA em vez de
  -- recusar com mensagem. Aqui o vazio já virou null antes de qualquer cast.
  if p_campos ? 'pauta' and coalesce(nullif(p_campos ->> 'pauta', '')::int, 1) <= 0 then
    raise exception 'numero de pauta invalido: %', p_campos ->> 'pauta' using errcode = '22023';
  end if;

  if p_campos ? 'unidade_vista' and nullif(p_campos ->> 'unidade_vista', '') is not null
     and p_campos ->> 'unidade_vista' not in ('CREG1', 'CREG2', 'CREG3', 'CREG4') then
    raise exception 'destino da vista fora do permitido: %', p_campos ->> 'unidade_vista'
      using errcode = '22023';
  end if;

  select * into antes from public.julgados_creg where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  begin
    update public.julgados_creg k
       -- nullif como em registrar_votos: a validação acima já trata '' como
       -- ausência, e sem ele o UPDATE gravava a string vazia literal — um voto
       -- em branco que passa pela allowlist e vira selo vazio em todo painel.
       set voto        = case when p_campos ? 'voto'
                              then nullif(p_campos ->> 'voto', '') else k.voto end,
           status      = case when p_campos ? 'status'
                              then nullif(p_campos ->> 'status', '') else k.status end,
           data_sessao = case when p_campos ? 'data_sessao'
                              then (p_campos ->> 'data_sessao')::date else k.data_sessao end,
           pauta       = case when p_campos ? 'pauta'
                              then nullif(p_campos ->> 'pauta', '')::int else k.pauta end,
           -- O destino só existe com voto Vista (julgados_creg_unidade_vista_valida):
           -- corrigir o voto para outro rótulo leva o destino junto.
           unidade_vista = case
                             when (case when p_campos ? 'voto'
                                        then nullif(p_campos ->> 'voto', '') else k.voto end)
                                  is distinct from 'Vista' then null
                             when p_campos ? 'unidade_vista'
                               then nullif(p_campos ->> 'unidade_vista', '')
                             else k.unidade_vista
                           end,
           atualizado_em  = now(),
           atualizado_por = public.auth_email()
     where k.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), observados);
  if delta <> '{}'::jsonb then
    perform public.auditar('CREG', 'corrigir_julgado', 'julgados_creg', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'julgados_creg',
                            'operacao', 'corrigir_julgado',
                            'alterados', delta, 'propagados', '[]'::jsonb);
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

  -- O retorno de Vista/Retirado é derivado do julgamento, e o gatilho
  -- julgados_creg_retorno o reescreve na próxima correção dele. Editado ou
  -- apagado por aqui, voltaria sem aviso: quem corrige é o julgado.
  if antes.origem = 'retorno' then
    raise exception 'distribuicao de retorno (Vista/Retirado) vem do julgado %: corrija o julgado',
      antes.retorno_julgado_id using errcode = '22023';
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

  -- O retorno de Vista/Retirado é derivado do julgamento, e o gatilho
  -- julgados_creg_retorno o reescreve na próxima correção dele. Editado ou
  -- apagado por aqui, voltaria sem aviso: quem corrige é o julgado.
  if antes.origem = 'retorno' then
    raise exception 'distribuicao de retorno (Vista/Retirado) vem do julgado %: corrija o julgado',
      antes.retorno_julgado_id using errcode = '22023';
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


-- Retirados gravados pela página antes de existir o gatilho de retorno. Vistas
-- antigas ficam de fora: sem unidade_vista não há destino a usar, e cabe à
-- secretaria corrigi-las pelo painel admin. Processo que já voltou a outra
-- sessão não precisa de retorno — o julgado posterior o tiraria do painel.
insert into public.acervo_creg
  (num_processo, unidade, data_distribuicao, assunto, recurso,
   interessado, origem, retorno_julgado_id)
select k.num_processo, k.unidade, least(k.data_sessao, current_date), k.assunto,
       k.recurso, a.interessado, 'retorno', k.id
  from public.julgados_creg k
  left join public.acervo_creg a on a.id = k.acervo_id
 where k.atualizado_em is not null
   and k.voto = 'Retirado' and k.status = 'Retirado'
   and k.unidade ~ '^CREG[1-4]$'
   and not exists (select 1 from public.julgados_creg p
                    where p.num_processo = k.num_processo
                      and p.data_sessao > k.data_sessao)
on conflict on constraint acervo_creg_retorno_unico do nothing;
