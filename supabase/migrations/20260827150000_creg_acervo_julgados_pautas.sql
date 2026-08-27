-- Conselho Regulador: acervo, julgados, pautas e de-para de unidades.
--
-- Espelha o desenho da Câmara de Julgamento para o segundo colegiado. Até aqui
-- o sorteio do CREG gravava em processos_sorteados, uma tabela sem acervo e sem
-- julgados; a partir desta migração ele grava em acervo_creg, e de lá saem os
-- julgados pelo mesmo gatilho, o mesmo painel e a mesma sincronização com as
-- pautas da AGR.
--
-- processos_sorteados NÃO é derrubada: estava vazia, mas apagar tabela é
-- decisão de quem opera o banco, e ela é o objeto da migração 20260823165725.
--
-- Este arquivo é o recorte do sql/schema.sql, que continua sendo o estado final
-- desejado do banco. Todo comando é "if not exists" / "create or replace":
-- aplicar duas vezes não faz diferença.

-- ── CREG · Acervo ────────────────────────────────────────────────────────────
-- Uma linha por DISTRIBUIÇÃO de um processo a uma unidade (CREG1..CREG4) — não
-- uma linha por processo. É a tradução das quatro planilhas de gabinete
-- (CREG1.xlsx … CREG4.xlsx), que juntas formam o acervo do Conselho.
--
-- Na planilha a unidade era descoberta por acidente de arquivo: as fórmulas da
-- aba Página procuravam o processo em [2]Planilha1, depois [3], [4] e [5], e a
-- coluna "Unidade CREG" recebia 1, 2, 3 ou 4 conforme onde tivesse achado.
-- Aqui a unidade é dado, não descoberta.
--
-- Diferenças em relação ao acervo da Câmara de Julgamento:
--   • assunto é variado (Auto de Infração, Requerimento, Chamamento Público…),
--     enquanto a CJ só julga auto de infração;
--   • a coluna de decisão é RECURSO (Com recurso / Sem recurso / Não se aplica /
--     Ad Referendum / Reexame Necessário), não defesa.
--
-- Origem dos dados:
--   sorteio  -> gravado pelo sorteador (index.js) ao final de um sorteio CREG;
--   planilha -> importado das planilhas de gabinete (dados/importar_creg.py);
--   ata      -> lido do PDF da ata de sorteio publicada no SEI
--               (dados/importar_atas_creg.py). É o sorteio que aconteceu antes
--               de o sistema existir: mesma procedência de 'sorteio', outro
--               caminho até aqui, e a auditoria precisa distinguir os dois.
create table if not exists public.acervo_creg (
  id                bigint generated always as identity primary key,
  num_processo      text        not null check (num_processo ~ '^[0-9]{15}$'),
  unidade           text        not null check (unidade ~ '^CREG[1-9][0-9]*$'),
  data_distribuicao date        not null,
  assunto           text,
  recurso           text,
  ordem             int,
  sorteado_em       timestamptz,
  origem            text        not null default 'sorteio'
                    check (origem in ('sorteio', 'planilha', 'ata')),
  criado_em         timestamptz not null default now(),

  -- Reexecutar um sorteio ou uma importação não duplica o acervo. É também o
  -- índice que a busca do processo usa (num_processo é o prefixo da chave).
  constraint acervo_creg_distribuicao_unica
    unique (num_processo, data_distribuicao, unidade)
);

