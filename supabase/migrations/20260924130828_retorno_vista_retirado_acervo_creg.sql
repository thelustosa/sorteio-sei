-- Retorno de Vista e Retirado ao acervo CREG.

alter table public.acervo_creg add column if not exists retorno_julgado_id bigint;
alter table public.acervo_creg drop constraint if exists acervo_creg_distribuicao_unica;
alter table public.acervo_creg add constraint acervo_creg_distribuicao_unica
  unique nulls not distinct (num_processo, data_distribuicao, unidade, retorno_julgado_id);
alter table public.acervo_creg drop constraint if exists acervo_creg_origem_check;
alter table public.acervo_creg add constraint acervo_creg_origem_check
  check (origem in ('sorteio', 'planilha', 'ata', 'retorno'));
alter table public.acervo_creg drop constraint if exists acervo_creg_retorno_vinculado;
alter table public.acervo_creg add constraint acervo_creg_retorno_vinculado
  check ((origem = 'retorno') = (retorno_julgado_id is not null));
alter table public.acervo_creg drop constraint if exists acervo_creg_retorno_julgado_id_fkey;
alter table public.acervo_creg add constraint acervo_creg_retorno_julgado_id_fkey
  foreign key (retorno_julgado_id) references public.julgados_creg(id) on delete cascade;
alter table public.acervo_creg drop constraint if exists acervo_creg_retorno_unico;
alter table public.acervo_creg add constraint acervo_creg_retorno_unico
  unique (retorno_julgado_id);


create or replace function public.julgados_creg_derivar_do_acervo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origem public.acervo_creg%rowtype;
begin
  if new.data_distribuicao is not null then
    select * into origem
      from public.acervo_creg
     where num_processo = new.num_processo
       and data_distribuicao = new.data_distribuicao
       and retorno_julgado_id is distinct from new.id
     -- Desempate: a mesma distribuição em duas unidades é legal, e os dois
     -- ramos precisam escolher a MESMA linha, senão o vínculo troca a cada
     -- rederivação. Quem decide é a unidade que o julgado já tem — é ela que o
     -- coalesce abaixo preserva, e apontar para a linha de outra unidade seria a
     -- divergência que verificacao_creg.sql acusa. Sem a unidade informada
     -- (o caso do sincronizador), nenhuma linha é preferida e o critério cai
     -- para o seguinte, como antes.
     order by (unidade is not distinct from new.unidade) desc, id
     limit 1;
  else
    select * into origem
      from public.acervo_creg
     where num_processo = new.num_processo
       and data_distribuicao <= new.data_sessao
       and retorno_julgado_id is distinct from new.id
     order by data_distribuicao desc,
              (unidade is not distinct from new.unidade) desc, id desc
     limit 1;
    if origem.id is null then
      select * into origem
        from public.acervo_creg
       where num_processo = new.num_processo
         and retorno_julgado_id is distinct from new.id
       order by data_distribuicao, id
       limit 1;
    end if;
  end if;

  new.acervo_id         := origem.id;
  new.unidade           := coalesce(new.unidade, origem.unidade);
  new.assunto           := coalesce(new.assunto, origem.assunto);
  new.recurso           := coalesce(new.recurso, origem.recurso);
  new.data_distribuicao := coalesce(new.data_distribuicao, origem.data_distribuicao);
  return new;
end;
$$;

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

  if new.voto in ('Vista', 'Retirado')
     and new.status is not null and new.status <> new.voto then
    raise exception 'Voto % exige status % para retornar ao acervo.', new.voto, new.voto
      using errcode = '22023';
  end if;

  if new.voto = 'Vista' then
    if coalesce(new.unidade_vista, '') not in ('CREG1', 'CREG2', 'CREG3', 'CREG4') then
      raise exception 'Voto Vista exige unidade de destino (CREG1 a CREG4).'
        using errcode = '22023';
    end if;
    destino := new.unidade_vista;
  elsif new.voto = 'Retirado' then
    if coalesce(new.unidade, '') !~ '^CREG[1-4]$' then
      raise exception 'Voto Retirado exige unidade atual CREG1 a CREG4.'
        using errcode = '22023';
    end if;
    destino := new.unidade;
  end if;

  if destino is not null and new.status = new.voto then
    select a.interessado into interessado_original
      from public.acervo_creg a where a.id = new.acervo_id;

    insert into public.acervo_creg
      (num_processo, unidade, data_distribuicao, assunto, recurso,
       interessado, origem, retorno_julgado_id)
    values
      (new.num_processo, destino, new.data_sessao, new.assunto, new.recurso,
       interessado_original, 'retorno', new.id)
    on conflict on constraint acervo_creg_retorno_unico do update
      set num_processo = excluded.num_processo,
          unidade = excluded.unidade,
          data_distribuicao = excluded.data_distribuicao,
          assunto = excluded.assunto,
          recurso = excluded.recurso,
          interessado = excluded.interessado;
  else
    -- Desfazer uma decisão provisória remove apenas o retorno que ela criou;
    -- a distribuição original e o julgamento continuam preservados.
    delete from public.acervo_creg a where a.retorno_julgado_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.julgados_creg_sincronizar_retorno()
  from public, anon, authenticated, service_role;

