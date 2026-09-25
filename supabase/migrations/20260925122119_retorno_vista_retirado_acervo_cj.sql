-- Vista e Retirado na Câmara de Julgamento, espelhando o Conselho (#62/#63).
--
-- 1. julgados_cj.cadeira_vista guarda a cadeira escolhida na tela para a Vista.
-- 2. acervo_cj ganha a origem 'retorno', ligada ao julgado que a criou.
-- 3. O gatilho julgados_cj_retorno devolve o processo ao acervo pelo STATUS:
--    Vista na cadeira escolhida, Retirado na cadeira que o levou à sessão.
-- 4. registrar_votos grava a cadeira; os painéis ignoram o julgado que criou o
--    retorno; as portas do admin tratam a cadeira e recusam linhas de retorno.
--
-- Sem backfill: os Vista/Retirado da Câmara com atualizado_em são de 2024,
-- carimbados em carga, e a planilha é a base do histórico da Câmara.


alter table public.acervo_cj
  drop constraint if exists acervo_cj_origem_check;
alter table public.acervo_cj
  add constraint acervo_cj_origem_check
  check (origem in ('sorteio', 'planilha', 'ata', 'retorno'));

-- Vista e Retirado devolvem o processo ao acervo, como no Conselho. A cadeira
-- escolhida para a Vista fica no julgado; o retorno é uma distribuição nova
-- (origem 'retorno') ligada a ele. O identificador na chave única permite o
-- Retirado voltar à mesma cadeira na mesma data da distribuição original.
alter table public.julgados_cj add column if not exists cadeira_vista text;
alter table public.julgados_cj drop constraint if exists julgados_cj_cadeira_vista_valida;
alter table public.julgados_cj add constraint julgados_cj_cadeira_vista_valida
  check (cadeira_vista is null or
         ((coalesce(status, '') = 'Vista' or coalesce(voto, '') = 'Vista')
          and cadeira_vista ~ '^CJ[1-9][0-9]*$'));

alter table public.acervo_cj add column if not exists retorno_julgado_id bigint;
alter table public.acervo_cj drop constraint if exists acervo_cj_distribuicao_unica;
alter table public.acervo_cj add constraint acervo_cj_distribuicao_unica
  unique nulls not distinct (num_processo, data_distribuicao, relator, retorno_julgado_id);
alter table public.acervo_cj drop constraint if exists acervo_cj_retorno_vinculado;
alter table public.acervo_cj add constraint acervo_cj_retorno_vinculado
  check ((origem = 'retorno') = (retorno_julgado_id is not null));
alter table public.acervo_cj drop constraint if exists acervo_cj_retorno_julgado_id_fkey;
alter table public.acervo_cj add constraint acervo_cj_retorno_julgado_id_fkey
  foreign key (retorno_julgado_id) references public.julgados_cj (id) on delete cascade;
alter table public.acervo_cj drop constraint if exists acervo_cj_retorno_unico;
alter table public.acervo_cj add constraint acervo_cj_retorno_unico
  unique (retorno_julgado_id);

-- Como no Conselho: desfazer ou excluir a decisão que criou o retorno não pode
-- travar no julgado da pauta seguinte que se vinculou a ele.
alter table public.julgados_cj drop constraint if exists julgados_cj_acervo_id_fkey;
alter table public.julgados_cj add constraint julgados_cj_acervo_id_fkey
  foreign key (acervo_id) references public.acervo_cj (id) on delete set null;


create or replace function public.julgados_cj_derivar_do_acervo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origem public.acervo_cj%rowtype;
begin
  if new.data_distribuicao is not null then
    select * into origem
      from public.acervo_cj
     where num_processo = new.num_processo
       and data_distribuicao = new.data_distribuicao
       and retorno_julgado_id is distinct from new.id
     -- Desempate: a mesma distribuição em duas cadeiras é legal, e os dois
     -- ramos precisam escolher a MESMA linha, senão o vínculo troca a cada
     -- rederivação. Quem decide é a cadeira que o julgado já tem — é ela que o
     -- coalesce abaixo preserva, e apontar para a linha de outra cadeira seria a
     -- divergência que verificacao_cj.sql acusa. Sem a cadeira informada
     -- (o caso do sincronizador), nenhuma linha é preferida e o critério cai
     -- para o seguinte, como antes.
     order by (relator is not distinct from new.relator) desc, id
     limit 1;
  else
    select * into origem
      from public.acervo_cj
     where num_processo = new.num_processo
       and data_distribuicao <= new.data_sessao
       and retorno_julgado_id is distinct from new.id
     order by data_distribuicao desc,
              (relator is not distinct from new.relator) desc, id desc
     limit 1;
    if origem.id is null then
      select * into origem
        from public.acervo_cj
       where num_processo = new.num_processo
         and retorno_julgado_id is distinct from new.id
       order by data_distribuicao, id
       limit 1;
    end if;
  end if;

  new.acervo_id         := origem.id;
  new.relator           := coalesce(new.relator, origem.relator);
  new.defesa            := coalesce(new.defesa, origem.defesa);
  new.data_distribuicao := coalesce(new.data_distribuicao, origem.data_distribuicao);
  return new;
end;
$$;


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
      and 'Vista' in (coalesce(nullif(i ->> 'voto', ''), j.voto, ''),
                      coalesce(nullif(i ->> 'status', ''), j.status, ''))
      and (case when i ? 'cadeira_vista' then i ->> 'cadeira_vista'
                else j.cadeira_vista end) is null
  ) then
    raise exception 'Vista exige a cadeira para onde o processo vai.'
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
         -- A cadeira só existe enquanto voto ou status for Vista
         -- (julgados_cj_cadeira_vista_valida).
         cadeira_vista  = case
                           when 'Vista' not in (coalesce(nullif(i ->> 'voto', ''), j.voto, ''),
                                                coalesce(nullif(i ->> 'status', ''), j.status, ''))
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