-- ── CREG · Julgados ──────────────────────────────────────────────────────────
-- Uma linha por processo levado a uma sessão do Conselho. É a aba "Página
-- 20XX" da planilha, com cada fórmula virando ou um gatilho ou uma coluna
-- calculada.
--
-- Informado na sessão: num_processo, data_sessao, pauta, voto, status.
-- Derivado do acervo pelo gatilho abaixo: acervo_id, unidade, assunto, recurso
-- e data_distribuicao — o equivalente ao INDEX/MATCH em cascata da planilha.
-- Copiado do histórico da CJ na importação: defesa, data_dist_cj, relator_cj e
-- voto_cj (colunas L, M, N e O da planilha, preenchidas em 73% das linhas).
--
-- Por que a CJ vira cópia e não join: a produção de julgados_cj começa em
-- jun/2026 — o histórico anterior foi arquivado quando a série da Câmara
-- reiniciou. Um join cobriria só os julgados recentes do CREG e deixaria
-- 2023-2025 vazio, justamente o período em que a planilha tinha o dado.
create table if not exists public.julgados_creg (
  id                bigint generated always as identity primary key,
  acervo_id         bigint      references public.acervo_creg (id),
  num_processo      text        not null check (num_processo ~ '^[0-9]{15}$'),
  data_sessao       date        not null,
  pauta             int,
  voto              text,
  status            text,

  -- Cópia do acervo, não referência: registram o estado do processo no momento
  -- do julgamento. Uma redistribuição posterior muda o acervo e não pode
  -- reescrever o que já foi julgado.
  unidade           text,
  data_distribuicao date,
  assunto           text,
  recurso           text,

  -- Cópia do que a Câmara de Julgamento decidiu antes, quando decidiu.
  defesa            boolean,
  data_dist_cj      date,
  relator_cj        text,
  voto_cj           text,

  -- "DIAS DIST SS/CR" da planilha: =-Q+T, da distribuição no CREG à sessão.
  dias_dt int generated always as (data_sessao - data_distribuicao) stored,

  -- "META 45": a distribuição levou até 45 dias para chegar à mesa.
  -- A expressão repete dias_dt porque o Postgres não deixa uma coluna gerada
  -- referenciar outra.
  --
  -- Sessão anterior à distribuição fica NULA, não "dentro". A planilha dizia
  -- DENTRO nesses casos, porque -41 <= 45 é verdade, e com isso 10 registros
  -- inconsistentes engordavam o indicador. Quando as duas datas estão
  -- invertidas a meta não é aferível, e nulo é o que diz isso; a conferência os
  -- lista à parte, no AVISO "Sessão anterior à distribuição".
  meta_45 boolean generated always as (
    case when data_sessao >= data_distribuicao
         then (data_sessao - data_distribuicao) <= 45
    end
  ) stored,

  -- "DIAS DIST CR/CJ" da planilha: =-M+Q, quanto o processo levou entre sair
  -- da Câmara e ser distribuído no Conselho.
  dias_dist_cr_cj int generated always as
    (data_distribuicao - data_dist_cj) stored,

  -- "Per DT CR": trimestre da sessão (1T24), e <AA antes de 2023. A planilha
  -- resolvia com um IF aninhado que precisava ser estendido a cada ano — a
  -- versão de 2023 parava em 4T25 e teve de ganhar 2026 à mão. Calculado, 2027
  -- em diante já funciona sozinho.
  periodo_dt text generated always as (
    case
      when extract(year from data_sessao) < 2023
        then '<' || lpad((extract(year from data_sessao)::int % 100)::text, 2, '0')
      else ((extract(month from data_sessao)::int - 1) / 3 + 1)::text
           || 'T' || lpad((extract(year from data_sessao)::int % 100)::text, 2, '0')
    end
  ) stored,

  -- "Em relação à CJ": o Conselho decidiu diferente da Câmara.
  --
  -- A fórmula original zerava a comparação numa lista de casos em que ela não
  -- faz sentido — processo retirado, ou decisão que não é sobre o mérito do
  -- auto (Aprovação, Indeferir, Arquivamento) — e chamava de "Divergente-Não
  -- Revel" o caso em que a CJ tinha anulado e o CREG não.
  em_relacao_cj text generated always as (
    case
      when voto is null or voto_cj is null then null
      when status = 'Retirado' then null
      when voto in ('Retirado', 'Aprovação', 'Indeferimento', 'Arquivamento') then null
      when voto_cj = voto then null
      when voto_cj = 'Anular' then 'Divergente-Não Revel'
      else 'Divergente'
    end
  ) stored,

  atualizado_em  timestamptz,
  atualizado_por text,
  criado_em      timestamptz not null default now(),

  -- Um processo não é julgado duas vezes na mesma sessão. Reimportar não
  -- duplica.
  constraint julgados_creg_sessao_unica unique (num_processo, data_sessao)
);

