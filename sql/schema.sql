-- Banco do Sorteio de Processos SEI (Supabase / PostgreSQL).
-- Rode este script no SQL Editor do projeto Supabase. É o estado final desejado
-- do banco: pode ser aplicado num projeto novo ou por cima do atual (todo
-- comando é "if not exists" / "create or replace").
--
-- Nomes: o Postgres derruba para minúsculas todo identificador sem aspas, então
-- Acervo_CJ e acervo_cj são a mesma tabela. As tabelas ficam em minúsculo para
-- não obrigar aspas em toda consulta.
--
-- Câmara de Julgamento (CJ) -> acervo_cj + julgados_cj  (implementado aqui)
-- Conselho Regulador (CREG) -> processos_sorteados      (ainda a migrar)

-- ── CREG: tabela antiga, agora exclusiva do Conselho Regulador ───────────────
-- Uma linha por processo sorteado. Enquanto CREG não ganhar as tabelas
-- acervo_creg/julgados_creg, o sorteio do Conselho Regulador continua aqui.
create table if not exists public.processos_sorteados (
  id                bigint generated always as identity primary key,
  criado_em         timestamptz not null default now(),
  modo              text        not null check (modo = 'CREG'),
  data_hora         timestamptz not null,
  ordem             int         not null,
  num_processo      text        not null,
  assunto           text        not null,
  data_distribuicao date        not null,
  recurso           text        not null,
  unidade           text        not null
);

-- Criar em duas etapas mantém a proteção para novas linhas enquanto uma base
-- antiga é conferida; a validação abaixo exige que nenhum legado inválido reste.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.processos_sorteados'::regclass
       and conname = 'processos_sorteados_num_processo_15_digitos'
  ) then
    alter table public.processos_sorteados
      add constraint processos_sorteados_num_processo_15_digitos
      check (num_processo ~ '^[0-9]{15}$') not valid;
  end if;
end
$$;

alter table public.processos_sorteados
  validate constraint processos_sorteados_num_processo_15_digitos;

create index if not exists idx_processos_sorteados_modo_data
  on public.processos_sorteados (modo, data_hora desc);

-- A API devolve 409 quando o mesmo processo é reenviado para a mesma unidade
-- no mesmo dia. Em base já populada, confira antes o ERRO correspondente em
-- verificacao_cj.sql: o índice recusa duplicatas existentes em vez de apagar
-- ou escolher uma delas sem decisão humana.
create unique index if not exists ux_processos_sorteados_distribuicao
  on public.processos_sorteados
  (modo, num_processo, data_distribuicao, unidade);

-- ── CJ · Acervo ──────────────────────────────────────────────────────────────
-- Uma linha por DISTRIBUIÇÃO de um processo a um relator — não uma linha por
-- processo. Um processo redistribuído aparece mais de uma vez, com datas e
-- relatores diferentes, e é assim que a planilha da CJ sempre funcionou.
--
-- Origem dos dados:
--   sorteio  -> gravado pelo sorteador (index.js) ao final de um sorteio CJ;
--   planilha -> importado do histórico da aba Acervo (dados/importar_planilha.py).
--
-- Colunas que só uma das origens preenche ficam nulas na outra: a planilha não
-- registra ordem. Em relator vai a CADEIRA (CJ1..CJ5) nas duas origens: o
-- sorteio grava a cadeira e a importação traduz o nome da planilha pela tabela
-- cadeiras_cj antes de inserir. Quem é o conselheiro sai do de-para, não daqui
-- (ver "CJ · Quem ocupa cada cadeira", abaixo).
create table if not exists public.acervo_cj (
  id                bigint generated always as identity primary key,
  num_processo      text        not null,
  relator           text        not null,
  data_distribuicao date        not null,
  defesa            boolean,
  assunto           text        not null default 'Auto de Infração',
  ordem             int,

  -- Legado: enquanto a CJ dividia a tabela com o CREG, o sorteio gravava
  -- "recurso" no lugar de "defesa". Só a migração preenche esta coluna, com o
  -- valor cru daquela época — reinterpretá-lo como defesa seria inventar dado.
  recurso           text,

  sorteado_em       timestamptz,
  origem            text        not null default 'sorteio'
                    check (origem in ('sorteio', 'planilha')),
  criado_em         timestamptz not null default now(),

  -- Reexecutar um sorteio ou uma importação não duplica o acervo. É também o
  -- índice que a busca do processo usa (num_processo é o prefixo da chave).
  constraint acervo_cj_distribuicao_unica
    unique (num_processo, data_distribuicao, relator)
);

