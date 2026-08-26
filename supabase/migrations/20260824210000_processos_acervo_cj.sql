-- Detalhe de uma célula do painel: quais processos estão ali.
--
-- O painel conta; esta função lista. Sem ela, ver "22" e querer saber quais são
-- exigiria abrir acervo_cj para o navegador, e a tabela é fechada de propósito.
--
-- Os dois parâmetros são opcionais, e é isso que faz qualquer número da tabela
-- ser clicável com uma consulta só:
--
--   (ordem, relator) -> a célula                 CJ1 em "Até 15 dias"
--   (ordem, null)    -> o total da linha         a faixa inteira
--   (null, relator)  -> o total da coluna        a cadeira inteira
--   (null, null)     -> o total geral            o acervo pendente
--
-- A definição de pendente e a de faixa são as MESMAS de resumo_acervo_cj. Se as
-- duas divergirem, a soma do painel deixa de bater com a lista que ele abre —
-- há um teste comparando as duas justamente por isso.

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

  return query
  with faixas(ordem, de, ate) as (values
      (1,   0,  15), (2,  16,  30), (3,  31,  45), (4,  46,  90),
      (5,  91, 180), (6, 181, 365), (7, 366, 730), (8, 731, 2147483647)
  ),
  -- Uma linha por processo, na distribuição mais recente: um processo
  -- redistribuído aparece uma vez, na cadeira de quem está com ele agora.
  pendentes as (
    select distinct on (a.num_processo)
           a.num_processo,
           a.relator,
           a.data_distribuicao,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo)
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

revoke all on function public.processos_acervo_cj(int, text) from public, anon, service_role;
grant execute on function public.processos_acervo_cj(int, text) to authenticated;