create index if not exists idx_julgados_creg_acervo
  on public.julgados_creg (acervo_id);

-- Os pendentes são poucos no meio de milhares de julgados: índice parcial, do
-- tamanho da fila de trabalho e não da tabela.
create index if not exists idx_julgados_creg_pendentes
  on public.julgados_creg (data_sessao desc, pauta)
  where voto is null or status is null;

-- Mesma armadilha da Câmara, e pior: o número da pauta da planilha (numeração
-- interna, que conta pautas emitidas) diverge do número publicado pela AGR em
-- 121 das 132 sessões conferidas. Para agrupar sessões, use data_sessao.
comment on column public.julgados_creg.pauta is
  'Número da sessão. O histórico importado traz a numeração interna do CREG, '
  'que diverge da numeração da AGR em 121 das 132 sessões de 2023-2026; da '
  'sincronização em diante é o número da AGR. Para agrupar sessões use '
  'data_sessao.';

-- ── CREG · Pautas publicadas pela AGR ────────────────────────────────────────
-- Um registro por documento de pauta já processado pela sincronização. Mesmo
-- papel de pautas_cj: não reprocessar o mesmo PDF e deixar rastro.
--
-- O CREG publica em outra página (pautas-das-sessoes-do-conselho-regulador-ANO)
-- e com outro padrão de nome de arquivo (SEI-<processo>.pdf), mas o formato do
-- documento é o mesmo e o parser de sincronizacao/pauta.py roda sem alteração.
--
-- processos_encontrados pode ser 0 sem que isso seja erro: sessão especial não
-- leva processo (a 1ª Especial de 03/07/2026, por exemplo).
create table if not exists public.pautas_creg (
  id                    bigint generated always as identity primary key,
  url                   text        not null unique,
  titulo                text,
  numero                int         not null,
  data_sessao           date        not null,
  sha256                text        not null,
  processos_encontrados int         not null default 0,
  processos_importados  int         not null default 0,
  processos_sem_acervo  text[]      not null default '{}',
  processado_em         timestamptz not null default now()
);

create index if not exists idx_pautas_creg_sessao
  on public.pautas_creg (data_sessao desc);

-- O marco diz à sincronização a partir de quando começar. Como em pautas_cj,
-- ele não é um documento: url 'marco:inicio-da-serie'. Relatórios que contam
-- documentos devem filtrar por url like 'https://%'.
--
-- 30/06/2026 é o corte porque o histórico importado das planilhas termina em
-- 17/07/2026 e a AGR publicou três sessões que ele não alcança: a 1ª Especial
-- (03/07, sem processos), a 14ª (05/08) e a 15ª (19/08). Voltar até 30/06 faz a
-- sincronização cobrir as três e reconciliar a de 17/07 — reprocessar uma
-- sessão já importada não duplica nada, e a passagem grava em pautas_creg o
-- número que a AGR usa, que não é o da planilha.
insert into public.pautas_creg (url, titulo, numero, data_sessao, sha256)
values ('marco:inicio-da-serie', 'Início da série', 0, date '2026-06-30', 'marco')
on conflict (url) do update
set titulo = excluded.titulo,
    numero = excluded.numero,
    data_sessao = excluded.data_sessao,
    sha256 = excluded.sha256;

alter table public.pautas_creg enable row level security;

