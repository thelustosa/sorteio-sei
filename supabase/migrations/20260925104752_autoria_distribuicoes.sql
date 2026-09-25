-- O token autenticado assina a autoria de distribuições feitas no sorteador.
-- Importações e linhas preexistentes permanecem sem autor conhecido.
alter table public.acervo_cj add column if not exists criado_por text;
alter table public.acervo_creg add column if not exists criado_por text;

create or replace function public.acervo_registrar_autor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem = 'sorteio' and (select auth.uid()) is not null then
    new.criado_por := nullif(public.auth_email(), '');
    if new.criado_por is null then
      raise exception 'e-mail do usuário autenticado não disponível'
        using errcode = '28000';
    end if;
  else
    new.criado_por := null;
  end if;
  return new;
end;
$$;

revoke all on function public.acervo_registrar_autor()
  from public, anon, authenticated, service_role;

drop trigger if exists acervo_cj_registrar_autor on public.acervo_cj;
create trigger acervo_cj_registrar_autor
  before insert on public.acervo_cj
  for each row execute function public.acervo_registrar_autor();

drop trigger if exists acervo_creg_registrar_autor on public.acervo_creg;
create trigger acervo_creg_registrar_autor
  before insert on public.acervo_creg
  for each row execute function public.acervo_registrar_autor();

-- O retorno mudou; DROP preserva a assinatura da RPC e permite declarar Quem.
drop function if exists public.admin_sorteios(text);
create function public.admin_sorteios(p_colegiado text)
returns table (data_distribuicao date, sorteado_em timestamptz, origem text,
               processos int, destinos text[], quem text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  with linhas as (
    select a.data_distribuicao as dia, a.sorteado_em as carimbo,
           a.origem as fonte, a.relator as destino, a.criado_por as autor
      from public.acervo_cj a
     where p_colegiado = 'CJ'
    union all
    select b.data_distribuicao, b.sorteado_em, b.origem, b.unidade, b.criado_por
      from public.acervo_creg b
     where p_colegiado = 'CREG'
  ), por_destino as (
    select l.dia, l.carimbo, l.fonte, l.destino, l.autor, count(*)::int as qtd
      from linhas l
     group by l.dia, l.carimbo, l.fonte, l.destino, l.autor
  )
  select d.dia, d.carimbo, d.fonte, sum(d.qtd)::int,
         array_agg(distinct d.destino order by d.destino),
         case when count(*) filter (where d.autor is null) = 0
                   and count(distinct d.autor) = 1
              then min(d.autor) else null end
    from por_destino d
   group by d.dia, d.carimbo, d.fonte
   order by 1 desc, 2 desc nulls last, 3;
end;
$$;

revoke all on function public.admin_sorteios(text) from public, anon, service_role;
grant execute on function public.admin_sorteios(text) to authenticated;