drop trigger if exists julgados_creg_retorno on public.julgados_creg;
create trigger julgados_creg_retorno
  after insert or update of num_processo, voto, status, unidade_vista, data_sessao, unidade,
                            assunto, recurso, acervo_id, atualizado_em
  on public.julgados_creg
  for each row execute function public.julgados_creg_sincronizar_retorno();

create or replace function public.resumo_acervo_creg(p_diligencia boolean default null)
returns table (ordem int, faixa text, unidade text, processos int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if not (select public.tem_acesso_orgao('CREG')) then
    raise exception 'acesso ao orgao CREG nao autorizado' using errcode = '42501';
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
  -- conta uma vez só, na unidade e na data da distribuição mais recente.
  --
  -- "Julgado" aqui é julgado DEPOIS de receber esta distribuição
  -- (data_sessao >= data_distribuicao). Sem a correlação de data, um julgado
  -- antigo esconderia para sempre a redistribuição que veio depois dele — o
  -- processo ficaria distribuído e invisível, que é justamente o caso que o
  -- painel existe para mostrar.
  pendentes as (
    select distinct on (a.num_processo)
           a.num_processo,
           a.unidade,
           a.data_distribuicao,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_creg a
     where not exists (select 1 from public.julgados_creg j
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao
                          and j.id is distinct from a.retorno_julgado_id)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),

  -- O recorte vem DEPOIS do distinct on, e não dentro dele. Dentro, uma
  -- distribuição antiga que casasse com o filtro sobreviveria à mais recente
  -- que não casa, e o processo entraria na matriz com a unidade e o tempo
  -- errados — justamente o caso de redistribuição que a guarda de data existe
  -- para tratar.
  --
  -- A subconsulta lateral é a MESMA, palavra por palavra, de
  -- processos_acervo_creg: se as duas divergirem, a célula abre um número
  -- diferente do que mostrava. O translate normaliza a digitação à mão —
  -- 'NÃO', 'NAO', 'não' e 'Não' são a mesma resposta.
  recorte as (
    select p.unidade, p.dias
      from pendentes p
      left join lateral (
        select max(x.data_diligencia) as desde
          from public.diligencias_creg x
         where x.num_processo = p.num_processo
           and x.data_diligencia >= p.data_distribuicao
           and translate(upper(btrim(coalesce(x.retorno, ''))), 'ÃÁÀÂ', 'AAAA') = 'NAO'
      ) d on true
     where p_diligencia is null or (d.desde is not null) = p_diligencia
  ),

  -- Todas as unidades do acervo, e não só as que sobraram no recorte: a matriz
  -- guarda a mesma forma quando o filtro liga e desliga, e uma coluna inteira
  -- de travessões diz algo — aquela unidade não tem processo em diligência.
  unidades as (select distinct acervo_creg.unidade from public.acervo_creg)

  select f.ordem,
         f.faixa,
         u.unidade,
         count(p.unidade)::int
    from faixas f
   cross join unidades u
    left join recorte p
           on p.unidade = u.unidade
          and p.dias between f.de and f.ate
   group by f.ordem, f.faixa, u.unidade
   order by f.ordem, u.unidade;
end;
$$;

create or replace function public.processos_acervo_creg(
  p_ordem       int     default null,
  p_unidade     text    default null,
  p_diligencia  boolean default null
)
returns table (
  num_processo      text,
  unidade           text,
  assunto           text,
  data_distribuicao date,
  dias              int,
  diligencia_desde  date
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

  if not (select public.tem_acesso_orgao('CREG')) then
    raise exception 'acesso ao orgao CREG nao autorizado' using errcode = '42501';
  end if;

  return query
  with faixas(ordem, de, ate) as (values
      (1,   0,  15), (2,  16,  30), (3,  31,  45), (4,  46,  90),
      (5,  91, 180), (6, 181, 365), (7, 366, 730), (8, 731, 2147483647)
  ),
  pendentes as (
    select distinct on (a.num_processo)
           a.num_processo,
           a.unidade,
           a.assunto,
           a.data_distribuicao,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_creg a
     where not exists (select 1 from public.julgados_creg j
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao
                          and j.id is distinct from a.retorno_julgado_id)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  )
  select p.num_processo,
         p.unidade,
         p.assunto,
         p.data_distribuicao,
         p.dias,
         d.desde
    from pendentes p
    join faixas f on p.dias between f.de and f.ate
    left join lateral (
      select max(x.data_diligencia) as desde
        from public.diligencias_creg x
       where x.num_processo = p.num_processo
         and x.data_diligencia >= p.data_distribuicao
         and translate(upper(btrim(coalesce(x.retorno, ''))), 'ÃÁÀÂ', 'AAAA') = 'NAO'
    ) d on true
   where (p_ordem      is null or f.ordem = p_ordem)
     and (p_unidade    is null or p.unidade = p_unidade)
     and (p_diligencia is null or (d.desde is not null) = p_diligencia)
   order by p.data_distribuicao, p.num_processo;
end;
$$;

drop policy if exists "usuario autenticado pode inserir" on public.acervo_creg;
drop policy if exists "usuario com acesso creg pode inserir" on public.acervo_creg;
create policy "usuario com acesso creg pode inserir"
  on public.acervo_creg for insert to authenticated
  with check ((select public.tem_acesso_orgao('CREG'))
              and origem <> 'retorno' and retorno_julgado_id is null);