-- ── CJ · Julgados ────────────────────────────────────────────────────────────
-- Uma linha por processo levado a uma sessão de julgamento.
--
-- Informado na sessão: num_processo, data_sessao, pauta, voto, status.
-- Derivado do acervo pelo gatilho abaixo: acervo_id, relator, defesa e
-- data_distribuicao — o equivalente às fórmulas da aba Julgados.
-- Calculado pelo próprio banco: dias_dt e periodo_dt.
--
-- relator/defesa/data_distribuicao são cópia, não referência: registram o
-- estado do processo no momento do julgamento. Uma redistribuição posterior
-- muda o acervo e não pode reescrever o que já foi julgado.
create table if not exists public.julgados_cj (
  id                bigint generated always as identity primary key,
  acervo_id         bigint      references public.acervo_cj (id),
  num_processo      text        not null,
  data_sessao       date        not null,
  pauta             int,
  voto              text,
  status            text,
  defesa            boolean,
  relator           text,
  data_distribuicao date,

  -- "Dias DT" da planilha: =-I+D, dias entre a distribuição e a sessão.
  dias_dt int generated always as (data_sessao - data_distribuicao) stored,

  -- "Per DT" da planilha: trimestre da sessão (1T24), e <AA antes de 2023.
  -- A planilha resolvia isso com um IF aninhado ano a ano; aqui o trimestre é
  -- calculado, então 2027 em diante já funciona sozinho.
  periodo_dt text generated always as (
    case
      when extract(year from data_sessao) < 2023
        then '<' || lpad((extract(year from data_sessao)::int % 100)::text, 2, '0')
      else ((extract(month from data_sessao)::int - 1) / 3 + 1)::text
           || 'T' || lpad((extract(year from data_sessao)::int % 100)::text, 2, '0')
    end
  ) stored,

  criado_em timestamptz not null default now(),

  -- Um processo não é julgado duas vezes na mesma sessão. Reimportar a aba
  -- Julgados não duplica.
  constraint julgados_cj_sessao_unica unique (num_processo, data_sessao)
);

create index if not exists idx_julgados_cj_acervo on public.julgados_cj (acervo_id);

-- Numeração da pauta: cuidado ao usar em relatório.
--
-- Até 2025 a coluna guarda o número interno da Câmara, que conta PAUTAS
-- EMITIDAS — ele pula números quando uma sessão é cancelada (2025 não tem
-- 26, 33, 39, 48, 49 nem 51) e por isso corre à frente da numeração oficial da
-- AGR, que conta REUNIÕES REALIZADAS: a diferença chega a +3 em 2024 e +5 em
-- 2025. De 2026 em diante a sincronização grava o número da AGR, e naquele ano
-- os dois coincidem.
--
-- Ou seja: pauta é referência interna e muda de significado conforme o ano.
-- Para agrupar sessões, use data_sessao, que confere com a listagem oficial da
-- AGR em 100% das sessões de 2024, 2025 e 2026. Ver FLUXO-CJ.md.
comment on column public.julgados_cj.pauta is
  'Número da reunião. Até 2025 é a numeração interna da CJ (conta pautas '
  'emitidas, pula canceladas); de 2026 em diante é a numeração da AGR. '
  'Para agrupar sessões use data_sessao.';

