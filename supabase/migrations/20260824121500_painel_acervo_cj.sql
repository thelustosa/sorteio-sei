-- Painel do acervo: a matriz de processos parados por faixa de tempo e relator.
--
-- O navegador NÃO lê acervo_cj — a tabela só tem política de INSERT, e abrir
-- SELECT nela para montar o painel entregaria 200 linhas ao cliente para ele
-- contar no JavaScript. Em vez disso, a agregação mora no banco e sai por uma
-- função, como já acontece com registrar_votos: a porta é estreita, o payload é
-- de 40 células e a regra do que conta como "não julgado" fica em um lugar só.
--
-- SECURITY DEFINER porque precisa ler acervo_cj, que é fechada. Por isso:
-- search_path fixo, exigência de sessão autenticada no corpo, e EXECUTE apenas
-- para authenticated — o Postgres concede EXECUTE a PUBLIC por padrão, e sem o
-- revoke abaixo a função viraria endpoint aberto em /rest/v1/rpc.

create or replace function public.resumo_acervo_cj()
returns table (ordem int, faixa text, relator text, processos int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  return query
  with faixas(ordem, faixa, de, ate) as (values
      (1, 'Até 15 dias',            0,  15),
      (2, 'Até 30 dias',           16,  30),
      (3, 'Até 45 dias',           31,  45),
      (4, 'Há 3 meses',            46,  90),
      (5, 'Entre 3 e 6 meses',     91, 180),
      (6, 'Entre 6 meses e 1 ano',181, 365),
      (7, 'Há mais de 1 ano',     366, 730),
      (8, 'Há 2 anos',            731, 2147483647)
  ),

  -- Uma linha por PROCESSO, não por distribuição: um processo redistribuído
  -- conta uma vez só, na cadeira e na data da distribuição mais recente. O
  -- total do painel é um número de processos parados.
  --
  -- "Não julgado" = não aparece em julgados_cj. Um processo que foi à mesa e
  -- voltou sem decisão (Retornou, Vista, Retirado) sai do painel: ele tem dono
  -- e fila própria, que é a tela de registro. Para contar esses aqui também,
  -- acrescente `and j.status = 'Julgado'` ao not exists.
  pendentes as (
    select distinct on (a.num_processo)
           a.relator,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),

  -- Todo relator do acervo vira coluna, mesmo sem processo parado — uma coluna
  -- que some conforme o dado muda faz a tabela dançar entre um dia e outro.
  relatores as (select distinct acervo_cj.relator from public.acervo_cj)

  select f.ordem, f.faixa, r.relator, count(p.relator)::int
    from faixas f
   cross join relatores r
    left join pendentes p
           on p.relator = r.relator
          and p.dias between f.de and f.ate
   group by f.ordem, f.faixa, r.relator
   order by f.ordem, r.relator;
end;
$$;

revoke all on function public.resumo_acervo_cj() from public, anon, service_role;
grant execute on function public.resumo_acervo_cj() to authenticated;