-- ── CREG · Por que não existe um de-para de unidades ─────────────────────────
-- A Câmara tem cadeiras_cj, que traduz CJ1..CJ5 no nome do conselheiro. O
-- Conselho Regulador NÃO tem o equivalente, e isso é decisão de quem ocupa as
-- unidades: os responsáveis por CREG1..CREG4 não querem os nomes vinculados aos
-- processos. Pedido atendido em 27/08/2026 — a tabela foi removida.
--
-- Consequência prática: o painel do CREG mostra CREG1..CREG4 e nada além disso.
-- Quem for reintroduzir um de-para aqui precisa de autorização das unidades,
-- não só de uma migração.
do $$
begin
  if to_regclass('public.cadeiras_creg') is not null then
    execute 'drop table public.cadeiras_creg';
  end if;
end
$$;

-- ── CREG · Preenchimento automático a partir do acervo ───────────────────────
-- É a tradução do INDEX/MATCH em cascata da aba Página. Na planilha:
--
--   Assunto      =INDEX([2..5]Planilha1!D; MATCH(Processo; …!B; 0))
--   DT DIST CR   =INDEX([2..5]Planilha1!E; MATCH(Processo; …!B; 0))
--   Recurso      "Com recurso"->Sim, "Sem recurso"->Não, senão n/a
--   Unidade CREG 1..4 conforme em qual dos quatro arquivos achou
--
-- As quatro olhavam a PRIMEIRA ocorrência do processo, na ordem dos arquivos —
-- o que dá a resposta errada quando o processo foi redistribuído. Aqui as
-- quatro saem do MESMO registro do acervo, escolhido pela regra que preserva o
-- histórico: a última distribuição ocorrida ATÉ a data da sessão.
--
-- Ordem de resolução (idêntica à da Câmara, em julgados_cj_derivar_do_acervo):
--   1. data_distribuicao informada -> somente o registro exato;
--   2. sem data informada -> a última distribuição até a data da sessão;
--   3. ainda sem resultado -> a distribuição mais antiga.
--
-- Valor informado sempre vence o derivado — importar não sobrescreve o que a
-- planilha registrou à mão. Para forçar a rederivação, grave null no campo.
--
-- Processo fora do acervo não é erro: são 1.329 no histórico, julgados antes de
-- as planilhas de gabinete existirem. acervo_id fica nulo e o resto continua
-- como veio; a planilha devolvia "" no lugar.
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
     order by id
     limit 1;
  else
    select * into origem
      from public.acervo_creg
     where num_processo = new.num_processo
       and data_distribuicao <= new.data_sessao
     order by data_distribuicao desc, id desc
     limit 1;
    if origem.id is null then
      select * into origem
        from public.acervo_creg
       where num_processo = new.num_processo
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

revoke all on function public.julgados_creg_derivar_do_acervo()
  from public, anon, authenticated;

drop trigger if exists julgados_creg_derivar on public.julgados_creg;
create trigger julgados_creg_derivar
  before insert or update of num_processo, data_sessao, unidade, assunto,
                             recurso, data_distribuicao
  on public.julgados_creg
  for each row execute function public.julgados_creg_derivar_do_acervo();