-- ── CJ · Pautas publicadas pela AGR ──────────────────────────────────────────
-- Um registro por documento de pauta já processado pela sincronização
-- (sincronizacao/sincronizar.py). Serve para duas coisas: não reprocessar o
-- mesmo PDF e deixar rastro do que cada documento gerou.
--
-- A URL é a identidade do documento. O sha256 não entra na chave porque a AGR
-- republica pautas corrigidas em URLs novas (…-1.pdf); ele serve para saber, na
-- auditoria, se dois registros têm o mesmo conteúdo.
--
-- Sem política de RLS: esta tabela não é lida nem escrita pelo navegador. Quem
-- escreve é o job de sincronização, que se conecta direto ao banco.
create table if not exists public.pautas_cj (
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

create index if not exists idx_pautas_cj_sessao on public.pautas_cj (data_sessao desc);

-- Uma linha desta tabela pode não ser um documento: existe um marco com url
-- 'marco:inicio-da-serie'. Seu corte canônico é 18/06/2026, anterior ao
-- reinício operacional, e diz à sincronização a partir de quando começar.
-- Relatórios que contem documentos devem filtrar por url like 'https://%'.
insert into public.pautas_cj (url, titulo, numero, data_sessao, sha256)
values ('marco:inicio-da-serie', 'Início da série', 0, date '2026-06-18', 'marco')
on conflict (url) do update
set titulo = excluded.titulo,
    numero = excluded.numero,
    data_sessao = excluded.data_sessao,
    sha256 = excluded.sha256;

alter table public.pautas_cj enable row level security;

-- ── CJ · Preenchimento automático a partir do acervo ─────────────────────────
-- É a tradução das fórmulas da aba Julgados. Na planilha:
--
--   Relator   =INDEX(Acervo!B; MATCH(Processo; Acervo!A; 0))   -> 1a distribuição
--   Defesa    =INDEX(Acervo!D; MATCH(Processo; Acervo!A; 0))   -> 1a distribuição
--   Data DIST =AGGREGATE(14;6; Acervo!C/(Acervo!A=Processo);1) -> MAIOR data
--
-- As três discordam entre si quando o processo foi redistribuído: duas olham a
-- primeira distribuição e uma olha a última. Aqui as três saem do MESMO
-- registro do acervo, escolhido pela regra que preserva o histórico: a última
-- distribuição ocorrida ATÉ a data da sessão — o relator que de fato levou o
-- processo à mesa. Redistribuição posterior ao julgamento não contamina o
-- registro (é o caso que a planilha só acerta por acidente, porque as fórmulas
-- ficaram com intervalos desatualizados).
--
-- Ordem de resolução:
--   1. data_distribuicao informada -> somente o registro exato; se não existir,
--      o julgado fica sem vínculo para não apontar a uma distribuição diferente;
--   2. sem data informada -> a última distribuição até a data da sessão;
--   3. ainda sem resultado -> a distribuição mais antiga (equivale ao
--      INDEX/MATCH da planilha quando a única distribuição é posterior à sessão).
--
-- Valor informado sempre vence o derivado: a aba Julgados tem 1.122 linhas com
-- Defesa digitada à mão, e importar não pode sobrescrevê-las. Para forçar a
-- rederivação de um campo, basta gravar null nele.
--
-- Processo fora do acervo não é erro: acervo_id fica nulo e os campos derivados
-- continuam como vieram — a planilha devolvia "Não encontrado" no lugar.
create or replace function public.julgados_cj_derivar_do_acervo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origem public.acervo_cj%rowtype;
begin
  if new.data_distribuicao is not null then
    select * into origem
      from public.acervo_cj
     where num_processo = new.num_processo
       and data_distribuicao = new.data_distribuicao
     order by id
     limit 1;
  else
    select * into origem
      from public.acervo_cj
     where num_processo = new.num_processo
       and data_distribuicao <= new.data_sessao
     order by data_distribuicao desc, id desc
     limit 1;
    if origem.id is null then
      select * into origem
        from public.acervo_cj
       where num_processo = new.num_processo
       order by data_distribuicao, id
       limit 1;
    end if;
  end if;

  new.acervo_id         := origem.id;
  new.relator           := coalesce(new.relator, origem.relator);
  new.defesa            := coalesce(new.defesa, origem.defesa);
  new.data_distribuicao := coalesce(new.data_distribuicao, origem.data_distribuicao);
  return new;
end;
$$;

revoke all on function public.julgados_cj_derivar_do_acervo()
  from public, anon, authenticated;

drop trigger if exists julgados_cj_derivar on public.julgados_cj;
create trigger julgados_cj_derivar
  before insert or update of num_processo, data_sessao, relator, defesa,
                             data_distribuicao
  on public.julgados_cj
  for each row execute function public.julgados_cj_derivar_do_acervo();

-- ── CJ · Registro do voto e do status pela secretaria ────────────────────────
-- A pauta é convocação: chega do site da AGR sem voto e sem status, porque as
-- duas coisas só existem depois da sessão. Quem preenche é a secretaria, na
-- página julgados.html.
--
-- Isso abre, pela primeira vez, LEITURA para o navegador — só dela, e só desta
-- tabela. A escrita continua fechada: não existe política de UPDATE em
-- julgados_cj. Quem grava é a função registrar_votos abaixo, que só encosta em
-- voto e status, recusa valor fora da lista e deixa registrado quem preencheu.
alter table public.julgados_cj
  add column if not exists atualizado_em  timestamptz,
  add column if not exists atualizado_por text;

-- O interessado saiu do sistema em 20/08/2026: deixou de ser usado e não vale a
-- pena guardar nome de pessoa num registro que ninguém consulta. Em banco novo
-- as tabelas acima já nascem sem ele; aqui a coluna cai de quem já existia.
alter table public.processos_sorteados drop column if exists interessado;
alter table public.acervo_cj           drop column if exists interessado;
alter table public.julgados_cj         drop column if exists interessado;

-- Os pendentes são poucos no meio de milhares de julgados: índice parcial, do
-- tamanho da fila de trabalho e não da tabela.
create index if not exists idx_julgados_cj_pendentes
  on public.julgados_cj (data_sessao desc, pauta)
  where voto is null or status is null;

-- Quem preencheu. Fica isolado numa função para o banco de teste conseguir
-- substituir: em produção é o e-mail do JWT que o Supabase publica.
create or replace function public.auth_email()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
$$;

revoke all on function public.auth_email() from public, anon, authenticated;

-- Rótulos aceitos. Não viraram CHECK na tabela de propósito: a planilha
-- histórica tem valores que a CJ pode querer estender, e não há tela de
-- administração para isso. Aqui eles valem como validação de entrada do
-- navegador, que é uma fronteira de confiança.
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
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or nullif(i ->> 'voto', '')   not in ('Manter', 'Anular', 'Vista')
      or nullif(i ->> 'status', '') not in ('Julgado', 'Retornou', 'Retirado', 'Vista');

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

-- ── CJ · Quem ocupa cada cadeira ─────────────────────────────────────────────
-- acervo_cj.relator guarda a CADEIRA (CJ1..CJ5), não o nome. A cadeira é
-- estável: quando a composição da Câmara mudar, o processo distribuído em 2026
-- continua tendo sido da CJ3 daquele período, e este de-para resolve quem era.
-- Guardar o nome na linha congelaria a pessoa e faria a troca de composição
-- reescrever a história.
--
-- Por isso a tabela é por PERÍODO: composição nova entra como linha nova, com
-- `ate` fechando a anterior — nunca como UPDATE.
create table if not exists public.cadeiras_cj (
  cadeira     text not null check (cadeira ~ '^CJ[1-9][0-9]*$'),
  conselheiro text not null check (length(trim(conselheiro)) > 0),
  desde       date not null,
  ate         date,
  constraint cadeiras_cj_periodo_valido check (ate is null or ate >= desde),
  primary key (cadeira, desde)
);

-- Uma cadeira tem, no máximo, um período em aberto. A chave primária não
-- impede duas linhas com `ate` nulo, e duas ocupações vigentes multiplicariam
-- cada célula do painel pelo join do de-para — o painel passaria a contar o
-- dobro sem nenhum erro aparecer.
create unique index if not exists ux_cadeiras_cj_vigente
  on public.cadeiras_cj (cadeira) where ate is null;

-- Composição da Resolução Normativa nº 333/2026-CR, a que assina as atas de
-- sorteio 010 a 014/2026.
insert into public.cadeiras_cj (cadeira, conselheiro, desde) values
  ('CJ1', 'Paulo Otoni Ribeiro',             date '2026-01-01'),
  ('CJ2', 'Deusdete Cardoso Belém',          date '2026-01-01'),
  ('CJ3', 'Dorivan de Souza Lima',           date '2026-01-01'),
  ('CJ4', 'Paulo Henrique Oliveira Marques', date '2026-01-01'),
  ('CJ5', 'Lorena Patricia de Oliveira',     date '2026-01-01')
on conflict (cadeira, desde) do update set conselheiro = excluded.conselheiro;

-- Sem política de RLS: o navegador não lê esta tabela direto. Quem traduz
-- cadeira em nome é a função do painel, que é SECURITY DEFINER.
alter table public.cadeiras_cj enable row level security;

-- ── CJ · Painel do acervo ────────────────────────────────────────────────────
-- A matriz do acervo.html: processos parados por faixa de tempo e por relator.
--
-- O navegador não lê acervo_cj — a tabela só tem política de INSERT. Abrir
-- SELECT nela só para montar o painel entregaria o acervo inteiro ao cliente
-- para ele contar no JavaScript. A agregação fica aqui: a porta continua
-- estreita, o payload é de algumas dezenas de células, e a definição de "não
-- julgado" mora em um lugar só, junto das outras regras.
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

  -- Uma linha por PROCESSO, não por distribuição: um processo redistribuído
  -- conta uma vez só, na cadeira e na data da distribuição mais recente.
  --
  -- "Não julgado" = não aparece em julgados_cj. Quem foi à mesa e voltou sem
  -- decisão (Retornou, Vista, Retirado) sai do painel — tem fila própria, que é
  -- a tela de registro. Para contá-los aqui, acrescente
  -- `and j.status = 'Julgado'` ao not exists.
  pendentes as (
    select distinct on (a.num_processo)
           a.relator,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo)
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),

  -- Todo relator do acervo vira coluna, mesmo sem processo parado: coluna que
  -- aparece e some conforme o dado muda faz a tabela dançar de um dia para o
  -- outro. É também o que faz o painel seguir a composição da Câmara sem
  -- precisar de lista fixa no HTML.
  relatores as (select distinct acervo_cj.relator from public.acervo_cj)

  -- A tela mostra a cadeira e revela o conselheiro no hover. As duas saem da
  -- mesma consulta para que o front não precise repetir o de-para.
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

