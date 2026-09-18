begin;

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
              not in ('Julgado', 'Retornou', 'Retirado', 'Vista'));

  if invalido > 0 then
    raise exception 'id, voto ou status fora do permitido (% item(ns))', invalido;
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
    cross join (values ('voto'), ('status')) c(campo)
    where (j.voto is null or j.status is null or j.atualizado_em is not null)
      and nullif(i ->> c.campo, '') is not null
      and nullif(i ->> c.campo, '') is distinct from (to_jsonb(j) ->> c.campo)
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
         atualizado_em  = now(),
         atualizado_por = quem
    from jsonb_array_elements(itens) i
   where j.id = (i ->> 'id')::bigint
     and (j.voto is null or j.status is null or j.atualizado_em is not null);

  get diagnostics gravados = row_count;
  return gravados;
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
  editaveis  constant text[] := array['voto', 'status', 'data_sessao', 'pauta'];
  observados constant text[] := array['voto', 'status', 'data_sessao', 'pauta',
                                      'acervo_id', 'relator', 'defesa', 'data_distribuicao'];
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

alter table public.julgados_creg
  drop column if exists em_relacao_cj;

alter table public.julgados_creg
  add column em_relacao_cj text generated always as (
    case
      when voto is null or voto_cj is null then null
      when status = 'Retirado' then null
      when voto in ('Retirado', 'Aprovação', 'Indeferimento', 'Arquivamento') then null
      when voto_cj = 'Retirado' then null
      when voto_cj = voto then null
      when voto_cj = 'Anular' then 'Divergente-Não Revel'
      else 'Divergente'
    end
  ) stored;

commit;