-- ── CREG · Registro do voto e do status pela secretaria ──────────────────────
-- Mesma porta estreita da Câmara: a escrita não é UPDATE direto, é esta função,
-- que só encosta em voto e status, recusa valor fora da lista e registra quem
-- preencheu.
--
-- A lista é curta de propósito. O histórico da planilha tem 23 grafias de voto
-- ("Aprovação"/"Aprovado"/"Apovação", "Indeferir"/"Indeferimento") — a
-- importação normaliza o que tem equivalente e preserva o que não tem; daqui em
-- diante só entram os rótulos abaixo.
create or replace function public.registrar_votos_creg(itens jsonb)
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

  if jsonb_typeof(itens) is distinct from 'array' then
    raise exception 'registrar_votos_creg espera uma lista de itens';
  end if;

  select count(*) into invalido
    from jsonb_array_elements(itens) i
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or coalesce(nullif(i ->> 'voto', ''), '') not in
         ('Manter', 'Anular', 'Aprovação', 'Indeferimento', 'Extinção',
          'Retirado', 'Vista')
      or coalesce(nullif(i ->> 'status', ''), '') not in
         ('Julgado', 'Retirado', 'Vista', 'Sobrestado', 'Prejudicado');

  if invalido > 0 then
    raise exception 'id, voto ou status fora do permitido (% item(ns))', invalido;
  end if;

  -- Só o que ainda está pendente, ou o que esta mesma página já preencheu antes
  -- (typo se corrige). O histórico que veio da planilha tem atualizado_em nulo
  -- e os dois campos preenchidos: fica intocável por aqui.
  update public.julgados_creg j
     set voto           = nullif(i ->> 'voto', ''),
         status         = nullif(i ->> 'status', ''),
         atualizado_em  = now(),
         atualizado_por = quem
    from jsonb_array_elements(itens) i
   where j.id = (i ->> 'id')::bigint
     and (j.voto is null or j.status is null or j.atualizado_em is not null);

  get diagnostics gravados = row_count;
  return gravados;
end;
$$;

revoke all on function public.registrar_votos_creg(jsonb)
  from public, anon, service_role;
grant execute on function public.registrar_votos_creg(jsonb) to authenticated;

-- ── CREG · Painel do acervo ──────────────────────────────────────────────────
-- Mesma matriz do painel da Câmara: processos parados por faixa de tempo e por
-- unidade. As faixas são as mesmas — quem lê os dois painéis compara sem
-- traduzir — e a definição de "não julgado" também.
--
-- Onde a Câmara mostra o conselheiro no hover, aqui não há o que mostrar: o
-- Conselho não tem de-para de unidades, por decisão de quem as ocupa.
-- O retorno perdeu a coluna `conselheiro` junto com cadeiras_creg; trocar o
-- tipo de retorno exige derrubar a função antes.
drop function if exists public.resumo_acervo_creg();
create function public.resumo_acervo_creg()
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
  -- conta uma vez só, na unidade e na data da distribuição mais recente.
  pendentes as (
    select distinct on (a.num_processo)
           a.unidade,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_creg a
     where not exists (select 1 from public.julgados_creg j
                        where j.num_processo = a.num_processo)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),

  unidades as (select distinct acervo_creg.unidade from public.acervo_creg)

  select f.ordem,
         f.faixa,
         u.unidade,
         count(p.unidade)::int
    from faixas f
   cross join unidades u
    left join pendentes p
           on p.unidade = u.unidade
          and p.dias between f.de and f.ate
   group by f.ordem, f.faixa, u.unidade
   order by f.ordem, u.unidade;
end;
$$;

revoke all on function public.resumo_acervo_creg() from public, anon, service_role;
grant execute on function public.resumo_acervo_creg() to authenticated;