-- ── CJ · Detalhe de uma célula do painel ─────────────────────────────────────
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
-- A definição de pendente e as faixas são as MESMAS de resumo_acervo_cj. Se as
-- duas divergirem, o card abre um número diferente do que o bloco mostrava —
-- há um teste comparando célula a célula justamente por isso.
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

-- ── Segurança (RLS) ──────────────────────────────────────────────────────────
-- Duas camadas de proteção, iguais para as três tabelas:
--
-- 1. Somente INSERT. O site acrescenta registros, mas não pode ler, alterar nem
--    apagar um sorteio já gravado. Consultas e relatórios são feitos pelo painel
--    do Supabase, nunca pelo navegador.
-- 2. Somente autenticado. A chave publicável fica visível no index.js (o
--    repositório é aberto para auditoria), então ela sozinha não basta: é preciso
--    ter feito login com um usuário cadastrado em Authentication → Users.
--
-- IMPORTANTE: com esta política, é obrigatório desativar o cadastro público em
-- Authentication → Providers → Email → "Enable sign ups". Caso contrário qualquer
-- visitante criaria a própria conta e passaria a poder inserir.
--
-- O gatilho acima é SECURITY DEFINER justamente por causa da regra 1: ele
-- precisa LER o acervo para derivar os campos, e quem insere não tem esse
-- direito.
alter table public.processos_sorteados enable row level security;
alter table public.acervo_cj           enable row level security;
alter table public.julgados_cj         enable row level security;