-- ── CJ · Retorno de Vista e Retirado ao acervo ───────────────────────────────
-- Na Câmara quem decide é o STATUS: Vista volta na cadeira escolhida na tela,
-- Retirado volta na cadeira que levou o processo à sessão. O voto pode estar em
-- branco (retirado de pauta tem status e não tem voto), mas, preenchido, tem de
-- ser o mesmo rótulo. Retornou não é retorno ao acervo: é o processo que voltou
-- de diligência, e continua fora do painel.
--
-- Linhas com atualizado_em nulo não geram retorno: é o histórico da planilha,
-- que não se mexe. Corrigir só metadados de um julgado sem retorno também não.
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

  if new.status = 'Vista' then
    if not exists (select 1 from public.cadeiras_cj c
                    where c.cadeira = new.cadeira_vista and c.ate is null) then
      raise exception 'Processo %: Vista exige a cadeira para onde o processo vai (CJ1 a CJ5).',
        new.num_processo
        using errcode = '22023';
    end if;
    destino := new.cadeira_vista;
  elsif new.status = 'Retirado' then
    if coalesce(new.relator, '') !~ '^CJ[1-9][0-9]*$' then
      raise exception 'Processo %: Retirado volta para a cadeira que levou o processo à sessão, e o processo não tem cadeira no acervo.',
        new.num_processo
        using errcode = '22023';
    end if;
    destino := new.relator;
  end if;

  if destino is not null then
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

revoke all on function public.julgados_cj_sincronizar_retorno()
  from public, anon, authenticated, service_role;

drop trigger if exists julgados_cj_retorno on public.julgados_cj;
create trigger julgados_cj_retorno
  after insert or update of num_processo, voto, status, cadeira_vista, data_sessao, relator,
                            defesa, acervo_id, atualizado_em
  on public.julgados_cj
  for each row execute function public.julgados_cj_sincronizar_retorno();


