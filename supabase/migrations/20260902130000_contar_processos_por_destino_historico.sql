-- Mostra no histórico quantos processos cada unidade do CREG ou cadeira da CJ
-- recebeu na rodada. A lista continua vindo de uma única RPC: não abre os
-- acervos ao navegador nem faz uma busca adicional por sorteio.

-- O retorno ganhou `distribuicao`; PostgreSQL não permite trocar o tipo de
-- retorno com CREATE OR REPLACE. O DROP é seguro aqui porque a recriação ocorre
-- na mesma transação do schema/migração e nenhuma tabela depende da função.
drop function if exists public.historico_sorteios(text);

create or replace function public.historico_sorteios(p_colegiado text)
returns table (
  data_sorteio date,
  sorteado_em  timestamptz,
  processos    int,
  destinos     text[],
  distribuicao jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  marco constant date := public.historico_marco();
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if coalesce(p_colegiado, '') not in ('CJ', 'CREG') then
    raise exception 'colegiado desconhecido: %', p_colegiado using errcode = '22023';
  end if;

  return query
  -- Primeiro contamos cada destino dentro da rodada; depois reunimos essas
  -- parcelas. Assim `processos`, `destinos` e `distribuicao` nascem da mesma
  -- agregação e não podem divergir.
  with linhas as (
    select a.data_distribuicao as data_sorteio, a.sorteado_em,
           a.relator as destino
      from public.acervo_cj a
     where p_colegiado = 'CJ'
       and a.origem = 'sorteio'
       and a.data_distribuicao >= marco
    union all
    select b.data_distribuicao, b.sorteado_em, b.unidade
      from public.acervo_creg b
     where p_colegiado = 'CREG'
       and b.origem = 'sorteio'
       and b.data_distribuicao >= marco
  ), por_destino as (
    select l.data_sorteio, l.sorteado_em, l.destino, count(*)::int as processos
      from linhas l
     group by l.data_sorteio, l.sorteado_em, l.destino
  )
  select d.data_sorteio, d.sorteado_em, sum(d.processos)::int,
         array_agg(d.destino order by d.destino),
         jsonb_agg(
           jsonb_build_object('destino', d.destino, 'processos', d.processos)
           order by d.destino
         )
    from por_destino d
   group by d.data_sorteio, d.sorteado_em
   -- Mais recente primeiro, que é como um histórico é lido. `nulls last` deixa
   -- a rodada sem carimbo depois da carimbada do mesmo dia, e não antes dela.
   order by 1 desc, 2 desc nulls last;
end;
$$;

revoke all on function public.historico_sorteios(text) from public, anon, service_role;
grant execute on function public.historico_sorteios(text) to authenticated;
