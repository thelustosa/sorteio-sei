-- Banco do Sorteio de Processos SEI (Supabase / PostgreSQL).
-- Rode este script no SQL Editor do projeto Supabase. É o estado final desejado
-- do banco: pode ser aplicado num projeto novo ou por cima do atual (todo
-- comando é "if not exists" / "create or replace").
--
-- Nomes: o Postgres derruba para minúsculas todo identificador sem aspas, então
-- Acervo_CJ e acervo_cj são a mesma tabela. As tabelas ficam em minúsculo para
-- não obrigar aspas em toda consulta.
--
-- Os dois colegiados têm o mesmo desenho, cada um com o seu par de tabelas:
--
--   Câmara de Julgamento (CJ)  -> acervo_cj   + julgados_cj   + pautas_cj
--   Conselho Regulador (CREG)  -> acervo_creg + julgados_creg + pautas_creg
--
-- O que muda entre eles é o vocabulário, não a estrutura: na CJ a coluna de
-- decisão é DEFESA e quem recebe o processo é o RELATOR (cadeira CJ1..CJ5); no
-- CREG a coluna é RECURSO e quem recebe é a UNIDADE (CREG1..CREG4). O CREG
-- ainda calcula META 45 e a divergência em relação à CJ, que a Câmara não tem.

-- ── CREG: a tabela do sorteio antigo ────────────────────────────────────────
-- Até 27/08/2026 o sorteio do Conselho Regulador gravava aqui — uma tabela sem
-- acervo e sem julgados, medida provisória enquanto o CREG não tinha o desenho
-- da Câmara. Agora tem: index.js grava em acervo_creg.
--
-- Ela CONTINUA no schema, e não está vazia: guarda os 81 processos sorteados em
-- 27/08/2026, o último sorteio feito antes da virada. Esses registros foram
-- copiados para acervo_creg (migração 20260828…), e ficam aqui como o que a
-- tela gravou na época. Apagar tabela é decisão de quem opera o banco, não
-- efeito colateral de rodar um schema — e esta ainda é o objeto da migração
-- 20260823165725, que validou a restrição de 15 dígitos sobre o legado.
create table if not exists public.processos_sorteados (
  id                bigint generated always as identity primary key,
  criado_em         timestamptz not null default now(),
  modo              text        not null check (modo = 'CREG'),
  data_hora         timestamptz not null,
  ordem             int         not null,
  num_processo      text        not null,
  assunto           text        not null,
  interessado       text,
  data_distribuicao date        not null,
  recurso           text        not null,
  unidade           text        not null
);

-- Campo livre digitado pela secretaria; sorteios anteriores não o têm, então a
-- coluna nasce anulável em vez de inventar valor para o histórico.
alter table public.processos_sorteados
  add column if not exists interessado text;

-- Criar em duas etapas mantinha a proteção para novas linhas enquanto uma base
-- antiga era conferida; a validação abaixo exige que nenhum legado inválido reste.
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
     -- Desempate: a mesma distribuição em duas cadeiras é legal, e os dois
     -- ramos precisam escolher a MESMA linha, senão o vínculo troca a cada
     -- rederivação. Quem decide é a cadeira que o julgado já tem — é ela que o
     -- coalesce abaixo preserva, e apontar para a linha de outra cadeira seria a
     -- divergência que verificacao_cj.sql acusa. Sem a cadeira informada
     -- (o caso do sincronizador), nenhuma linha é preferida e o critério cai
     -- para o seguinte, como antes.
     order by (relator is not distinct from new.relator) desc, id
     limit 1;
  else
    select * into origem
      from public.acervo_cj
     where num_processo = new.num_processo
       and data_distribuicao <= new.data_sessao
     order by data_distribuicao desc,
              (relator is not distinct from new.relator) desc, id desc
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