drop policy if exists "front pode inserir" on public.processos_sorteados;
drop policy if exists "usuario autenticado pode inserir" on public.processos_sorteados;
create policy "usuario autenticado pode inserir"
  on public.processos_sorteados for insert to authenticated with check (true);

drop policy if exists "usuario autenticado pode inserir" on public.acervo_cj;
create policy "usuario autenticado pode inserir"
  on public.acervo_cj for insert to authenticated with check (true);

-- julgados_cj é a única tabela que o navegador lê, e ele só lê: a página
-- julgados.html precisa listar os pendentes. Gravar voto e status é feito pela
-- função registrar_votos, não por UPDATE direto. Inserir julgado é trabalho do
-- job de sincronização, que se conecta direto ao banco.
drop policy if exists "usuario autenticado pode inserir" on public.julgados_cj;
drop policy if exists "usuario autenticado pode ler" on public.julgados_cj;
create policy "usuario autenticado pode ler"
  on public.julgados_cj for select to authenticated using (true);

-- O Supabase concede privilégios amplos aos papéis da API por padrão. RLS ainda
-- bloquearia as linhas, mas os grants abaixo repetem o mesmo mínimo como segunda
-- camada e deixam o schema idêntico num Postgres comum.
revoke all privileges on table public.processos_sorteados, public.acervo_cj,
                               public.julgados_cj, public.pautas_cj
  from anon, authenticated;
revoke all privileges on sequence public.processos_sorteados_id_seq,
                                  public.acervo_cj_id_seq,
                                  public.julgados_cj_id_seq,
                                  public.pautas_cj_id_seq
  from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant insert on public.processos_sorteados to authenticated;
grant insert on public.acervo_cj           to authenticated;
grant select on public.julgados_cj         to authenticated;
grant usage on sequence public.processos_sorteados_id_seq,
                        public.acervo_cj_id_seq
  to authenticated;

-- ── Monitoramento / Keep-Alive (UptimeRobot / Health Check) ──────────────────
-- Função leve sem efeitos colaterais (STABLE) que permite requisições HEAD/GET
-- anônimas via RPC (/rest/v1/rpc/ping). Usada por serviços de monitoramento
-- para registrar atividade no banco e evitar o auto-pause do plano gratuito.
create or replace function public.ping()
returns text
language sql
stable
set search_path = ''
as $$
  select 'pong'
$$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

