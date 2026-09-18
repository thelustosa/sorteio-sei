
-- ── Painel administrativo · meta de 45 dias (issue #48) ─────────────────────
-- julgados_creg já tinha meta_45; julgados_cj só tinha dias_dt. A coluna nova
-- repete a regra do Conselho, inclusive o nulo quando a sessão é anterior à
-- distribuição ou falta a data de distribuição, para as duas telas contarem do
-- mesmo jeito.
--
-- admin_meta_45 devolve, por mês da sessão, os julgados com status 'Julgado'
-- dentro, fora e sem prazo aferível. O painel agrupa os meses e filtra o ano.

alter table public.julgados_cj
  add column if not exists meta_45 boolean generated always as (
    case when data_sessao >= data_distribuicao
         then (data_sessao - data_distribuicao) <= 45
    end
  ) stored;

create or replace function public.admin_meta_45(p_colegiado text)
returns table (ano int, mes int, julgados int, dentro int, fora int, sem_prazo int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  with linhas as (
    select j.data_sessao as dia, j.meta_45 as meta
      from public.julgados_cj j
     where p_colegiado = 'CJ' and j.status = 'Julgado'
    union all
    select k.data_sessao, k.meta_45
      from public.julgados_creg k
     where p_colegiado = 'CREG' and k.status = 'Julgado'
  )
  select extract(year from l.dia)::int, extract(month from l.dia)::int,
         count(*)::int,
         count(*) filter (where l.meta)::int,
         count(*) filter (where not l.meta)::int,
         count(*) filter (where l.meta is null)::int
    from linhas l
   group by 1, 2
   order by 1, 2;
end;
$$;

revoke all on function public.admin_meta_45(text) from public, anon, service_role;
grant execute on function public.admin_meta_45(text) to authenticated;