-- O interessado saiu da Câmara de Julgamento em 20/08/2026: lá ninguém o
-- consultava e não valia a pena guardar nome de pessoa. No Conselho Regulador
-- ele voltou em 27/08/2026, digitado na tela do sorteio — por isso
-- processos_sorteados não entra nesta limpeza (a coluna é criada acima).
alter table public.acervo_cj   drop column if exists interessado;
alter table public.julgados_cj drop column if exists interessado;

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
   -- Campo VAZIO é ausência de decisão, e é legítimo: processo retirado de
      -- pauta tem status e não tem voto, e a tela promete "preencha o voto OU o
      -- status". Ele passa e grava null. O que se recusa é rótulo PREENCHIDO
      -- fora da lista — daí testar `is not null and not in`, e não coalesce para
      -- '', que barraria também o campo em branco.
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or (nullif(i ->> 'voto', '') is not null
          and nullif(i ->> 'voto', '') not in ('Manter', 'Anular', 'Vista'))
      or (nullif(i ->> 'status', '') is not null
          and nullif(i ->> 'status', '')
              not in ('Julgado', 'Retornou', 'Retirado', 'Vista'));

  if invalido > 0 then
    raise exception 'id, voto ou status fora do permitido (% item(ns))', invalido;
  end if;

  -- Só o que ainda está pendente, ou o que esta mesma página já preencheu antes
  -- (typo se corrige). O histórico que veio da planilha tem atualizado_em nulo
  -- e os dois campos preenchidos: fica intocável por aqui.
  --
  -- Campo em BRANCO não apaga o que já está gravado — daí o coalesce. Branco
  -- quer dizer "ainda não decidi", e a linha do histórico que tem voto e não
  -- tem status entra nesta fila justamente por isso: sem o coalesce, gravar a
  -- sessão inteira levaria o voto antigo junto, e a mesma porta aceitaria um
  -- POST de {"voto":"","status":""} para zerar uma decisão. Trocar um rótulo
  -- por outro continua funcionando; só apagar por aqui é que não.
  --
  -- Isso não tira nada da tela: a opção em branco do select é `disabled`, então
  -- a secretaria nunca pôde voltar um campo ao vazio. DESFAZER um registro é
  -- decisão administrativa, e vai ter porta própria — um painel de admin com
  -- permissão que a secretaria não tem. Enquanto ela não existe, o certo é a
  -- ausência da operação, não um branco que apaga em silêncio.
  update public.julgados_cj j
     set voto           = coalesce(nullif(i ->> 'voto', ''), j.voto),
         status         = coalesce(nullif(i ->> 'status', ''), j.status),
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

-- Supabase concede privilégios amplos às tabelas novas. A RLS sem política já
-- bloqueia linhas, mas os grants também devem expressar que esta tabela é
-- exclusivamente interna às RPCs SECURITY DEFINER.
revoke all privileges on table public.cadeiras_cj from anon, authenticated;

