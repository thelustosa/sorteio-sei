-- Filtro "Em diligência" no painel do acervo do Conselho Regulador.
--
-- Um processo em diligência está parado por decisão do colegiado, não por
-- atraso de quem o relata — e hoje os dois casos aparecem juntos na mesma
-- célula do painel. Esta migração traz o registro das diligências para o banco
-- e ensina as duas funções do painel a separar um do outro.
--
-- A Câmara de Julgamento não é tocada: não há registro equivalente para ela.

-- ── CREG · Diligências ───────────────────────────────────────────────────────
-- Espelho de uma planilha que a equipe da AGR mantém à mão e publica na web.
-- Uma linha por DILIGÊNCIA, não por processo: o mesmo processo volta à planilha
-- cada vez que é mandado a diligência de novo (202300029006124 aparece três
-- vezes). Quem sincroniza é sincronizacao/diligencias.py, que substitui a
-- tabela inteira a cada rodada — a planilha é a fonte, e 44 linhas não pagam
-- lógica de diferença.
--
-- O que NÃO entra: a coluna INTERESSADO da planilha, pela mesma razão que
-- acervo_creg.interessado não é preenchido por importação (ver o comentário
-- lá). Nas linhas recentes ela nem traz interessado — traz 'CREG3'.
create table if not exists public.diligencias_creg (
  id              bigint generated always as identity primary key,
  num_processo    text        not null check (num_processo ~ '^[0-9]{15}$'),
  data_diligencia date        not null,

  -- Os três campos de texto da planilha, guardados como vieram. Nenhum deles
  -- decide coisa alguma (ver o comentário do recorte, abaixo); estão aqui para
  -- quem for conferir um caso à mão e para não perder o que a AGR escreveu.
  descricao       text,
  retorno         text,
  julgados        text,

  -- A posição na planilha. Desempata duas diligências do mesmo processo na
  -- mesma data, que é o único critério que a planilha oferece para ordená-las.
  linha           int         not null,
  atualizado_em   timestamptz not null default now()
);

-- Por onde as duas funções do painel entram.
create index if not exists diligencias_creg_processo
  on public.diligencias_creg (num_processo, data_diligencia desc);

-- Fechada ao navegador, como o acervo: quem lê são as funções security definer
-- abaixo. Sem policy de select, nenhuma linha vaza pelo PostgREST.
alter table public.diligencias_creg enable row level security;
revoke all privileges on table public.diligencias_creg from anon, authenticated;
revoke all privileges on sequence public.diligencias_creg_id_seq from anon, authenticated;

-- ── CREG · Painel do acervo ──────────────────────────────────────────────────
-- Mesma matriz do painel da Câmara: processos parados por faixa de tempo e por
-- unidade. As faixas são as mesmas — quem lê os dois painéis compara sem
-- traduzir — e a definição de "não julgado" também.
--
-- Onde a Câmara mostra o conselheiro no hover, aqui não há o que mostrar: o
-- Conselho não tem de-para de unidades, por decisão de quem as ocupa.
-- O retorno perdeu a coluna `conselheiro` junto com cadeiras_creg; trocar o
-- tipo de retorno exige derrubar a função antes.
--
-- O RECORTE POR DILIGÊNCIA, e por que ele não olha a coluna `julgados`:
--
-- A planilha tem uma coluna JULGADOS que parece marcar o fim da diligência.
-- Não marca. Conferido contra a produção em 22/09/2026: dos 22 processos com
-- JULGADOS vazio que já não estavam pendentes, os 22 tinham sessão POSTERIOR à
-- data da diligência — o processo voltou, foi julgado, e ninguém fechou a
-- coluna. E nenhum dos 6 pendentes tinha JULGADOS preenchido. Nas linhas que
-- este painel enxerga, que são só as pendentes, a coluna não separou um único
-- caso em nenhuma das duas direções. RETORNO é 'SIM' em 100% das 44 linhas.
--
-- Quem sabe que a diligência acabou é o banco: o processo foi julgado — e um
-- processo julgado já não é pendente, então já não está nesta matriz. Daí o
-- recorte não precisar de campo de status nenhum:
--
--     em diligência = pendente E tem diligência com
--                     data_diligencia >= data_distribuicao
--
-- A guarda de data é o que sobra de regra, e ela existe para a REDISTRIBUIÇÃO:
-- um processo que foi a diligência, voltou, foi julgado e depois foi
-- redistribuído volta a ser pendente sem estar em diligência. É a irmã da
-- correlação de datas que o CTE `pendentes` já faz com os julgados.
drop function if exists public.resumo_acervo_creg();
drop function if exists public.resumo_acervo_creg(boolean);
create function public.resumo_acervo_creg(p_diligencia boolean default null)
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
                          and j.data_sessao >= a.data_distribuicao)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),

  -- O recorte vem DEPOIS do distinct on, e não dentro dele. Dentro, uma
  -- distribuição antiga que casasse com o filtro sobreviveria à mais recente
  -- que não casa, e o processo entraria na matriz com a unidade e o tempo
  -- errados — justamente o caso de redistribuição que a guarda de data existe
  -- para tratar.
  --
  -- Mesma expressão, palavra por palavra, em processos_acervo_creg: se as duas
  -- divergirem, a célula abre um número diferente do que mostrava.
  recorte as (
    select p.unidade, p.dias
      from pendentes p
      left join lateral (
        select max(x.data_diligencia) as desde
          from public.diligencias_creg x
         where x.num_processo = p.num_processo
           and x.data_diligencia >= p.data_distribuicao
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

revoke all on function public.resumo_acervo_creg(boolean) from public, anon, service_role;
grant execute on function public.resumo_acervo_creg(boolean) to authenticated;

-- ── CREG · Detalhe de uma célula do painel ───────────────────────────────────
-- O painel conta; esta função lista. Os parâmetros são todos opcionais, e é
-- isso que faz qualquer número da tabela ser clicável com uma consulta só:
--
--   (ordem, unidade) -> a célula      (ordem, null) -> o total da linha
--   (null, unidade)  -> a coluna      (null,  null) -> o acervo pendente
--
-- p_diligencia atravessa os dois: é o recorte que o painel está mostrando, e
-- precisa chegar aqui igual, senão o card abre um número diferente do que a
-- célula clicada trazia.
--
-- A definição de pendente, as faixas e o recorte são os MESMOS de
-- resumo_acervo_creg.
--
-- `diligencia_desde` é a diligência mais recente que ainda vale para esta
-- distribuição — nula quando não há. Com meia dúzia de processos no recorte,
-- uma lista sem essa data não informa nada; e ela sai da mesma consulta que já
-- decide o filtro, sem visita a mais.
drop function if exists public.processos_acervo_creg(int, text);
drop function if exists public.processos_acervo_creg(int, text, boolean);
create function public.processos_acervo_creg(
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
                          and j.data_sessao >= a.data_distribuicao)
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
    ) d on true
   where (p_ordem      is null or f.ordem = p_ordem)
     and (p_unidade    is null or p.unidade = p_unidade)
     and (p_diligencia is null or (d.desde is not null) = p_diligencia)
   order by p.data_distribuicao, p.num_processo;
end;
$$;

revoke all on function public.processos_acervo_creg(int, text, boolean)
  from public, anon, service_role;
grant execute on function public.processos_acervo_creg(int, text, boolean) to authenticated;
