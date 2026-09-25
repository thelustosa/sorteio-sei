-- A Câmara passa a seguir a mesma regra do Conselho para Vista e Retirado: o
-- VOTO decide, a cadeira da Vista só existe com voto Vista, e o retorno ao
-- acervo só nasce quando o status é o mesmo rótulo. Com um dos dois em branco a
-- decisão está pela metade e a linha continua pendente.
--
-- Em produção nenhum julgado da Câmara tinha cadeira_vista nem retorno quando
-- esta migração foi escrita, então nada precisa ser migrado.

alter table public.julgados_cj drop constraint if exists julgados_cj_cadeira_vista_valida;
alter table public.julgados_cj add constraint julgados_cj_cadeira_vista_valida
  check (cadeira_vista is null or
         (coalesce(voto, '') = 'Vista' and cadeira_vista ~ '^CJ[1-9][0-9]*$'));


create or replace function public.registrar_votos(itens jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  quem     text := nullif(public.auth_email(), '');
  invalido int;
  gravados int;
begin
  if (select auth.uid()) is null or quem is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if not (select public.tem_acesso_orgao('CJ')) then
    raise exception 'acesso ao orgao CJ nao autorizado' using errcode = '42501';
  end if;

  if jsonb_typeof(itens) is distinct from 'array' then
    raise exception 'registrar_votos espera uma lista de itens';
  end if;

  select count(*) into invalido
    from jsonb_array_elements(itens) i
   -- Campo VAZIO é ausência de decisão, e é legítimo: processo retirado de
      -- pauta tem status e não tem voto, e a tela promete "preencha o voto OU o
      -- status". Ele passa e grava null. O que se recusa é rótulo PREENCHIDO
      -- fora da lista — daí testar `is not null and not in`, e não coalesce para
      -- '', que barraria também o campo em branco.
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or (nullif(i ->> 'voto', '') is not null
          and nullif(i ->> 'voto', '') not in ('Manter', 'Anular', 'Retirado', 'Vista'))
      or (nullif(i ->> 'status', '') is not null
          and nullif(i ->> 'status', '')
              not in ('Julgado', 'Retornou', 'Retirado', 'Vista'))
      -- A cadeira da Vista precisa estar ocupada hoje: é para ela que o
      -- processo volta.
      or (i ? 'cadeira_vista' and i ->> 'cadeira_vista' is not null
          and not exists (select 1 from public.cadeiras_cj c
                           where c.cadeira = i ->> 'cadeira_vista' and c.ate is null));

  if invalido > 0 then
    raise exception 'id, voto, status ou cadeira da vista fora do permitido (% item(ns))', invalido;
  end if;

  -- Só o que ainda está pendente, ou o que esta mesma página já preencheu antes
  -- (typo se corrige). O histórico que veio da planilha tem atualizado_em nulo
  -- e os dois campos preenchidos: fica intocável por aqui.
  --
  -- Campo em BRANCO não apaga o que já está gravado — daí o coalesce. Branco
  -- quer dizer "ainda não decidi", e a linha do histórico que tem voto e não
  -- tem status entra nesta fila justamente por isso: sem o coalesce, gravar a
  -- sessão inteira levaria o voto antigo junto, e a mesma porta aceitaria um
  -- POST de {"voto":"","status":""} para zerar uma decisão. Trocar um rótulo
  -- por outro continua funcionando; só apagar por aqui é que não.
  --
  -- Isso não tira nada da tela: a opção em branco do select é `disabled`, então
  -- a secretaria nunca pôde voltar um campo ao vazio. DESFAZER um registro é
  -- decisão administrativa, e vai ter porta própria — um painel de admin com
  -- permissão que a secretaria não tem. Enquanto ela não existe, o certo é a
  -- ausência da operação, não um branco que apaga em silêncio.
  -- Trava em ordem de id antes de comparar e atualizar. Duas transações
  -- concorrentes não podem validar a mesma fotografia e sobrescrever decisões.
  perform j.id from public.julgados_cj j
    where j.id in (select (i ->> 'id')::bigint from jsonb_array_elements(itens) i)
    order by j.id for update;

  if exists (
    select 1 from public.julgados_cj j
    join jsonb_array_elements(itens) i on j.id = (i ->> 'id')::bigint
    where (j.voto is null or j.status is null or j.atualizado_em is not null)
      and coalesce(nullif(i ->> 'voto', ''), j.voto) = 'Vista'
      and (case when i ? 'cadeira_vista' then i ->> 'cadeira_vista'
                else j.cadeira_vista end) is null
  ) then
    raise exception 'Voto Vista exige a cadeira para onde o processo vai.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.julgados_cj j
    join jsonb_array_elements(itens) i on j.id = (i ->> 'id')::bigint
    cross join (values ('voto'), ('status'), ('cadeira_vista')) c(campo)
    where (j.voto is null or j.status is null or j.atualizado_em is not null)
      and (case when c.campo = 'cadeira_vista' then i ? c.campo
                else nullif(i ->> c.campo, '') is not null end)
      and (i ->> c.campo) is distinct from (to_jsonb(j) ->> c.campo)
      and (
        -- Clientes antigos podem preencher vazios, mas não substituir uma
        -- decisão sem informar o valor anterior. Reenvio idêntico é seguro.
        (not coalesce((i -> 'anterior') ? c.campo, false)
          and (to_jsonb(j) ->> c.campo) is not null)
        or (coalesce((i -> 'anterior') ? c.campo, false)
          and nullif(i -> 'anterior' ->> c.campo, '')
              is distinct from (to_jsonb(j) ->> c.campo))
      )
  ) then
    raise exception 'Este julgamento foi alterado por outra pessoa. Suas escolhas foram preservadas; atualize a página para conferir os valores atuais antes de salvar.'
      using errcode = '40001';
  end if;

  update public.julgados_cj j
     set voto           = coalesce(nullif(i ->> 'voto', ''), j.voto),
         status         = coalesce(nullif(i ->> 'status', ''), j.status),
         -- A cadeira só existe com voto Vista (julgados_cj_cadeira_vista_valida).
         cadeira_vista  = case
                           when coalesce(nullif(i ->> 'voto', ''), j.voto) is distinct from 'Vista'
                             then null
                           when i ? 'cadeira_vista' then i ->> 'cadeira_vista'
                           else j.cadeira_vista
                         end,
         atualizado_em  = now(),
         atualizado_por = quem
    from jsonb_array_elements(itens) i
   where j.id = (i ->> 'id')::bigint
     and (j.voto is null or j.status is null or j.atualizado_em is not null);

  get diagnostics gravados = row_count;
  return gravados;
