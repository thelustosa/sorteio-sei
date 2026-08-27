-- De-para entre cadeira e conselheiro, e a volta do sorteio por cadeira.
--
-- Contexto. O acervo nasceu com duas convenções na mesma coluna: o histórico da
-- planilha e as atas do SEI trazem o NOME do conselheiro; o sorteador gravava a
-- CADEIRA (CJ1..CJ5). Sem um de-para, relatório por relator teria dez valores
-- para cinco pessoas, então o sorteio foi provisoriamente passado a gravar
-- nome. Agora que a relação existe, a cadeira volta a ser o valor canônico e o
-- nome vira apresentação.
--
-- Por que a cadeira e não o nome. A cadeira é estável: quando a composição da
-- Câmara mudar, o processo distribuído em 2026 continua tendo sido da CJ3
-- daquele período, e o de-para resolve quem era. Guardar o nome congelaria a
-- pessoa na linha e faria a troca de composição reescrever a história.
--
-- A tabela é por PERÍODO por isso mesmo: `desde`/`ate` delimitam a vigência, e
-- uma nova composição entra como linha nova em vez de UPDATE.

create table if not exists public.cadeiras_cj (
  cadeira     text not null check (cadeira ~ '^CJ[1-9][0-9]*$'),
  conselheiro text not null check (length(trim(conselheiro)) > 0),
  desde       date not null,
  ate         date,
  constraint cadeiras_cj_periodo_valido check (ate is null or ate >= desde),
  primary key (cadeira, desde)
);

comment on table public.cadeiras_cj is
  'Quem ocupa cada cadeira da CJ, por período. acervo_cj.relator guarda a '
  'cadeira; o nome do conselheiro sai daqui. Composição nova entra como linha '
  'nova, nunca como UPDATE — senão o histórico passa a apontar para a pessoa '
  'errada.';

-- Uma cadeira tem, no máximo, um período em aberto. A chave primária não
-- impede duas linhas com `ate` nulo, e duas ocupações vigentes multiplicariam
-- cada célula do painel pelo join do de-para — o painel contaria o dobro sem
-- nenhum erro aparecer.
create unique index if not exists ux_cadeiras_cj_vigente
  on public.cadeiras_cj (cadeira) where ate is null;

-- Composição da Resolução Normativa nº 333/2026-CR, a que assina as atas de
-- sorteio 010 a 014/2026. `desde` cobre todo o dado que existe hoje em
-- produção, que é de 2026.
insert into public.cadeiras_cj (cadeira, conselheiro, desde) values
  ('CJ1', 'Paulo Otoni Ribeiro',             date '2026-01-01'),
  ('CJ2', 'Deusdete Cardoso Belém',          date '2026-01-01'),
  ('CJ3', 'Dorivan de Souza Lima',           date '2026-01-01'),
  ('CJ4', 'Paulo Henrique Oliveira Marques', date '2026-01-01'),
  ('CJ5', 'Lorena Patricia de Oliveira',     date '2026-01-01')
on conflict (cadeira, desde) do update set conselheiro = excluded.conselheiro;

alter table public.cadeiras_cj enable row level security;
-- Sem política: o navegador não lê esta tabela direto. Quem traduz é a função
-- do painel, que é SECURITY DEFINER.

-- ── Converter o que já está gravado ──────────────────────────────────────────
-- O de-para é bijetivo, então a troca não pode colidir com
-- acervo_cj_distribuicao_unica (num_processo, data_distribuicao, relator): dois
-- nomes distintos nunca viram a mesma cadeira.
--
-- Nome sem cadeira conhecida FICA COMO ESTÁ, e o aviso diz quais. Não é erro:
-- o histórico de 2024 e 2025 tem conselheiros de composições anteriores, e
-- inventar o número da cadeira deles seria pior do que deixar o nome. Abortar
-- aqui tornaria a migração impossível de repetir depois de um restaurar_cj.sql,
-- que devolve justamente esse histórico.
do $$
declare
  sem_cadeira text;
begin
  select string_agg(distinct relator, ', ') into sem_cadeira
    from (select relator from public.acervo_cj
           union select relator from public.julgados_cj where relator is not null) r
   where relator !~ '^CJ[1-9][0-9]*$'
     and relator not in (select conselheiro from public.cadeiras_cj);

  if sem_cadeira is not null then
    raise notice 'relator sem cadeira no de-para, mantido pelo nome: %', sem_cadeira;
  end if;

  update public.acervo_cj a
     set relator = c.cadeira
    from public.cadeiras_cj c
   where a.relator = c.conselheiro
     and a.data_distribuicao >= c.desde
     and (c.ate is null or a.data_distribuicao <= c.ate);

  update public.julgados_cj j
     set relator = c.cadeira
    from public.cadeiras_cj c
   where j.relator = c.conselheiro
     and j.data_sessao >= c.desde
     and (c.ate is null or j.data_sessao <= c.ate);
end $$;

-- ── O painel passa a devolver a cadeira e o nome ─────────────────────────────
-- A tela mostra a cadeira e revela o conselheiro no hover. As duas informações
-- saem da mesma consulta para que o front não precise repetir o de-para.
-- A assinatura ganha a coluna conselheiro, e CREATE OR REPLACE não muda tipo de
-- retorno — daí o drop antes. Como o front antigo continua funcionando com uma
-- coluna a mais, a janela entre o drop e o create é o único risco, e ela é de
-- milissegundos dentro da mesma transação da migração.
drop function if exists public.resumo_acervo_cj();

create function public.resumo_acervo_cj()
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
  pendentes as (
    select distinct on (a.num_processo)
           a.relator,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),
  relatores as (select distinct acervo_cj.relator from public.acervo_cj)
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

revoke all on function public.resumo_acervo_cj() from public, anon, service_role;
grant execute on function public.resumo_acervo_cj() to authenticated;
