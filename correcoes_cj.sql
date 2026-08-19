-- Correções pontuais nos dados históricos da Câmara de Julgamento.
--
-- Os dois blocos abaixo são INDEPENDENTES e OPCIONAIS. Cada um está numa
-- transação com conferência: se o resultado não for o esperado, nada é gravado.
-- Rode um de cada vez, no SQL Editor do Supabase, e confira o retorno.
--
-- Antes e depois, rode o verificacao_cj.sql para comparar.
--
-- Ambas as correções mexem em registro histórico. Leia a justificativa de cada
-- uma antes de executar: elas foram apuradas contra a fonte oficial da AGR, mas
-- a decisão de aplicar é da secretaria.


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Pauta 17 de 2026: 24 processos com data de sessão errada
-- ═════════════════════════════════════════════════════════════════════════════
--
-- O problema: as 24 linhas da 17ª reunião de 2026 têm datas que avançam um dia
-- a cada linha, de 28/05 a 20/06/2026 — incluindo sete sábados e domingos, em
-- que a Câmara não se reúne. É arrastão de célula no Excel: a coluna de data
-- foi preenchida arrastando, e o Excel incrementou o dia.
--
-- A prova: a listagem oficial da AGR publica a 17ª Reunião Pública da Câmara de
-- Julgamento de 2026 em 28/05/2026 (auta-17a-RP-CJ-28.05.2026.pdf). É a única
-- data real dessa reunião.
--
-- Conferido antes: as 24 linhas são de 24 processos distintos e nenhuma colide
-- com o que já está gravado em 28/05, então a chave única não é violada.
--
-- O que muda: data_sessao das 23 linhas erradas. Por tabela, dias_dt é
-- recalculado sozinho e o vínculo com o acervo é reavaliado pelo gatilho.

begin;

update public.julgados_cj
   set data_sessao = date '2026-05-28'
 where pauta = 17
   and extract(year from data_sessao) = 2026
   and data_sessao <> date '2026-05-28';

do $$
declare
  espalhadas int;
  fds        int;
begin
  select count(distinct data_sessao) into espalhadas
    from public.julgados_cj
   where pauta = 17 and extract(year from data_sessao) = 2026;

  select count(*) into fds
    from public.julgados_cj
   where extract(isodow from data_sessao) in (6, 7);

  if espalhadas <> 1 then
    raise exception 'A 17ª reunião de 2026 ficou com % datas; esperado 1. Desfeito.', espalhadas;
  end if;
  if fds > 0 then
    raise exception 'Ainda restam % sessões em fim de semana. Desfeito.', fds;
  end if;

  raise notice 'Pauta 17/2026 consolidada em 28/05/2026.';
end;
$$;

commit;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Processos julgados "antes" de serem distribuídos
-- ═════════════════════════════════════════════════════════════════════════════
--
-- O problema: 33 julgados têm dias_dt negativo, ou seja, data de distribuição
-- posterior à data da sessão. É consequência direta de uma fórmula da planilha:
-- a coluna "Data DIST" usava AGGREGATE(14;6;…;1), que devolve a MAIOR data de
-- distribuição do processo. Quando o processo foi redistribuído depois de
-- julgado, a planilha trazia a redistribuição — e não a distribuição que valia
-- no dia da sessão.
--
-- A correção: apagar a data importada nesses casos e deixar o gatilho rederivar
-- pela regra do sistema — a última distribuição ocorrida ATÉ a data da sessão.
-- Junto com a data, o gatilho reacerta relator, defesa e o vínculo com o
-- acervo, todos passando a sair do mesmo registro.
--
-- Só entram as linhas em que existe uma distribuição anterior à sessão. Sobra 1
-- caso sem solução possível: o processo tem uma única distribuição registrada, e
-- ela é posterior ao julgamento. Esse fica como está — o dado que falta é a
-- distribuição original, que nunca foi registrada.

begin;

update public.julgados_cj j
   set data_distribuicao = null,
       relator           = null,
       defesa            = null
 where j.dias_dt < 0
   and exists (select 1
                 from public.acervo_cj a
                where a.num_processo = j.num_processo
                  and a.data_distribuicao <= j.data_sessao);

do $$
declare
  restantes int;
  orfaos    int;
begin
  select count(*) into restantes from public.julgados_cj where dias_dt < 0;
  select count(*) into orfaos    from public.julgados_cj where acervo_id is null;

  if restantes > 1 then
    raise exception 'Ainda restam % julgados com dias_dt negativo; esperado no máximo 1. Desfeito.', restantes;
  end if;
  if orfaos > 0 then
    raise exception '% julgados perderam o vínculo com o acervo. Desfeito.', orfaos;
  end if;

  raise notice 'Distribuições rederivadas. Restou % caso sem distribuição anterior à sessão.', restantes;
end;
$$;

commit;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Pautas 13 e 14 de 2025 trocadas entre si
-- ═════════════════════════════════════════════════════════════════════════════
--
-- O problema: a sessão de 25/03/2025 está como 14ª e a de 27/03/2025 como 13ª.
-- A de 25 vem antes da de 27, então o número menor tem que ser o da primeira.
--
-- A prova não depende da AGR: em 2024, 2025 e 2026 a numeração da pauta só
-- cresce com o tempo, e este é um dos dois únicos pontos em que ela anda para
-- trás. Trocando as duas, a sequência de março volta a ser 12 → 13 → 14 → 15.
-- (A listagem da AGR concorda, mas aqui ela é só confirmação.)
--
-- Isto NÃO é renumerar o histórico para seguir a AGR — decisão que a secretaria
-- tomou de não fazer. É consertar dois valores que trocaram de lugar entre si.
--
-- O que muda: só a coluna pauta de 70 linhas (30 + 40). Nenhuma data é tocada,
-- então a chave única de julgados_cj não é afetada.

begin;

update public.julgados_cj
   set pauta = case data_sessao
                 when date '2025-03-25' then 13
                 when date '2025-03-27' then 14
               end
 where data_sessao in (date '2025-03-25', date '2025-03-27');

do $$
declare
  recuos int;
begin
  -- Depois da troca, a numeração só pode andar para trás no caso de outubro,
  -- que fica em aberto de propósito (ver FLUXO-CJ.md).
  with sessoes as (
    select distinct extract(year from data_sessao)::int as ano, data_sessao, pauta
      from public.julgados_cj where pauta is not null
  ), pares as (
    select ano, data_sessao, pauta,
           lag(pauta) over (partition by ano order by data_sessao) as anterior
      from sessoes
  )
  select count(*) into recuos from pares where pauta < anterior;

  if recuos <> 1 then
    raise exception 'A numeração anda para trás em % pontos; esperado 1. Desfeito.', recuos;
  end if;

  raise notice 'Pautas 13 e 14 de 2025 destrocadas. Março volta a ser 12-13-14-15.';
end;
$$;

commit;