end;
$$;


create or replace function public.julgados_cj_sincronizar_retorno()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  destino text;
  original public.acervo_cj%rowtype;
begin
  if new.atualizado_em is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.voto is not distinct from new.voto
       and old.status is not distinct from new.status
       and old.cadeira_vista is not distinct from new.cadeira_vista
       and not exists (select 1 from public.acervo_cj a
                        where a.retorno_julgado_id = new.id) then
      return new;
    end if;
  end if;

  if (new.voto in ('Vista', 'Retirado') or new.status in ('Vista', 'Retirado'))
     and new.voto <> new.status then
    raise exception 'Processo %: voto % e status % não combinam. Vista e Retirado exigem voto e status iguais.',
      new.num_processo, new.voto, new.status
      using errcode = '22023';
  end if;

  if new.voto = 'Vista' then
    if not exists (select 1 from public.cadeiras_cj c
                    where c.cadeira = new.cadeira_vista and c.ate is null) then
      raise exception 'Processo %: voto Vista exige a cadeira para onde o processo vai (CJ1 a CJ5).',
        new.num_processo
        using errcode = '22023';
    end if;
    destino := new.cadeira_vista;
  elsif new.voto = 'Retirado' then
    if coalesce(new.relator, '') !~ '^CJ[1-9][0-9]*$' then
      raise exception 'Processo %: voto Retirado volta para a cadeira que levou o processo à sessão, e o processo não tem cadeira no acervo.',
        new.num_processo
        using errcode = '22023';
    end if;
    destino := new.relator;
  end if;

  if destino is not null and new.status = new.voto then
    select * into original from public.acervo_cj a where a.id = new.acervo_id;

    -- Retirado pode ser registrado antes da sessão: o retorno vale a partir da
    -- gravação, nunca de uma data futura, que cairia fora das faixas do painel.
    insert into public.acervo_cj
      (num_processo, relator, data_distribuicao, defesa, assunto,
       origem, retorno_julgado_id)
    values
      (new.num_processo, destino, least(new.data_sessao, current_date), new.defesa,
       coalesce(original.assunto, 'Auto de Infração'), 'retorno', new.id)
    on conflict on constraint acervo_cj_retorno_unico do update
      set num_processo = excluded.num_processo,
          relator = excluded.relator,
          data_distribuicao = excluded.data_distribuicao,
          defesa = excluded.defesa,
          assunto = excluded.assunto;
  else
    -- Desfazer a decisão remove só o retorno que ela criou.
    delete from public.acervo_cj a where a.retorno_julgado_id = new.id;
  end if;

  return new;