-- ── CJ · Painel do acervo ────────────────────────────────────────────────────
-- A matriz do acervo.html: processos parados por faixa de tempo e por relator.
--
-- O navegador não lê acervo_cj — a tabela só tem política de INSERT. Abrir
-- SELECT nela só para montar o painel entregaria o acervo inteiro ao cliente
-- para ele contar no JavaScript. A agregação fica aqui: a porta continua
-- estreita, o payload é de algumas dezenas de células, e a definição de "não
-- julgado" mora em um lugar só, junto das outras regras.
-- RPC provisória usada pela primeira versão do painel. Não é mais consumida e
-- mantê-la publicada ampliaria a superfície da API sem necessidade.
drop function if exists public.painel_cj_nao_julgados();
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
  --
  -- "Julgado" aqui é julgado DEPOIS de receber esta distribuição
  -- (data_sessao >= data_distribuicao). Sem a correlação de data, um julgado
  -- antigo esconderia para sempre a redistribuição que veio depois dele — o
  -- processo ficaria distribuído e invisível, que é justamente o caso que o
  -- painel existe para mostrar.
  pendentes as (
    select distinct on (a.num_processo)
           a.relator,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao)
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
  -- Pendente é o mesmo de resumo_acervo_cj, correlação de data inclusive.
  pendentes as (
    select distinct on (a.num_processo)
           a.num_processo,
           a.relator,
           a.data_distribuicao,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_cj a
     where not exists (select 1 from public.julgados_cj j
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao)
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

  -- Campo livre digitado na tela do sorteio, e SÓ por ela. O interessado saiu
  -- da Câmara em 20/08/2026 e voltou para o Conselho em 27/08 — aqui a
  -- secretaria o usa para reconhecer o processo na ata. A importação das
  -- planilhas e das atas não o preenche: no histórico ele é nome de pessoa
  -- física em volume, e este repositório é público.
  interessado       text,

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

-- Para o banco que já tinha acervo_creg antes de o interessado voltar.
alter table public.acervo_creg add column if not exists interessado text;

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
     -- Desempate: a mesma distribuição em duas unidades é legal, e os dois
     -- ramos precisam escolher a MESMA linha, senão o vínculo troca a cada
     -- rederivação. Quem decide é a unidade que o julgado já tem — é ela que o
     -- coalesce abaixo preserva, e apontar para a linha de outra unidade seria a
     -- divergência que verificacao_creg.sql acusa. Sem a unidade informada
     -- (o caso do sincronizador), nenhuma linha é preferida e o critério cai
     -- para o seguinte, como antes.
     order by (unidade is not distinct from new.unidade) desc, id
     limit 1;
  else
    select * into origem
      from public.acervo_creg
     where num_processo = new.num_processo
       and data_distribuicao <= new.data_sessao
     order by data_distribuicao desc,
              (unidade is not distinct from new.unidade) desc, id desc
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
   -- Campo VAZIO é ausência de decisão, e é legítimo: processo retirado de
      -- pauta tem status e não tem voto. Recusa-se o rótulo PREENCHIDO fora da
      -- lista, não o campo em branco.
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or (nullif(i ->> 'voto', '') is not null
          and nullif(i ->> 'voto', '') not in
              ('Manter', 'Anular', 'Aprovação', 'Indeferimento', 'Extinção',
               'Retirado', 'Vista'))
      or (nullif(i ->> 'status', '') is not null
          and nullif(i ->> 'status', '') not in
              ('Julgado', 'Retirado', 'Vista', 'Sobrestado', 'Prejudicado'));

  if invalido > 0 then
    raise exception 'id, voto ou status fora do permitido (% item(ns))', invalido;
  end if;

  -- Só o que ainda está pendente, ou o que esta mesma página já preencheu antes
  -- (typo se corrige). O histórico que veio da planilha tem atualizado_em nulo
  -- e os dois campos preenchidos: fica intocável por aqui.
  --
  -- Campo em BRANCO não apaga o que já está gravado — daí o coalesce. Branco
  -- quer dizer "ainda não decidi", e a linha do histórico que tem voto e não
  -- tem status entra nesta fila justamente por isso: sem o coalesce, gravar a
  -- sessão inteira levaria o voto antigo junto, e a mesma porta aceitaria um
  -- POST de {"voto":"","status":""} para zerar uma decisão. Trocar um rótulo
  -- por outro continua funcionando; só apagar por aqui é que não.
  --
  -- Isso não tira nada da tela: a opção em branco do select é `disabled`, então
  -- a secretaria nunca pôde voltar um campo ao vazio. DESFAZER um registro é
  -- decisão administrativa, e vai ter porta própria — um painel de admin com
  -- permissão que a secretaria não tem. Enquanto ela não existe, o certo é a
  -- ausência da operação, não um branco que apaga em silêncio.
  update public.julgados_creg j
     set voto           = coalesce(nullif(i ->> 'voto', ''), j.voto),
         status         = coalesce(nullif(i ->> 'status', ''), j.status),
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
  --
  -- "Julgado" aqui é julgado DEPOIS de receber esta distribuição
  -- (data_sessao >= data_distribuicao). Sem a correlação de data, um julgado
  -- antigo esconderia para sempre a redistribuição que veio depois dele — o
  -- processo ficaria distribuído e invisível, que é justamente o caso que o
  -- painel existe para mostrar.
  pendentes as (
    select distinct on (a.num_processo)
           a.unidade,
           (current_date - a.data_distribuicao) as dias
      from public.acervo_creg a
     where not exists (select 1 from public.julgados_creg j
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao)
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
                        where j.num_processo = a.num_processo
                          and j.data_sessao >= a.data_distribuicao)
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

revoke all on function public.ping() from public, service_role;
grant execute on function public.ping() to anon, authenticated;