create or replace function public.resumo_acervo_cj()
returns table (ordem int, faixa text, relator text, conselheiro text, processos int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if not (select public.tem_acesso_orgao('CJ')) then
    raise exception 'acesso ao orgao CJ nao autorizado' using errcode = '42501';
  end if;

  return query
  with faixas(ordem, faixa, de, ate) as (values
      (1, 'Até 15 dias',            0,  15),
      (2, 'Até 30 dias',           16,  30),
      (3, 'Até 45 dias',           31,  45),
      (4, 'Há 3 meses',            46,  90),
      (5, 'Entre 3 e 6 meses',     91, 180),
      (6, 'Entre 6 meses e 1 ano',181, 365),
      (7, 'Entre 1 e 2 anos',     366, 730),
      (8, 'Há mais de 2 anos',    731, 2147483647)
  ),

  -- Uma linha por PROCESSO, não por distribuição: um processo redistribuído
  -- conta uma vez só, na cadeira e na data da distribuição mais recente.
  --
  -- "Não julgado" = não aparece em julgados_cj. Vista e Retirado criam uma
  -- distribuição de retorno (julgados_cj_sincronizar_retorno), e o julgado que
  -- a criou não a esconde. Retornou continua fora do painel.
  --
  -- "Julgado" aqui é julgado DEPOIS de receber esta distribuição
  -- (data_sessao >= data_distribuicao). Sem a correlação de data, um julgado
  -- antigo esconderia para sempre a redistribuição que veio depois dele — o
  -- processo ficaria distribuído e invisível, que é justamente o caso que o
  -- painel existe para mostrar.
  pendentes as (
    select distinct on (a.num_processo)
           a.relator,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao
                          and j.id is distinct from a.retorno_julgado_id)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),

  -- Toda cadeira vigente vira coluna, mesmo sem processo parado: coluna que
  -- aparece e some conforme o dado muda faz a tabela dançar de um dia para o
  -- outro. É também o que faz o painel seguir a composição da Câmara sem
  -- precisar de lista fixa no HTML. Relator fora das cadeiras vigentes só
  -- aparece se tiver processo parado — senão o histórico de 2023 a 2025, gravado
  -- pelo nome, viraria uma fileira de colunas zeradas.
  relatores as (select c.cadeira as relator from public.cadeiras_cj c where c.ate is null
                union
                select pendentes.relator from pendentes)

  -- A tela mostra a cadeira e revela o conselheiro no hover. As duas saem da
  -- mesma consulta para que o front não precise repetir o de-para.
  select f.ordem,
         f.faixa,
         r.relator,
         -- Cadeira sem ocupante conhecido mostra a própria cadeira: melhor um
         -- rótulo honesto do que um hover vazio.
         coalesce(max(c.conselheiro), r.relator),
         count(p.relator)::int
    from faixas f
   cross join relatores r
    left join pendentes p
           on p.relator = r.relator
          and p.dias between f.de and f.ate
    left join public.cadeiras_cj c
           on c.cadeira = r.relator
          and c.ate is null
   group by f.ordem, f.faixa, r.relator
   order by f.ordem, r.relator;
end;
$$;


create or replace function public.processos_acervo_cj(
  p_ordem   int  default null,
  p_relator text default null
)
returns table (
  num_processo      text,
  relator           text,
  conselheiro       text,
  data_distribuicao date,
  dias              int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if not (select public.tem_acesso_orgao('CJ')) then
    raise exception 'acesso ao orgao CJ nao autorizado' using errcode = '42501';
  end if;

  return query
  with faixas(ordem, de, ate) as (values
      (1,   0,  15), (2,  16,  30), (3,  31,  45), (4,  46,  90),
      (5,  91, 180), (6, 181, 365), (7, 366, 730), (8, 731, 2147483647)
  ),
  -- Uma linha por processo, na distribuição mais recente: um processo
  -- redistribuído aparece uma vez, na cadeira de quem está com ele agora.
  -- Pendente é o mesmo de resumo_acervo_cj, correlação de data inclusive.
  pendentes as (
    select distinct on (a.num_processo)
           a.num_processo,
           a.relator,
           a.data_distribuicao,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao
                          and j.id is distinct from a.retorno_julgado_id)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  )
  select p.num_processo,
         p.relator,
         coalesce(c.conselheiro, p.relator),
         p.data_distribuicao,
         p.dias
    from pendentes p
    join faixas f on p.dias between f.de and f.ate
    left join public.cadeiras_cj c
           on c.cadeira = p.relator
          and c.ate is null
   where (p_ordem   is null or f.ordem   = p_ordem)
     and (p_relator is null or p.relator = p_relator)
   -- Mais parado primeiro: é a ordem em que a lista costuma ser lida.
   order by p.data_distribuicao, p.num_processo;
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
           -- A cadeira só existe com voto ou status Vista
           -- (julgados_cj_cadeira_vista_valida).
           cadeira_vista = case
                             when 'Vista' not in (
                                    coalesce(case when p_campos ? 'voto'
                                                  then nullif(p_campos ->> 'voto', '')
                                                  else j.voto end, ''),
                                    coalesce(case when p_campos ? 'status'
                                                  then nullif(p_campos ->> 'status', '')
                                                  else j.status end, ''))
                               then null
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

  -- O retorno de Vista/Retirado é derivado do julgamento, e o gatilho
  -- julgados_cj_retorno o reescreve na próxima correção dele. Editado ou
  -- apagado por aqui, voltaria sem aviso: quem corrige é o julgado.
  if antes.origem = 'retorno' then
    raise exception 'distribuicao de retorno (Vista/Retirado) vem do julgado %: corrija o julgado',
      antes.retorno_julgado_id using errcode = '22023';
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

  -- O retorno de Vista/Retirado é derivado do julgamento, e o gatilho
  -- julgados_cj_retorno o reescreve na próxima correção dele. Editado ou
  -- apagado por aqui, voltaria sem aviso: quem corrige é o julgado.
  if antes.origem = 'retorno' then
    raise exception 'distribuicao de retorno (Vista/Retirado) vem do julgado %: corrija o julgado',
      antes.retorno_julgado_id using errcode = '22023';
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