-- ── CREG · Detalhe de uma célula do painel ───────────────────────────────────
-- O painel conta; esta função lista. Os dois parâmetros são opcionais, e é isso
-- que faz qualquer número da tabela ser clicável com uma consulta só:
--
--   (ordem, unidade) -> a célula      (ordem, null) -> o total da linha
--   (null, unidade)  -> a coluna      (null,  null) -> o acervo pendente
--
-- A definição de pendente e as faixas são as MESMAS de resumo_acervo_creg.
drop function if exists public.processos_acervo_creg(int, text);
create function public.processos_acervo_creg(
  p_ordem   int  default null,
  p_unidade text default null
)
returns table (
  num_processo      text,
  unidade           text,
  assunto           text,
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
  pendentes as (
    select distinct on (a.num_processo)
           a.num_processo,
           a.unidade,
           a.assunto,
           a.data_distribuicao,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_creg a
     where not exists (select 1 from public.julgados_creg j
                        where j.num_processo = a.num_processo)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  )
  select p.num_processo,
         p.unidade,
         p.assunto,
         p.data_distribuicao,
         p.dias
    from pendentes p
    join faixas f on p.dias between f.de and f.ate
   where (p_ordem   is null or f.ordem   = p_ordem)
     and (p_unidade is null or p.unidade = p_unidade)
   order by p.data_distribuicao, p.num_processo;
end;
$$;

revoke all on function public.processos_acervo_creg(int, text)
  from public, anon, service_role;
grant execute on function public.processos_acervo_creg(int, text) to authenticated;

-- ── CREG · Segurança (RLS) ───────────────────────────────────────────────────
-- Mesma divisão da Câmara: o navegador insere no acervo, lê os julgados para
-- montar a fila de registro, e não faz mais nada. Quem grava voto e status é
-- registrar_votos_creg; quem insere julgado é o job de sincronização, que se
-- conecta direto ao banco.
alter table public.acervo_creg   enable row level security;
alter table public.julgados_creg enable row level security;

drop policy if exists "usuario autenticado pode inserir" on public.acervo_creg;
create policy "usuario autenticado pode inserir"
  on public.acervo_creg for insert to authenticated with check (true);

drop policy if exists "usuario autenticado pode ler" on public.julgados_creg;
create policy "usuario autenticado pode ler"
  on public.julgados_creg for select to authenticated using (true);

revoke all privileges on table public.acervo_creg, public.julgados_creg,
                               public.pautas_creg
  from anon, authenticated;
revoke all privileges on sequence public.acervo_creg_id_seq,
                                  public.julgados_creg_id_seq,
                                  public.pautas_creg_id_seq
  from anon, authenticated;

grant insert on public.acervo_creg   to authenticated;
grant select on public.julgados_creg to authenticated;
grant usage  on sequence public.acervo_creg_id_seq to authenticated;

-- ── CJ · Correção de registrar_votos ─────────────────────────────────────────
-- Mesmo defeito que o CREG já nasceu sem: item sem voto ou sem status produzia
-- NULL, `NULL not in (...)` é NULL, e o item escapava da contagem de inválidos
-- para depois APAGAR o campo no UPDATE. Com coalesce para '', ele cai fora da
-- lista e é recusado.
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

  if jsonb_typeof(itens) is distinct from 'array' then
    raise exception 'registrar_votos espera uma lista de itens';
  end if;

  select count(*) into invalido
    from jsonb_array_elements(itens) i
   -- coalesce, e não nullif sozinho: item sem voto ou sem status produz NULL,
      -- e `NULL not in (...)` é NULL — o item escapava da contagem, passava pelo
      -- UPDATE e APAGAVA o campo. Com '' no lugar, ele cai fora da lista e é
      -- recusado, que é o que "fora do permitido" sempre quis dizer.
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or coalesce(nullif(i ->> 'voto', ''), '')
         not in ('Manter', 'Anular', 'Vista')
      or coalesce(nullif(i ->> 'status', ''), '')
         not in ('Julgado', 'Retornou', 'Retirado', 'Vista');

  if invalido > 0 then
    raise exception 'id, voto ou status fora do permitido (% item(ns))', invalido;
  end if;

  -- Só o que ainda está pendente, ou o que esta mesma página já preencheu antes
  -- (typo se corrige). O histórico que veio da planilha tem atualizado_em nulo
  -- e os dois campos preenchidos: fica intocável por aqui.
  update public.julgados_cj j
     set voto           = nullif(i ->> 'voto', ''),
         status         = nullif(i ->> 'status', ''),
         atualizado_em  = now(),
         atualizado_por = quem
    from jsonb_array_elements(itens) i
   where j.id = (i ->> 'id')::bigint
     and (j.voto is null or j.status is null or j.atualizado_em is not null);

  get diagnostics gravados = row_count;
  return gravados;
end;
$$;

revoke all on function public.registrar_votos(jsonb) from public, anon, service_role;
grant execute on function public.registrar_votos(jsonb) to authenticated;