end;
$$;


create or replace function public.admin_corrigir_julgado_cj(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis  constant text[] := array['voto', 'status', 'data_sessao', 'pauta',
                                      'cadeira_vista'];
  observados constant text[] := array['voto', 'status', 'data_sessao', 'pauta',
                                      'cadeira_vista', 'acervo_id', 'relator', 'defesa',
                                      'data_distribuicao'];
  antes  public.julgados_cj%rowtype;
  depois public.julgados_cj%rowtype;
  delta  jsonb;
begin
  perform public.admin_exigir('CJ');
  perform public.admin_validar_campos(p_campos, editaveis);

  -- Os mesmos rótulos de registrar_votos. Mudou lá, muda aqui.
  if p_campos ? 'voto' and nullif(p_campos ->> 'voto', '') is not null
     and p_campos ->> 'voto' not in ('Manter', 'Anular', 'Retirado', 'Vista') then
    raise exception 'voto fora do permitido: %', p_campos ->> 'voto' using errcode = '22023';
  end if;

  if p_campos ? 'status' and nullif(p_campos ->> 'status', '') is not null
     and p_campos ->> 'status' not in ('Julgado', 'Retornou', 'Retirado', 'Vista') then
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

  if p_campos ? 'cadeira_vista' and nullif(p_campos ->> 'cadeira_vista', '') is not null
     and not exists (select 1 from public.cadeiras_cj c
                      where c.cadeira = p_campos ->> 'cadeira_vista' and c.ate is null) then
    raise exception 'cadeira da vista fora do permitido: %', p_campos ->> 'cadeira_vista'
      using errcode = '22023';
  end if;

  -- for update: duas correções simultâneas não gravam a mesma foto anterior.
  select * into antes from public.julgados_cj where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  begin
    update public.julgados_cj j
       -- nullif como em registrar_votos: a validação acima já trata '' como
       -- ausência, e sem ele o UPDATE gravava a string vazia literal — um voto
       -- em branco que passa pela allowlist e vira selo vazio em todo painel.
       set voto        = case when p_campos ? 'voto'
                              then nullif(p_campos ->> 'voto', '') else j.voto end,
           status      = case when p_campos ? 'status'
                              then nullif(p_campos ->> 'status', '') else j.status end,
           data_sessao = case when p_campos ? 'data_sessao'
                              then (p_campos ->> 'data_sessao')::date else j.data_sessao end,
           pauta       = case when p_campos ? 'pauta'
                              then nullif(p_campos ->> 'pauta', '')::int else j.pauta end,
           -- A cadeira só existe com voto Vista (julgados_cj_cadeira_vista_valida):
           -- corrigir o voto para outro rótulo leva a cadeira junto.
           cadeira_vista = case
                             when (case when p_campos ? 'voto'
                                        then nullif(p_campos ->> 'voto', '') else j.voto end)
                                  is distinct from 'Vista' then null
                             when p_campos ? 'cadeira_vista'
                               then nullif(p_campos ->> 'cadeira_vista', '')
                             else j.cadeira_vista
                           end,
           atualizado_em  = now(),
           atualizado_por = public.auth_email()
     where j.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), observados);
  if delta <> '{}'::jsonb then
    perform public.auditar('CJ', 'corrigir_julgado', 'julgados_cj', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'julgados_cj',
                            'operacao', 'corrigir_julgado',
                            'alterados', delta, 'propagados', '[]'::jsonb);
end;
$$;
