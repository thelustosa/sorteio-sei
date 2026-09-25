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
create table if not exists public.permissoes_usuario (
  user_id uuid not null references auth.users(id) on delete cascade,
  orgao text not null check (orgao in ('CJ', 'CREG')),
  primary key (user_id, orgao)
);

alter table public.permissoes_usuario enable row level security;

drop policy if exists "usuario le as proprias permissoes"
  on public.permissoes_usuario;
create policy "usuario le as proprias permissoes"
  on public.permissoes_usuario for select to authenticated
  using (user_id = (select auth.uid()));

revoke all privileges on table public.permissoes_usuario
  from anon, authenticated;
grant select on public.permissoes_usuario to authenticated;

create or replace function public.tem_acesso_orgao(p_orgao text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.permissoes_usuario p
     where p.user_id = (select auth.uid())
       and p.orgao = p_orgao
  )
$$;

create or replace function public.orgaos_autorizados()
returns table (orgao text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.orgao
    from public.permissoes_usuario p
   where p.user_id = (select auth.uid())
   order by p.orgao
$$;

revoke all on function public.tem_acesso_orgao(text)
  from public, anon, service_role;
revoke all on function public.orgaos_autorizados()
  from public, anon, service_role;
grant execute on function public.tem_acesso_orgao(text) to authenticated;
grant execute on function public.orgaos_autorizados() to authenticated;

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
  -- 'ata': distribuição lida do PDF da ata de sorteio, sem passar pela tela.
  origem            text        not null default 'sorteio'
                    check (origem in ('sorteio', 'planilha', 'ata')),
  criado_em         timestamptz not null default now(),
  criado_por        text,

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

-- "META 45": a mesma coluna de julgados_creg, com a mesma regra, para o painel
-- administrativo contar os dois colegiados do mesmo jeito. Sessão anterior à
-- distribuição, ou julgado sem data de distribuição, fica NULO: o prazo não é
-- aferível, e contá-lo como "dentro" engordava o indicador da planilha do
-- Conselho (ver julgados_creg.meta_45). Chega por ALTER porque a tabela já
-- existe em produção.
alter table public.julgados_cj
  add column if not exists meta_45 boolean generated always as (
    case when data_sessao >= data_distribuicao
         then (data_sessao - data_distribuicao) <= 45
    end
  ) stored;

-- Número SEI: 15 dígitos, só dígitos — a regra que acervo_creg e julgados_creg
-- têm no CREATE TABLE. Na Câmara ela chega por ALTER porque as tabelas nasceram
-- antes dela, e o drop/add mantém o script reaplicável. O navegador já barrava,
-- mas acervo_cj aceita INSERT direto de quem tem acesso à CJ: só o banco fecha
-- essa porta.
--
-- relator fica sem restrição de formato de propósito: o histórico em backup_cj
-- e a importação da planilha guardam pelo nome quem não está em cadeiras_cj.
alter table public.acervo_cj
  drop constraint if exists acervo_cj_num_processo_check;
alter table public.acervo_cj
  add constraint acervo_cj_num_processo_check check (num_processo ~ '^[0-9]{15}$');

alter table public.julgados_cj
  drop constraint if exists julgados_cj_num_processo_check;
alter table public.julgados_cj
  add constraint julgados_cj_num_processo_check check (num_processo ~ '^[0-9]{15}$');

-- Origem 'ata', como no Conselho: sem ela, a carga das atas entrava como
-- 'sorteio' e aparecia no histórico como rodada feita na tela (migração
-- 20260917123135). Repetido aqui porque o CREATE TABLE acima não altera tabela
-- que já existe.
alter table public.acervo_cj
  drop constraint if exists acervo_cj_origem_check;
alter table public.acervo_cj
  add constraint acervo_cj_origem_check check (origem in ('sorteio', 'planilha', 'ata'));

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
-- página julgados-cj.html.
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
-- ele voltou em 27/08/2026, digitado na tela do sorteio — por isso a limpeza é
-- só das duas tabelas da Câmara, e acervo_creg mantém a coluna.
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

  if not (select public.tem_acesso_orgao('CJ')) then
    raise exception 'acesso ao orgao CJ nao autorizado' using errcode = '42501';
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
          and nullif(i ->> 'voto', '') not in ('Manter', 'Anular', 'Retirado', 'Vista'))
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
  -- Trava em ordem de id antes de comparar e atualizar. Duas transações
  -- concorrentes não podem validar a mesma fotografia e sobrescrever decisões.
  perform j.id from public.julgados_cj j
    where j.id in (select (i ->> 'id')::bigint from jsonb_array_elements(itens) i)
    order by j.id for update;

  if exists (
    select 1 from public.julgados_cj j
    join jsonb_array_elements(itens) i on j.id = (i ->> 'id')::bigint
    cross join (values ('voto'), ('status')) c(campo)
    where (j.voto is null or j.status is null or j.atualizado_em is not null)
      and nullif(i ->> c.campo, '') is not null
      and nullif(i ->> c.campo, '') is distinct from (to_jsonb(j) ->> c.campo)
      and (
        -- Clientes antigos podem preencher vazios, mas não substituir uma
        -- decisão sem informar o valor anterior. Reenvio idêntico é seguro.
        (not coalesce((i -> 'anterior') ? c.campo, false)
          and (to_jsonb(j) ->> c.campo) is not null)
        or (coalesce((i -> 'anterior') ? c.campo, false)
          and nullif(i -> 'anterior' ->> c.campo, '')
              is distinct from (to_jsonb(j) ->> c.campo))
      )
  ) then
    raise exception 'Este julgamento foi alterado por outra pessoa. Suas escolhas foram preservadas; atualize a página para conferir os valores atuais antes de salvar.'
      using errcode = '40001';
  end if;

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
-- A matriz do acervo-cj.html: processos parados por faixa de tempo e por relator.
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

  if not (select public.tem_acesso_orgao('CJ')) then
    raise exception 'acesso ao orgao CJ nao autorizado' using errcode = '42501';
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

  -- Toda cadeira vigente vira coluna, mesmo sem processo parado: coluna que
  -- aparece e some conforme o dado muda faz a tabela dançar de um dia para o
  -- outro. É também o que faz o painel seguir a composição da Câmara sem
  -- precisar de lista fixa no HTML. Relator fora das cadeiras vigentes só
  -- aparece se tiver processo parado — senão o histórico de 2023 a 2025, gravado
  -- pelo nome, viraria uma fileira de colunas zeradas.
  relatores as (select c.cadeira as relator from public.cadeiras_cj c where c.ate is null
                union
                select pendentes.relator from pendentes)

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

  if not (select public.tem_acesso_orgao('CJ')) then
    raise exception 'acesso ao orgao CJ nao autorizado' using errcode = '42501';
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
-- Duas camadas de proteção, iguais para as tabelas da Câmara:
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
alter table public.acervo_cj   enable row level security;
alter table public.julgados_cj enable row level security;

drop policy if exists "usuario autenticado pode inserir" on public.acervo_cj;
drop policy if exists "usuario com acesso cj pode inserir" on public.acervo_cj;
create policy "usuario com acesso cj pode inserir"
  on public.acervo_cj for insert to authenticated
  with check ((select public.tem_acesso_orgao('CJ')));

-- julgados_cj é a única tabela que o navegador lê, e ele só lê: a página
-- julgados-cj.html precisa listar os pendentes. Gravar voto e status é feito pela
-- função registrar_votos, não por UPDATE direto. Inserir julgado é trabalho do
-- job de sincronização, que se conecta direto ao banco.
drop policy if exists "usuario autenticado pode inserir" on public.julgados_cj;
drop policy if exists "usuario autenticado pode ler" on public.julgados_cj;
drop policy if exists "usuario com acesso cj pode ler" on public.julgados_cj;
create policy "usuario com acesso cj pode ler"
  on public.julgados_cj for select to authenticated
  using ((select public.tem_acesso_orgao('CJ')));

-- O Supabase concede privilégios amplos aos papéis da API por padrão. RLS ainda
-- bloquearia as linhas, mas os grants abaixo repetem o mesmo mínimo como segunda
-- camada e deixam o schema idêntico num Postgres comum.
revoke all privileges on table public.acervo_cj, public.julgados_cj,
                               public.pautas_cj
  from anon, authenticated;
revoke all privileges on sequence public.acervo_cj_id_seq,
                                  public.julgados_cj_id_seq,
                                  public.pautas_cj_id_seq
  from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant insert on public.acervo_cj   to authenticated;
grant select on public.julgados_cj to authenticated;
grant usage on sequence public.acervo_cj_id_seq to authenticated;

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
  criado_por        text,

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
      when voto_cj = 'Retirado' then null
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

  if not (select public.tem_acesso_orgao('CREG')) then
    raise exception 'acesso ao orgao CREG nao autorizado' using errcode = '42501';
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
  -- Trava em ordem de id antes de comparar e atualizar. Duas transações
  -- concorrentes não podem validar a mesma fotografia e sobrescrever decisões.
  perform j.id from public.julgados_creg j
    where j.id in (select (i ->> 'id')::bigint from jsonb_array_elements(itens) i)
    order by j.id for update;

  if exists (
    select 1 from public.julgados_creg j
    join jsonb_array_elements(itens) i on j.id = (i ->> 'id')::bigint
    cross join (values ('voto'), ('status')) c(campo)
    where (j.voto is null or j.status is null or j.atualizado_em is not null)
      and nullif(i ->> c.campo, '') is not null
      and nullif(i ->> c.campo, '') is distinct from (to_jsonb(j) ->> c.campo)
      and (
        -- Clientes antigos podem preencher vazios, mas não substituir uma
        -- decisão sem informar o valor anterior. Reenvio idêntico é seguro.
        (not coalesce((i -> 'anterior') ? c.campo, false)
          and (to_jsonb(j) ->> c.campo) is not null)
        or (coalesce((i -> 'anterior') ? c.campo, false)
          and nullif(i -> 'anterior' ->> c.campo, '')
              is distinct from (to_jsonb(j) ->> c.campo))
      )
  ) then
    raise exception 'Este julgamento foi alterado por outra pessoa. Suas escolhas foram preservadas; atualize a página para conferir os valores atuais antes de salvar.'
      using errcode = '40001';
  end if;

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
--
-- O RECORTE POR DILIGÊNCIA:
--
--     RETORNO = NÃO  -> a diligência está aberta, o processo está fora
--     RETORNO = SIM  -> o processo voltou
--
-- Confirmado com a secretaria em 22/09/2026. Na planilha a linha encerrada
-- também fica tachada e com o SIM em verde, mas o recorte NÃO lê formatação: o
-- `?output=csv` que a sincronização consome não transporta tachado nem cor, e
-- regra que depende de formatação muda de significado num copiar-colar.
--
--     em diligência = pendente no acervo
--                     E tem diligência com RETORNO = NÃO
--                        e data_diligencia >= data_distribuicao
--
-- Não é "pendente e com diligência registrada": um processo que foi a
-- diligência, VOLTOU e ainda não foi julgado estaria aguardando pauta, não
-- fora com a área técnica. Foi assim que a primeira versão errou.
--
-- A guarda de data existe para a REDISTRIBUIÇÃO: um processo que foi a
-- diligência, voltou, foi julgado e depois foi redistribuído volta a ser
-- pendente sem estar em diligência. É a irmã da correlação de datas que o CTE
-- `pendentes` já faz com os julgados.
--
-- Vazio não conta como aberta. A convenção é explícita, então célula em branco
-- é linha que ninguém preencheu — o recorte prefere não mostrar nada a mostrar
-- um processo que já voltou.
-- Derruba também a assinatura anterior: este arquivo é reaplicável e uma
-- base criada antes do recorte ainda pode tê-la. Deixá-la ao lado da nova,
-- cujo argumento tem default, torna a chamada sem argumentos ambígua.
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
  -- A subconsulta lateral é a MESMA, palavra por palavra, de
  -- processos_acervo_creg: se as duas divergirem, a célula abre um número
  -- diferente do que mostrava. O translate normaliza a digitação à mão —
  -- 'NÃO', 'NAO', 'não' e 'Não' são a mesma resposta.
  recorte as (
    select p.unidade, p.dias
      from pendentes p
      left join lateral (
        select max(x.data_diligencia) as desde
          from public.diligencias_creg x
         where x.num_processo = p.num_processo
           and x.data_diligencia >= p.data_distribuicao
           and translate(upper(btrim(coalesce(x.retorno, ''))), 'ÃÁÀÂ', 'AAAA') = 'NAO'
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
-- `diligencia_desde` é a data da diligência ABERTA mais recente que ainda vale
-- para esta distribuição — nula quando não há nenhuma aberta. Com o recorte
-- ligado ela nunca é nula; sem o recorte, ela é o que distingue, na lista
-- inteira, quem está fora de quem só aguarda pauta.
-- Mesma limpeza da assinatura legada de dois argumentos; a migração inicial
-- já fazia isso, e o schema completo precisa manter a mesma propriedade.
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
         and translate(upper(btrim(coalesce(x.retorno, ''))), 'ÃÁÀÂ', 'AAAA') = 'NAO'
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

-- ── CREG · Segurança (RLS) ───────────────────────────────────────────────────
-- Mesma divisão da Câmara: o navegador insere no acervo, lê os julgados para
-- montar a fila de registro, e não faz mais nada. Quem grava voto e status é
-- registrar_votos_creg; quem insere julgado é o job de sincronização, que se
-- conecta direto ao banco.
alter table public.acervo_creg   enable row level security;
alter table public.julgados_creg enable row level security;

drop policy if exists "usuario autenticado pode inserir" on public.acervo_creg;
drop policy if exists "usuario com acesso creg pode inserir" on public.acervo_creg;
create policy "usuario com acesso creg pode inserir"
  on public.acervo_creg for insert to authenticated
  with check ((select public.tem_acesso_orgao('CREG')));

drop policy if exists "usuario autenticado pode ler" on public.julgados_creg;
drop policy if exists "usuario com acesso creg pode ler" on public.julgados_creg;
create policy "usuario com acesso creg pode ler"
  on public.julgados_creg for select to authenticated
  using ((select public.tem_acesso_orgao('CREG')));

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

-- ── Histórico de sorteios ────────────────────────────────────────────────────
-- O que alimenta historico-cj.html e historico-creg.html: as rodadas de sorteio
-- já realizadas, uma tela por colegiado, como o painel do acervo.
--
-- Um SORTEIO é o lote que a tela gravou de uma vez: as linhas do acervo que
-- compartilham (data_distribuicao, sorteado_em). index.js usa um só instante
-- para o lote inteiro — ver "Um só instante para o sorteio inteiro" lá —, então
-- o carimbo já identifica a rodada e o histórico não precisa de tabela nova nem
-- de escrever coisa alguma: consultar não pode mexer no que está gravado.
--
-- O carimbo pode faltar, e por isso a chave é o PAR (data, carimbo) e não o
-- carimbo sozinho: as quatro rodadas da Câmara de 2026 entraram num lote só, em
-- 21/08/2026, sem `sorteado_em`. Nelas quem data o sorteio é a distribuição, e
-- a tela mostra a rodada sem horário em vez de inventar um.
--
-- ONDE O HISTÓRICO COMEÇA: em `origem = 'sorteio'`, e a partir do marco abaixo.
-- É o recorte do que o SISTEMA distribuiu, que é o que esta tela promete.
--
--   • 'planilha' fica de fora — acervo herdado das planilhas de gabinete, que
--     nunca foi um evento de sorteio; listá-lo inventaria rodadas que não houve
--     (são 3.064 linhas no CREG, contra 81 de sorteio).
--   • 'ata' também fica de fora — sorteio de verdade, mas anterior ao sistema e
--     conhecido só pelo PDF publicado no SEI.
--
-- A primeira versão de historico_sorteios não tinha parâmetro: servia os dois
-- colegiados na mesma lista. `create or replace` não muda a assinatura de uma
-- função, então a antiga precisa sair antes da nova entrar.
drop function if exists public.historico_sorteios();

create or replace function public.historico_marco()
returns date
language sql
immutable
set search_path = ''
as $$
  -- 27/08/2026: o dia do primeiro sorteio feito na tela — os 81 processos do
  -- Conselho Regulador que processos_sorteados gravou e que hoje vivem em
  -- acervo_creg (migração 20260828…). Aquela tabela provisória vai ser
  -- removida, e por isso o histórico lê o acervo, nunca ela.
  --
  -- O MESMO corte vale para os dois colegiados, de propósito: a série começa no
  -- mesmo dia para a Câmara e para o Conselho. As quatro rodadas da Câmara de
  -- 2026 (29/06 a 14/08) ficam de fora — entraram no acervo num lote só, em
  -- 21/08, sem carimbo de hora, e são anteriores ao marco. A Câmara começa com
  -- o histórico vazio e o preenche no próximo sorteio.
  --
  -- Mora numa função, e não repetido nas duas consultas, porque corte escrito
  -- em dois lugares é corte que vai divergir. Ninguém a executa pela API: as
  -- duas funções do histórico são SECURITY DEFINER e a chamam como dono.
  select date '2026-08-27'
$$;

revoke all on function public.historico_marco() from public, anon, authenticated, service_role;

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

  if not (select public.tem_acesso_orgao(p_colegiado)) then
    raise exception 'acesso ao orgao % nao autorizado', p_colegiado using errcode = '42501';
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

-- ── Os processos de um sorteio ───────────────────────────────────────────────
-- A lista que o histórico abre ao clicar numa rodada. Mesma razão de
-- processos_acervo_cj existir: os dois acervos são fechados ao navegador, e
-- abrir SELECT neles só para montar esta tela entregaria o acervo inteiro ao
-- cliente.
--
-- Uma função para os dois colegiados, com o vocabulário traduzido aqui: o que
-- na Câmara é relator/defesa e no Conselho é unidade/recurso sai como
-- destino/decisao. Sem essa tradução, a tela precisaria de dois caminhos para
-- desenhar a mesma tabela.
--
-- O recorte é o MESMO da lista, marco inclusive. Se os dois divergirem, o card
-- vira uma porta lateral para rodadas que a lista não mostra.
--
-- `is not distinct from` e não `=`: o carimbo de uma rodada pode ser nulo, e um
-- `=` com nulo devolveria lista vazia justamente para ela.
create or replace function public.processos_sorteio(
  p_colegiado   text,
  p_data        date,
  p_sorteado_em timestamptz default null
)
returns table (
  ordem        int,
  num_processo text,
  destino      text,
  responsavel  text,
  assunto      text,
  decisao      text,
  interessado  text
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

  if not (select public.tem_acesso_orgao(p_colegiado)) then
    raise exception 'acesso ao orgao % nao autorizado', p_colegiado using errcode = '42501';
  end if;

  return query
  select a.ordem,
         a.num_processo,
         a.relator,
         -- O ocupante da cadeira NA DATA do sorteio, não o de hoje: histórico
         -- que reescreve o relator a cada mudança de composição deixa de ser
         -- histórico. Cadeira sem de-para no período sai pelo próprio rótulo.
         coalesce(c.conselheiro, a.relator),
         a.assunto,
         -- Na Câmara a coluna é a DEFESA, booleana. O texto em `recurso` é o
         -- legado da época em que a CJ dividia a tabela com o Conselho: sai
         -- como está, porque relê-lo como defesa inventaria a decisão. E
         -- defesa nula tem de cair nesse legado, não virar 'Não'.
         case when a.defesa is null then a.recurso
              when a.defesa        then 'Sim'
              else 'Não' end,
         null::text
    from public.acervo_cj a
    -- Uma cadeira pode ter mais de um período cobrindo a mesma data: a chave
    -- primária é (cadeira, desde) e o índice único só cobre o período EM
    -- ABERTO, então dois intervalos fechados que se sobrepõem entram sem erro
    -- nenhum. Num join comum, cada processo daquela cadeira sairia repetido —
    -- na lista do card e na ata exportada, que a lista alimenta.
    --
    -- O lateral devolve no máximo uma linha, sempre: o período que começou por
    -- último até a data do sorteio, que é o que vigorava nela.
    left join lateral (
      select cc.conselheiro
        from public.cadeiras_cj cc
       where cc.cadeira = a.relator
         and a.data_distribuicao >= cc.desde
         and (cc.ate is null or a.data_distribuicao <= cc.ate)
       order by cc.desde desc
       limit 1
    ) c on true
   where p_colegiado = 'CJ'
     and a.data_distribuicao = p_data
     and a.sorteado_em is not distinct from p_sorteado_em
     and a.origem = 'sorteio'
     and a.data_distribuicao >= marco
   union all
  select b.ordem, b.num_processo, b.unidade, null::text,
         b.assunto, b.recurso, b.interessado
    from public.acervo_creg b
   where p_colegiado = 'CREG'
     and b.data_distribuicao = p_data
     and b.sorteado_em is not distinct from p_sorteado_em
     and b.origem = 'sorteio'
     and b.data_distribuicao >= marco
   -- A ordem do sorteio é a da ata. Linha sem ordem — gravação que não a
   -- registrou — vai para o fim, com o número do processo como desempate
   -- estável.
   order by 1 nulls last, 2;
end;
$$;

revoke all on function public.processos_sorteio(text, date, timestamptz)
  from public, anon, service_role;
grant execute on function public.processos_sorteio(text, date, timestamptz) to authenticated;

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

-- ── Painel administrativo ────────────────────────────────────────────────────
-- A porta que registrar_votos e registrar_votos_creg anunciaram quando
-- explicaram por que o campo em branco não apaga uma decisão gravada:
--
--   "DESFAZER um registro é decisão administrativa, e vai ter porta própria —
--    um painel de admin com permissão que a secretaria não tem."
--
-- É ela. Até aqui o navegador só INSERIA no acervo e só LIA os julgados; a
-- única escrita era aquela função, que toca voto e status e nunca apaga. Tudo
-- o mais exigia SQL direto no banco por uma identidade privilegiada.
--
-- Três decisões moldam o que vem abaixo:
--
--   1. as tabelas continuam FECHADAS ao PostgREST — não há policy de UPDATE
--      nem de DELETE em lugar nenhum. Toda alteração passa por uma função
--      nomeada, com allowlist de campos e validação própria;
--   2. a INTENÇÃO mora no nome da função, não num parâmetro. corrigir_acervo
--      propaga aos julgados; redistribuir não. Fossem a mesma função com um
--      booleano, o rastro não saberia dizer o que o administrador declarou;
--   3. nada é silencioso. O gatilho de derivação mexe em acervo_id por baixo
--      de algumas correções, e a função devolve isso ao chamador em vez de
--      deixar a divergência aparecer depois em verificacao_cj.sql.

-- ── Papel do usuário ─────────────────────────────────────────────────────────
-- Uma coluna, e não uma tabela nova. A chave primária (user_id, orgao) não
-- muda, e as linhas existentes nascem 'operador': migrar não promove ninguém.
--
-- tem_acesso_orgao() continua idêntica — qualquer papel dá acesso ao órgão —,
-- então todas as policies e RPCs anteriores seguem valendo sem alteração. O
-- papel só é consultado pelas portas administrativas.
--
-- Por que não representar como orgao = 'CJ:ADMIN': o check da coluna e o
-- retorno de orgaos_autorizados() são consumidos por bootstrap.js, pelas
-- policies e pelos testes de acesso. Um valor composto contaminaria os três.
alter table public.permissoes_usuario
  add column if not exists papel text not null default 'operador';

alter table public.permissoes_usuario
  drop constraint if exists permissoes_usuario_papel_check;
alter table public.permissoes_usuario
  add constraint permissoes_usuario_papel_check check (papel in ('operador', 'admin'));

create or replace function public.e_admin_orgao(p_orgao text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.permissoes_usuario p
     where p.user_id = (select auth.uid())
       and p.orgao = p_orgao
       and p.papel = 'admin'
  )
$$;

create or replace function public.orgaos_administrados()
returns table (orgao text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.orgao
    from public.permissoes_usuario p
   where p.user_id = (select auth.uid())
     and p.papel = 'admin'
   order by p.orgao
$$;

revoke all on function public.e_admin_orgao(text) from public, anon, service_role;
revoke all on function public.orgaos_administrados() from public, anon, service_role;
grant execute on function public.e_admin_orgao(text) to authenticated;
grant execute on function public.orgaos_administrados() to authenticated;

-- ── Auditoria ────────────────────────────────────────────────────────────────
-- O Princípio 3 do produto ("toda ação grava autoria e horário") vale em dobro
-- aqui, porque agora a ação DESTRÓI o dado anterior. atualizado_por sozinho não
-- serve: ele guarda o último estado, e a pergunta administrativa é sempre
-- "o que estava aqui antes, e quem trocou".
--
-- antes/depois guardam SÓ as colunas tocadas, não a linha inteira: mantém o
-- registro legível e evita despejar `interessado` — nome de pessoa física — em
-- toda correção de um repositório público.
create table if not exists public.auditoria_admin (
  id          bigint generated always as identity primary key,
  orgao       text        not null check (orgao in ('CJ', 'CREG')),
  operacao    text        not null,
  tabela      text        not null,
  registro_id bigint      not null,
  antes       jsonb       not null,
  depois      jsonb       not null,
  motivo      text,
  feito_por   text        not null,
  feito_em    timestamptz not null default now()
);

create index if not exists idx_auditoria_admin_orgao
  on public.auditoria_admin (orgao, id desc);
create index if not exists idx_auditoria_admin_registro
  on public.auditoria_admin (tabela, registro_id, id);

-- Uma policy só, de SELECT, e filtrada pelo órgão DA LINHA: ser administrador
-- da Câmara não abre o rastro do Conselho.
--
-- Não existe policy de INSERT, de UPDATE nem de DELETE — nem para o
-- administrador. Quem grava é auditar(), SECURITY DEFINER, que roda como dono e
-- passa por cima da RLS. A tabela é append-only por construção, e não por
-- convenção que alguém possa esquecer.
alter table public.auditoria_admin enable row level security;

drop policy if exists "admin le a auditoria do seu orgao" on public.auditoria_admin;
create policy "admin le a auditoria do seu orgao"
  on public.auditoria_admin for select to authenticated
  using (public.e_admin_orgao(orgao));

revoke all privileges on table public.auditoria_admin from anon, authenticated;
revoke all privileges on sequence public.auditoria_admin_id_seq from anon, authenticated;
grant select on public.auditoria_admin to authenticated;

-- ── Ferramentas internas ─────────────────────────────────────────────────────
-- Nenhuma delas é alcançável de fora: o execute é revogado de authenticated, e
-- quem as chama são as funções administrativas, que rodam como dono. Existem
-- para que registrar auditoria e validar entrada não dependam de disciplina
-- repetida em vinte lugares.

-- Porteiro comum. As três recusas em ordem: sem sessão, colegiado que não
-- existe, e sessão legítima sem o papel de administrador naquele órgão.
create or replace function public.admin_exigir(p_orgao text)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or nullif(public.auth_email(), '') is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if coalesce(p_orgao, '') not in ('CJ', 'CREG') then
    raise exception 'colegiado desconhecido: %', p_orgao using errcode = '22023';
  end if;

  if not (select public.e_admin_orgao(p_orgao)) then
    raise exception 'acesso administrativo ao orgao % nao autorizado', p_orgao
      using errcode = '42501';
  end if;
end;
$$;

-- Allowlist. Campo fora dela é 22023, e não silêncio: pedir para alterar
-- `relator` numa correção de julgado é engano de quem chamou, não um no-op.
create or replace function public.admin_validar_campos(p_campos jsonb, p_permitidos text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  chave text;
begin
  if jsonb_typeof(p_campos) is distinct from 'object' then
    raise exception 'os campos devem vir como objeto JSON' using errcode = '22023';
  end if;

  if p_campos = '{}'::jsonb then
    raise exception 'nenhum campo informado para alterar' using errcode = '22023';
  end if;

  for chave in select jsonb_object_keys(p_campos) loop
    if not (chave = any (p_permitidos)) then
      raise exception 'campo nao editavel nesta operacao: %', chave using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- O que de fato mudou entre duas versões da linha, entre as colunas observadas.
-- É o que a tela mostra na confirmação e o que a auditoria guarda.
create or replace function public.admin_delta(p_antes jsonb, p_depois jsonb, p_campos text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(c, jsonb_build_object('antes', p_antes -> c, 'depois', p_depois -> c)),
    '{}'::jsonb)
    from unnest(p_campos) c
   where p_antes -> c is distinct from p_depois -> c
$$;

-- A fatia da linha correspondente às chaves do delta.
create or replace function public.admin_fatiar(p_linha jsonb, p_delta jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, p_linha -> k), '{}'::jsonb)
    from jsonb_object_keys(p_delta) k
$$;

create or replace function public.auditar(
  p_orgao text, p_operacao text, p_tabela text, p_registro_id bigint,
  p_antes jsonb, p_depois jsonb, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.auditoria_admin
    (orgao, operacao, tabela, registro_id, antes, depois, motivo, feito_por)
  values (p_orgao, p_operacao, p_tabela, p_registro_id, p_antes, p_depois,
          nullif(btrim(p_motivo), ''), public.auth_email())
$$;

revoke all on function public.admin_exigir(text)
  from public, anon, service_role;
grant execute on function public.admin_exigir(text) to authenticated;
revoke all on function public.admin_validar_campos(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.admin_delta(jsonb, jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.admin_fatiar(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.auditar(text, text, text, bigint, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;

-- ── Leitura administrativa ───────────────────────────────────────────────────
-- historico_sorteios e processos_sorteio não servem aqui por três motivos:
-- filtram origem = 'sorteio', cortam em historico_marco() e não devolvem o id
-- da linha. O painel precisa exatamente do que aqueles recortes escondem — o
-- registro antigo, o importado de planilha ou de ata — porque é ele que costuma
-- precisar de conserto.
--
-- A busca é por DATA, de sessão ou de sorteio, e nunca por número de processo:
-- quando o próprio número está errado, procurar por ele não acha nada.
--
-- Leitura compartilhada entre colegiados, escrita separada — é a regra que o
-- resto do schema já segue.

create or replace function public.admin_sessoes(p_colegiado text)
returns table (data_sessao date, pauta int, processos int, pendentes int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  with linhas as (
    select j.data_sessao as dia, j.pauta as numero,
           (j.voto is null or j.status is null) as pendente
      from public.julgados_cj j
     where p_colegiado = 'CJ'
    union all
    select k.data_sessao, k.pauta, (k.voto is null or k.status is null)
      from public.julgados_creg k
     where p_colegiado = 'CREG'
  )
  select l.dia, l.numero, count(*)::int, count(*) filter (where l.pendente)::int
    from linhas l
   group by l.dia, l.numero
   order by l.dia desc, l.numero desc nulls last;
end;
$$;

-- Uma data pode carregar duas pautas, e admin_sessoes devolve uma linha para
-- cada uma. Sem o número, as duas linhas abriam a MESMA tabela — com o total
-- somado das duas contradizendo a contagem da linha clicada.
--
-- O drop existe porque o parâmetro novo muda a assinatura: `create or replace`
-- criaria uma sobrecarga e deixaria a versão de duas casas no banco.
drop function if exists public.admin_processos_sessao(text, date);

create or replace function public.admin_processos_sessao(
  p_colegiado text, p_data_sessao date, p_pauta int default null)
returns table (id bigint, num_processo text, pauta int, voto text, status text,
               destino text, data_distribuicao date, acervo_id bigint,
               atualizado_por text, atualizado_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  -- `is not distinct from`, como no carimbo de admin_processos_acervo: a pauta
  -- pode ser nula, e um `=` com nulo esvaziaria justamente a sessão sem número.
  select j.id, j.num_processo, j.pauta, j.voto, j.status, j.relator,
         j.data_distribuicao, j.acervo_id, j.atualizado_por, j.atualizado_em
    from public.julgados_cj j
   where p_colegiado = 'CJ'
     and j.data_sessao = p_data_sessao
     and j.pauta is not distinct from p_pauta
   union all
  select k.id, k.num_processo, k.pauta, k.voto, k.status, k.unidade,
         k.data_distribuicao, k.acervo_id, k.atualizado_por, k.atualizado_em
    from public.julgados_creg k
   where p_colegiado = 'CREG'
     and k.data_sessao = p_data_sessao
     and k.pauta is not distinct from p_pauta
   order by 2;
end;
$$;

-- A autoria nasce no banco, a partir do token validado pelo Supabase. Uma
-- importação de planilha ou ata não tem autor do lançamento original; mesmo
-- quando executada por alguém autenticado, permanece sem autoria atribuída.
-- A função roda como dono porque auth_email() não é executável pelo navegador.
alter table public.acervo_cj add column if not exists criado_por text;
alter table public.acervo_creg add column if not exists criado_por text;

create or replace function public.acervo_registrar_autor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem = 'sorteio' and (select auth.uid()) is not null then
    new.criado_por := nullif(public.auth_email(), '');
    if new.criado_por is null then
      raise exception 'e-mail do usuário autenticado não disponível'
        using errcode = '28000';
    end if;
  else
    new.criado_por := null;
  end if;
  return new;
end;
$$;

revoke all on function public.acervo_registrar_autor()
  from public, anon, authenticated, service_role;

drop trigger if exists acervo_cj_registrar_autor on public.acervo_cj;
create trigger acervo_cj_registrar_autor
  before insert on public.acervo_cj
  for each row execute function public.acervo_registrar_autor();

drop trigger if exists acervo_creg_registrar_autor on public.acervo_creg;
create trigger acervo_creg_registrar_autor
  before insert on public.acervo_creg
  for each row execute function public.acervo_registrar_autor();

-- Agrupa por (data, carimbo, ORIGEM). Uma data pode ter a rodada do sorteio
-- eletrônico e um registro importado de ata; fundi-las esconderia justamente a
-- linha que precisa de conserto.
-- Se um mesmo lote reunir autores distintos ou linhas sem autor, não atribui
-- toda a distribuição a uma só pessoa.
drop function if exists public.admin_sorteios(text);
create or replace function public.admin_sorteios(p_colegiado text)
returns table (data_distribuicao date, sorteado_em timestamptz, origem text,
               processos int, destinos text[], quem text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  with linhas as (
    select a.data_distribuicao as dia, a.sorteado_em as carimbo,
           a.origem as fonte, a.relator as destino, a.criado_por as autor
      from public.acervo_cj a
     where p_colegiado = 'CJ'
    union all
    select b.data_distribuicao, b.sorteado_em, b.origem, b.unidade, b.criado_por
      from public.acervo_creg b
     where p_colegiado = 'CREG'
  ), por_destino as (
    select l.dia, l.carimbo, l.fonte, l.destino, l.autor, count(*)::int as qtd
      from linhas l
     group by l.dia, l.carimbo, l.fonte, l.destino, l.autor
  )
  select d.dia, d.carimbo, d.fonte, sum(d.qtd)::int,
         array_agg(distinct d.destino order by d.destino),
         case when count(*) filter (where d.autor is null) = 0
                   and count(distinct d.autor) = 1
              then min(d.autor) else null end
    from por_destino d
   group by d.dia, d.carimbo, d.fonte
   order by 1 desc, 2 desc nulls last, 3;
end;
$$;

-- O drop acompanha uma mudança de colunas no retorno (`defesa`, abaixo):
-- `create or replace` recusa alterar o tipo de retorno de uma função.
drop function if exists public.admin_processos_acervo(text, date, timestamptz, text);

create or replace function public.admin_processos_acervo(
  p_colegiado text, p_data date, p_sorteado_em timestamptz default null,
  p_origem text default null)
returns table (id bigint, ordem int, num_processo text, destino text, assunto text,
               decisao text, defesa boolean, interessado text, origem text,
               julgados int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  -- `is not distinct from` e não `=`: o carimbo de uma rodada pode ser nulo, e
  -- um `=` com nulo devolveria lista vazia justamente para ela.
  --
  -- `decisao` e `defesa` são a mesma coluna vista de dois lugares, e é de
  -- propósito. `decisao` é o que a TABELA mostra, e segue a regra que
  -- processos_acervo_cj documenta: defesa nula cai no texto legado de
  -- `recurso`, porque relê-lo como defesa inventaria a decisão. `defesa` é o
  -- que o FORMULÁRIO edita, e aí só o valor armazenado serve — o legado como
  -- "antes" faria a confirmação prometer uma mudança diferente da que a
  -- auditoria registra.
  select a.id, a.ordem, a.num_processo, a.relator, a.assunto,
         case when a.defesa is null then a.recurso
              when a.defesa        then 'Sim'
              else 'Não' end,
         a.defesa,
         null::text, a.origem,
         (select count(*)::int from public.julgados_cj j where j.acervo_id = a.id)
    from public.acervo_cj a
   where p_colegiado = 'CJ'
     and a.data_distribuicao = p_data
     and a.sorteado_em is not distinct from p_sorteado_em
     and (p_origem is null or a.origem = p_origem)
   union all
  select b.id, b.ordem, b.num_processo, b.unidade, b.assunto, b.recurso,
         null::boolean, b.interessado, b.origem,
         (select count(*)::int from public.julgados_creg k where k.acervo_id = b.id)
    from public.acervo_creg b
   where p_colegiado = 'CREG'
     and b.data_distribuicao = p_data
     and b.sorteado_em is not distinct from p_sorteado_em
     and (p_origem is null or b.origem = p_origem)
   order by 2 nulls last, 3;
end;
$$;

-- A correção do número do processo não é a edição da linha que a pessoa clicou:
-- alcança TODA distribuição e TODO julgado que carregam aquele número. Este é o
-- preview que a confirmação mostra antes de gravar, porque a operação não tem
-- desfazer e o diálogo abria a partir de uma linha só.
create or replace function public.admin_registros_do_processo(
  p_colegiado text, p_num_processo text)
returns table (origem_registro text, registro_id bigint, data_referencia date,
               pauta int, destino text, vinculado boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  select 'acervo'::text, a.id, a.data_distribuicao, null::int, a.relator, null::boolean
    from public.acervo_cj a
   where p_colegiado = 'CJ' and a.num_processo = p_num_processo
   union all
  select 'julgados'::text, j.id, j.data_sessao, j.pauta, j.relator, j.acervo_id is not null
    from public.julgados_cj j
   where p_colegiado = 'CJ' and j.num_processo = p_num_processo
   union all
  select 'acervo'::text, b.id, b.data_distribuicao, null::int, b.unidade, null::boolean
    from public.acervo_creg b
   where p_colegiado = 'CREG' and b.num_processo = p_num_processo
   union all
  select 'julgados'::text, k.id, k.data_sessao, k.pauta, k.unidade, k.acervo_id is not null
    from public.julgados_creg k
   where p_colegiado = 'CREG' and k.num_processo = p_num_processo
   order by 1, 3, 2;
end;
$$;

-- O preview de impacto da confirmação: quem copiou esta distribuição e será
-- alterado junto se a operação for uma correção.
create or replace function public.admin_julgados_do_acervo(p_colegiado text, p_acervo_id bigint)
returns table (id bigint, num_processo text, data_sessao date, pauta int,
               voto text, status text, destino text, data_distribuicao date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  select j.id, j.num_processo, j.data_sessao, j.pauta, j.voto, j.status,
         j.relator, j.data_distribuicao
    from public.julgados_cj j
   where p_colegiado = 'CJ'
     and j.acervo_id = p_acervo_id
   union all
  select k.id, k.num_processo, k.data_sessao, k.pauta, k.voto, k.status,
         k.unidade, k.data_distribuicao
    from public.julgados_creg k
   where p_colegiado = 'CREG'
     and k.acervo_id = p_acervo_id
   order by 3, 2;
end;
$$;

-- Mesmo motivo do drop de admin_processos_acervo: o retorno ganhou uma coluna.
drop function if exists public.admin_auditoria(text, int, bigint);

-- Registro excluído: a busca pelo número ATUAL volta vazia, e a linha dizia
-- "processo não localizado" justamente no registro mais importante do rastro.
-- O retrato da exclusão (depois = {}) guarda o último número; vale para a
-- própria linha da exclusão e para as correções que o registro recebeu antes
-- de sair. O índice (tabela, registro_id, id) atende a subconsulta.

create or replace function public.admin_auditoria(
  p_colegiado text, p_limite int default 50, p_antes_de bigint default null)
returns table (id bigint, operacao text, tabela text, registro_id bigint,
               num_processo text, antes jsonb, depois jsonb, motivo text,
               feito_por text, feito_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  select a.id, a.operacao, a.tabela, a.registro_id,
         -- Chave interna não identifica nada para quem opera o sistema: o
         -- rastro precisa dizer de QUAL processo se trata. É o número ATUAL do
         -- registro, não o da época da alteração — é ele que a pessoa tem em
         -- mãos ao procurar. Quando a própria alteração foi o número, o
         -- antes/depois do delta já conta a história.
         coalesce(
           case a.tabela
             when 'julgados_cj'   then (select j.num_processo from public.julgados_cj j
                                         where j.id = a.registro_id)
             when 'julgados_creg' then (select k.num_processo from public.julgados_creg k
                                         where k.id = a.registro_id)
             when 'acervo_cj'     then (select c.num_processo from public.acervo_cj c
                                         where c.id = a.registro_id)
             when 'acervo_creg'   then (select d.num_processo from public.acervo_creg d
                                         where d.id = a.registro_id)
           end,
           (select e.antes ->> 'num_processo'
              from public.auditoria_admin e
             where e.tabela = a.tabela
               and e.registro_id = a.registro_id
               and e.depois = '{}'::jsonb
             order by e.id desc
             limit 1)),
         a.antes, a.depois, a.motivo, a.feito_por, a.feito_em
    from public.auditoria_admin a
   where a.orgao = p_colegiado
     and (p_antes_de is null or a.id < p_antes_de)
   order by a.id desc
   limit greatest(1, least(coalesce(p_limite, 50), 500));
end;
$$;

-- Julgados dentro e fora da meta de 45 dias, por mês da sessão. O painel soma
-- os meses em bimestre, trimestre, quadrimestre ou semestre, e filtra o ano: a
-- resposta cabe inteira numa consulta (doze linhas por ano, no máximo), então
-- trocar o agrupamento não volta ao banco.
--
-- Só status 'Julgado' conta. Retirado, Vista, Retornou, Sobrestado e
-- Prejudicado foram à mesa sem julgamento, e status nulo ainda não foi
-- registrado. Por isso um processo que teve Vista e depois foi julgado conta
-- uma vez só, pela sessão do julgamento — e o prazo dessa linha já é o total
-- desde a distribuição.
--
-- sem_prazo é meta_45 nulo: não entra nem em dentro nem em fora.
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

-- Os julgados por trás de cada contagem da aba Meta 45; o painel recorta
-- dentro, fora e sem prazo aferível a partir desta resposta.
create or replace function public.admin_meta_45_processos(p_colegiado text, p_de date, p_ate date)
returns table (num_processo text, destino text, data_distribuicao date, data_sessao date,
               dias int, meta_45 boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  -- Mesmo recorte de admin_meta_45 (status 'Julgado', período pela sessão):
  -- se os dois divergirem, o card abre um número diferente do que a célula
  -- mostrava. Os mais atrasados primeiro, que é o que se procura na lista.
  return query
  select j.num_processo, j.relator, j.data_distribuicao, j.data_sessao, j.dias_dt, j.meta_45
    from public.julgados_cj j
   where p_colegiado = 'CJ' and j.status = 'Julgado'
     and j.data_sessao between p_de and p_ate
   union all
  select k.num_processo, k.unidade, k.data_distribuicao, k.data_sessao, k.dias_dt, k.meta_45
    from public.julgados_creg k
   where p_colegiado = 'CREG' and k.status = 'Julgado'
     and k.data_sessao between p_de and p_ate
   order by 5 desc nulls last, 1;
end;
$$;

revoke all on function public.admin_meta_45_processos(text, date, date) from public, anon, service_role;
grant execute on function public.admin_meta_45_processos(text, date, date) to authenticated;

revoke all on function public.admin_sessoes(text) from public, anon, service_role;
revoke all on function public.admin_processos_sessao(text, date, int) from public, anon, service_role;
revoke all on function public.admin_sorteios(text) from public, anon, service_role;
revoke all on function public.admin_processos_acervo(text, date, timestamptz, text)
  from public, anon, service_role;
revoke all on function public.admin_julgados_do_acervo(text, bigint) from public, anon, service_role;
revoke all on function public.admin_auditoria(text, int, bigint) from public, anon, service_role;
revoke all on function public.admin_registros_do_processo(text, text) from public, anon, service_role;
grant execute on function public.admin_sessoes(text) to authenticated;
grant execute on function public.admin_processos_sessao(text, date, int) to authenticated;
grant execute on function public.admin_sorteios(text) to authenticated;
grant execute on function public.admin_processos_acervo(text, date, timestamptz, text) to authenticated;
grant execute on function public.admin_julgados_do_acervo(text, bigint) to authenticated;
grant execute on function public.admin_auditoria(text, int, bigint) to authenticated;
grant execute on function public.admin_registros_do_processo(text, text) to authenticated;

-- ── Correção de julgado ──────────────────────────────────────────────────────
-- p_campos traz SÓ as chaves que mudam: ausente é "não mexer", presente com
-- null é "apagar". É esse idioma que devolve o desfazer que o coalesce de
-- registrar_votos impede — e ali o coalesce está certo, porque a secretaria
-- preenche e o administrador corrige.
--
-- ATENÇÃO ao gatilho: data_sessao está na cláusula `update of` de
-- julgados_cj_derivar, que executa `new.acervo_id := origem.id` INCONDICIONAL.
-- relator, defesa e data_distribuicao sobrevivem pelo coalesce, mas o vínculo é
-- reatribuído. Corrigir a data de uma sessão pode, portanto, religar o julgado
-- a outra distribuição sem ninguém ter pedido — que é o AVISO "Data de
-- distribuição divergente do acervo vinculado" de verificacao_cj.sql.
--
-- A função não bloqueia (a rederivação em geral está certa), mas observa
-- acervo_id no delta, grava na auditoria e devolve ao chamador. Silêncio aqui
-- produziria exatamente a inconsistência que a operação existe para evitar.
create or replace function public.admin_corrigir_julgado_cj(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis  constant text[] := array['voto', 'status', 'data_sessao', 'pauta'];
  observados constant text[] := array['voto', 'status', 'data_sessao', 'pauta',
                                      'acervo_id', 'relator', 'defesa', 'data_distribuicao'];
  antes  public.julgados_cj%rowtype;
  depois public.julgados_cj%rowtype;
  delta  jsonb;
begin
  perform public.admin_exigir('CJ');
  perform public.admin_validar_campos(p_campos, editaveis);

  -- Os mesmos rótulos de registrar_votos. Mudou lá, muda aqui.
  if p_campos ? 'voto' and nullif(p_campos ->> 'voto', '') is not null
     and p_campos ->> 'voto' not in ('Manter', 'Anular', 'Retirado', 'Vista') then
    raise exception 'voto fora do permitido: %', p_campos ->> 'voto' using errcode = '22023';
  end if;

  if p_campos ? 'status' and nullif(p_campos ->> 'status', '') is not null
     and p_campos ->> 'status' not in ('Julgado', 'Retornou', 'Retirado', 'Vista') then
    raise exception 'status fora do permitido: %', p_campos ->> 'status' using errcode = '22023';
  end if;

  if p_campos ? 'data_sessao' then
    if nullif(p_campos ->> 'data_sessao', '') is null then
      raise exception 'a data da sessao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_sessao')::date > current_date then
      raise exception 'sessao no futuro: %', p_campos ->> 'data_sessao' using errcode = '22023';
    end if;
  end if;

  -- coalesce, e não uma segunda condição depois do `and`: o Postgres não
  -- garante ordem de avaliação entre os operandos, e ''::int ESTOURA em vez de
  -- recusar com mensagem. Aqui o vazio já virou null antes de qualquer cast.
  if p_campos ? 'pauta' and coalesce(nullif(p_campos ->> 'pauta', '')::int, 1) <= 0 then
    raise exception 'numero de pauta invalido: %', p_campos ->> 'pauta' using errcode = '22023';
  end if;

  -- for update: duas correções simultâneas não gravam a mesma foto anterior.
  select * into antes from public.julgados_cj where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  begin
    update public.julgados_cj j
       -- nullif como em registrar_votos: a validação acima já trata '' como
       -- ausência, e sem ele o UPDATE gravava a string vazia literal — um voto
       -- em branco que passa pela allowlist e vira selo vazio em todo painel.
       set voto        = case when p_campos ? 'voto'
                              then nullif(p_campos ->> 'voto', '') else j.voto end,
           status      = case when p_campos ? 'status'
                              then nullif(p_campos ->> 'status', '') else j.status end,
           data_sessao = case when p_campos ? 'data_sessao'
                              then (p_campos ->> 'data_sessao')::date else j.data_sessao end,
           pauta       = case when p_campos ? 'pauta'
                              then nullif(p_campos ->> 'pauta', '')::int else j.pauta end,
           atualizado_em  = now(),
           atualizado_por = public.auth_email()
     where j.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), observados);
  if delta <> '{}'::jsonb then
    perform public.auditar('CJ', 'corrigir_julgado', 'julgados_cj', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'julgados_cj',
                            'operacao', 'corrigir_julgado',
                            'alterados', delta, 'propagados', '[]'::jsonb);
end;
$$;

create or replace function public.admin_corrigir_julgado_creg(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis  constant text[] := array['voto', 'status', 'data_sessao', 'pauta'];
  observados constant text[] := array['voto', 'status', 'data_sessao', 'pauta',
                                      'acervo_id', 'unidade', 'assunto', 'recurso',
                                      'data_distribuicao'];
  antes  public.julgados_creg%rowtype;
  depois public.julgados_creg%rowtype;
  delta  jsonb;
begin
  perform public.admin_exigir('CREG');
  perform public.admin_validar_campos(p_campos, editaveis);

  -- A lista do Conselho é mais longa que a da Câmara, e é a de
  -- registrar_votos_creg.
  if p_campos ? 'voto' and nullif(p_campos ->> 'voto', '') is not null
     and p_campos ->> 'voto' not in ('Manter', 'Anular', 'Aprovação', 'Indeferimento',
                                     'Extinção', 'Retirado', 'Vista') then
    raise exception 'voto fora do permitido: %', p_campos ->> 'voto' using errcode = '22023';
  end if;

  if p_campos ? 'status' and nullif(p_campos ->> 'status', '') is not null
     and p_campos ->> 'status' not in ('Julgado', 'Retirado', 'Vista',
                                       'Sobrestado', 'Prejudicado') then
    raise exception 'status fora do permitido: %', p_campos ->> 'status' using errcode = '22023';
  end if;

  if p_campos ? 'data_sessao' then
    if nullif(p_campos ->> 'data_sessao', '') is null then
      raise exception 'a data da sessao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_sessao')::date > current_date then
      raise exception 'sessao no futuro: %', p_campos ->> 'data_sessao' using errcode = '22023';
    end if;
  end if;

  -- coalesce, e não uma segunda condição depois do `and`: o Postgres não
  -- garante ordem de avaliação entre os operandos, e ''::int ESTOURA em vez de
  -- recusar com mensagem. Aqui o vazio já virou null antes de qualquer cast.
  if p_campos ? 'pauta' and coalesce(nullif(p_campos ->> 'pauta', '')::int, 1) <= 0 then
    raise exception 'numero de pauta invalido: %', p_campos ->> 'pauta' using errcode = '22023';
  end if;

  select * into antes from public.julgados_creg where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  begin
    update public.julgados_creg k
       -- nullif como em registrar_votos: a validação acima já trata '' como
       -- ausência, e sem ele o UPDATE gravava a string vazia literal — um voto
       -- em branco que passa pela allowlist e vira selo vazio em todo painel.
       set voto        = case when p_campos ? 'voto'
                              then nullif(p_campos ->> 'voto', '') else k.voto end,
           status      = case when p_campos ? 'status'
                              then nullif(p_campos ->> 'status', '') else k.status end,
           data_sessao = case when p_campos ? 'data_sessao'
                              then (p_campos ->> 'data_sessao')::date else k.data_sessao end,
           pauta       = case when p_campos ? 'pauta'
                              then nullif(p_campos ->> 'pauta', '')::int else k.pauta end,
           atualizado_em  = now(),
           atualizado_por = public.auth_email()
     where k.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), observados);
  if delta <> '{}'::jsonb then
    perform public.auditar('CREG', 'corrigir_julgado', 'julgados_creg', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'julgados_creg',
                            'operacao', 'corrigir_julgado',
                            'alterados', delta, 'propagados', '[]'::jsonb);
end;
$$;

-- ── Religar um julgado ao acervo ─────────────────────────────────────────────
-- Grava null nos campos derivados e deixa o gatilho rederivá-los — a técnica
-- que o próprio schema documenta ("para forçar a rederivação de um campo, basta
-- gravar null nele"). É a cura dos AVISOS "Relator divergente do acervo
-- vinculado" e "Defesa divergente do acervo vinculado", que hoje só se resolvem
-- rodando sql/rederivar_cj.sql à mão.
create or replace function public.admin_religar_julgado_cj(
  p_id bigint, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  observados constant text[] := array['acervo_id', 'relator', 'defesa', 'data_distribuicao'];
  antes  public.julgados_cj%rowtype;
  depois public.julgados_cj%rowtype;
  delta  jsonb;
begin
  perform public.admin_exigir('CJ');

  select * into antes from public.julgados_cj where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  update public.julgados_cj j
     set relator = null, defesa = null, data_distribuicao = null,
         atualizado_em = now(), atualizado_por = public.auth_email()
   where j.id = p_id
   returning * into depois;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), observados);
  if delta <> '{}'::jsonb then
    perform public.auditar('CJ', 'religar_julgado', 'julgados_cj', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'julgados_cj',
                            'operacao', 'religar_julgado',
                            'alterados', delta, 'propagados', '[]'::jsonb);
end;
$$;

create or replace function public.admin_religar_julgado_creg(
  p_id bigint, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  observados constant text[] := array['acervo_id', 'unidade', 'assunto', 'recurso',
                                      'data_distribuicao'];
  antes  public.julgados_creg%rowtype;
  depois public.julgados_creg%rowtype;
  delta  jsonb;
begin
  perform public.admin_exigir('CREG');

  select * into antes from public.julgados_creg where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  update public.julgados_creg k
     set unidade = null, assunto = null, recurso = null, data_distribuicao = null,
         atualizado_em = now(), atualizado_por = public.auth_email()
   where k.id = p_id
   returning * into depois;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), observados);
  if delta <> '{}'::jsonb then
    perform public.auditar('CREG', 'religar_julgado', 'julgados_creg', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'julgados_creg',
                            'operacao', 'religar_julgado',
                            'alterados', delta, 'propagados', '[]'::jsonb);
end;
$$;

-- ── Correção e redistribuição do acervo ──────────────────────────────────────
-- Um corpo, duas portas. O que muda é se a alteração PROPAGA para os julgados
-- que copiaram esta distribuição, e o rótulo que fica na auditoria.
--
--   corrigir_acervo -> propaga. O sorteio gravou a cadeira errada; o julgado
--                      copiou o erro junto, e os dois têm de andar juntos.
--   redistribuir    -> não propaga. O processo mudou de mão DEPOIS, e o julgado
--                      registra quem de fato o levou à mesa. Reescrever isso
--                      seria apagar história, que é o oposto do que a cópia
--                      (e não referência) em julgados_* existe para garantir.
--
-- A intenção mora no NOME da função e não num booleano do cliente: assim o
-- rastro registra o que o administrador declarou, e não é possível redistribuir
-- alegando correção.
create or replace function public.admin_alterar_acervo_cj(
  p_id bigint, p_campos jsonb, p_propagar boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis constant text[] := array['relator', 'data_distribuicao', 'assunto',
                                     'defesa', 'ordem'];
  -- O que julgados_cj copia do acervo. Só mudança NESTES campos propaga.
  copiados  constant text[] := array['relator', 'defesa', 'data_distribuicao'];
  antes    public.acervo_cj%rowtype;
  depois   public.acervo_cj%rowtype;
  j_antes  public.julgados_cj%rowtype;
  j_depois public.julgados_cj%rowtype;
  delta      jsonb;
  j_delta    jsonb;
  propagados bigint[] := '{}';
begin
  perform public.admin_exigir('CJ');
  perform public.admin_validar_campos(p_campos, editaveis);

  if p_campos ? 'relator'
     and coalesce(p_campos ->> 'relator', '') !~ '^CJ[1-9][0-9]*$' then
    raise exception 'cadeira invalida: %', coalesce(p_campos ->> 'relator', '(vazio)')
      using errcode = '22023';
  end if;

  -- nullif, e não `->> ... is null`: a chave presente com string vazia é o que
  -- um <input type="date"> limpo manda, e é exatamente o caso que esta guarda
  -- existe para recusar. Sem o nullif ela passava direto e o ''::date estourava
  -- com erro cru do Postgres — a mesma razão que fez as funções de julgado
  -- adotarem o idioma, e o único idioma usado daqui para baixo.
  if p_campos ? 'data_distribuicao' then
    if nullif(p_campos ->> 'data_distribuicao', '') is null then
      raise exception 'a data de distribuicao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_distribuicao')::date > current_date then
      raise exception 'distribuicao no futuro: %', p_campos ->> 'data_distribuicao'
        using errcode = '22023';
    end if;
  end if;

  if p_campos ? 'assunto' and nullif(btrim(coalesce(p_campos ->> 'assunto', '')), '') is null then
    raise exception 'o assunto nao pode ficar vazio' using errcode = '22023';
  end if;

  -- coalesce e não uma segunda condição depois do `and`: o Postgres não garante
  -- ordem de avaliação entre os operandos, e ''::int ESTOURA em vez de recusar
  -- com mensagem. Aqui o vazio já virou null antes de qualquer cast — e ordem
  -- em branco é apagar a ordem, que é legítimo.
  if p_campos ? 'ordem' and coalesce(nullif(p_campos ->> 'ordem', '')::int, 1) <= 0 then
    raise exception 'ordem invalida: %', p_campos ->> 'ordem' using errcode = '22023';
  end if;

  select * into antes from public.acervo_cj where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  begin
    update public.acervo_cj a
       set relator = case when p_campos ? 'relator'
                          then p_campos ->> 'relator' else a.relator end,
           data_distribuicao = case when p_campos ? 'data_distribuicao'
                                    then (p_campos ->> 'data_distribuicao')::date
                                    else a.data_distribuicao end,
           assunto = case when p_campos ? 'assunto'
                          then p_campos ->> 'assunto' else a.assunto end,
           defesa  = case when p_campos ? 'defesa'
                          then (nullif(p_campos ->> 'defesa', ''))::boolean else a.defesa end,
           ordem   = case when p_campos ? 'ordem'
                          then nullif(p_campos ->> 'ordem', '')::int else a.ordem end
     where a.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe esta distribuicao (mesmo processo, data e cadeira)'
      using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), editaveis);
  if delta <> '{}'::jsonb then
    perform public.auditar('CJ', p_operacao, 'acervo_cj', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  if p_propagar and delta ?| copiados then
    for j_antes in
      select * from public.julgados_cj j where j.acervo_id = p_id order by j.id for update
    loop
      -- Gravar valores NÃO nulos aqui é o que mantém o vínculo no lugar: o
      -- gatilho redispara, o coalesce preserva o que acabamos de gravar, e a
      -- busca pela data nova reencontra esta mesma linha do acervo.
      update public.julgados_cj j
         set relator = depois.relator,
             defesa  = depois.defesa,
             data_distribuicao = depois.data_distribuicao,
             atualizado_em = now(), atualizado_por = public.auth_email()
       where j.id = j_antes.id
       returning * into j_depois;

      j_delta := public.admin_delta(to_jsonb(j_antes), to_jsonb(j_depois),
                                    copiados || array['acervo_id']);
      -- Dentro do `if`, e não depois dele: um julgado que já carregava o valor
      -- corrigido não gera linha de auditoria, e contá-lo fazia o painel
      -- anunciar mais julgados alterados do que o rastro registra. O que
      -- `propagados` conta é o que MUDOU.
      if j_delta <> '{}'::jsonb then
        perform public.auditar('CJ', p_operacao, 'julgados_cj', j_antes.id,
          public.admin_fatiar(to_jsonb(j_antes), j_delta),
          public.admin_fatiar(to_jsonb(j_depois), j_delta), p_motivo);
        propagados := propagados || j_antes.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'acervo_cj', 'operacao', p_operacao,
                            'alterados', delta, 'propagados', to_jsonb(propagados));
end;
$$;

create or replace function public.admin_alterar_acervo_creg(
  p_id bigint, p_campos jsonb, p_propagar boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editaveis constant text[] := array['unidade', 'data_distribuicao', 'assunto',
                                     'recurso', 'ordem', 'interessado'];
  -- interessado NÃO propaga: julgados_creg não tem a coluna. É campo da tela do
  -- sorteio, para a secretaria reconhecer o processo na ata.
  copiados  constant text[] := array['unidade', 'assunto', 'recurso', 'data_distribuicao'];
  antes    public.acervo_creg%rowtype;
  depois   public.acervo_creg%rowtype;
  k_antes  public.julgados_creg%rowtype;
  k_depois public.julgados_creg%rowtype;
  delta      jsonb;
  k_delta    jsonb;
  propagados bigint[] := '{}';
begin
  perform public.admin_exigir('CREG');
  perform public.admin_validar_campos(p_campos, editaveis);

  if p_campos ? 'unidade'
     and coalesce(p_campos ->> 'unidade', '') !~ '^CREG[1-9][0-9]*$' then
    raise exception 'unidade invalida: %', coalesce(p_campos ->> 'unidade', '(vazio)')
      using errcode = '22023';
  end if;

  -- Mesmo idioma da Câmara: nullif pega a chave presente com string vazia, que
  -- é o que um <input type="date"> limpo manda — e sem ele o ''::date estourava
  -- com erro cru do Postgres em vez da mensagem pensada para a tela.
  if p_campos ? 'data_distribuicao' then
    if nullif(p_campos ->> 'data_distribuicao', '') is null then
      raise exception 'a data de distribuicao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_distribuicao')::date > current_date then
      raise exception 'distribuicao no futuro: %', p_campos ->> 'data_distribuicao'
        using errcode = '22023';
    end if;
  end if;

  if p_campos ? 'ordem' and coalesce(nullif(p_campos ->> 'ordem', '')::int, 1) <= 0 then
    raise exception 'ordem invalida: %', p_campos ->> 'ordem' using errcode = '22023';
  end if;

  select * into antes from public.acervo_creg where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  begin
    update public.acervo_creg b
       set unidade = case when p_campos ? 'unidade'
                          then p_campos ->> 'unidade' else b.unidade end,
           data_distribuicao = case when p_campos ? 'data_distribuicao'
                                    then (p_campos ->> 'data_distribuicao')::date
                                    else b.data_distribuicao end,
           assunto = case when p_campos ? 'assunto'
                          then p_campos ->> 'assunto' else b.assunto end,
           recurso = case when p_campos ? 'recurso'
                          then p_campos ->> 'recurso' else b.recurso end,
           ordem   = case when p_campos ? 'ordem'
                          then nullif(p_campos ->> 'ordem', '')::int else b.ordem end,
           interessado = case when p_campos ? 'interessado'
                              then p_campos ->> 'interessado' else b.interessado end
     where b.id = p_id
     returning * into depois;
  exception when unique_violation then
    raise exception 'ja existe esta distribuicao (mesmo processo, data e unidade)'
      using errcode = '23505';
  end;

  delta := public.admin_delta(to_jsonb(antes), to_jsonb(depois), editaveis);
  if delta <> '{}'::jsonb then
    perform public.auditar('CREG', p_operacao, 'acervo_creg', p_id,
      public.admin_fatiar(to_jsonb(antes), delta),
      public.admin_fatiar(to_jsonb(depois), delta), p_motivo);
  end if;

  if p_propagar and delta ?| copiados then
    for k_antes in
      select * from public.julgados_creg k where k.acervo_id = p_id order by k.id for update
    loop
      update public.julgados_creg k
         set unidade = depois.unidade,
             assunto = depois.assunto,
             recurso = depois.recurso,
             data_distribuicao = depois.data_distribuicao,
             atualizado_em = now(), atualizado_por = public.auth_email()
       where k.id = k_antes.id
       returning * into k_depois;

      k_delta := public.admin_delta(to_jsonb(k_antes), to_jsonb(k_depois),
                                    copiados || array['acervo_id']);
      -- Como na Câmara: conta quem mudou, que é quem deixou rastro.
      if k_delta <> '{}'::jsonb then
        perform public.auditar('CREG', p_operacao, 'julgados_creg', k_antes.id,
          public.admin_fatiar(to_jsonb(k_antes), k_delta),
          public.admin_fatiar(to_jsonb(k_depois), k_delta), p_motivo);
        propagados := propagados || k_antes.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', p_id, 'tabela', 'acervo_creg', 'operacao', p_operacao,
                            'alterados', delta, 'propagados', to_jsonb(propagados));
end;
$$;

create or replace function public.admin_corrigir_acervo_cj(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_alterar_acervo_cj(p_id, p_campos, true, 'corrigir_acervo', p_motivo)
$$;

create or replace function public.admin_redistribuir_cj(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_alterar_acervo_cj(p_id, p_campos, false, 'redistribuir', p_motivo)
$$;

create or replace function public.admin_corrigir_acervo_creg(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_alterar_acervo_creg(p_id, p_campos, true, 'corrigir_acervo', p_motivo)
$$;

create or replace function public.admin_redistribuir_creg(
  p_id bigint, p_campos jsonb, p_motivo text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_alterar_acervo_creg(p_id, p_campos, false, 'redistribuir', p_motivo)
$$;

-- ── Correção do número do processo ───────────────────────────────────────────
-- O caso que descartou a busca por número como porta principal do painel:
-- quando o próprio número está errado, procurar por ele não acha nada. Por isso
-- o painel navega por data, e a correção do número é operação à parte.
--
-- ORDEM OBRIGATÓRIA: acervo primeiro, julgados depois. num_processo também está
-- na cláusula `update of` do gatilho; renumerar os julgados antes faria o
-- gatilho procurar o número novo num acervo que ainda não o tem, zerando
-- acervo_id de todos eles.
create or replace function public.admin_corrigir_processo_cj(
  p_num_atual text, p_num_novo text, p_escopo text default 'tudo',
  p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha_a public.acervo_cj%rowtype;
  linha_j public.julgados_cj%rowtype;
  nova_j  public.julgados_cj%rowtype;
  acervo        bigint[] := '{}';
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
  encontrados int;
begin
  perform public.admin_exigir('CJ');

  -- acervo_cj e julgados_cj também recusam número fora dos 15 dígitos, mas com o
  -- erro cru da restrição; a porta valida antes, com a mensagem pensada para a
  -- tela.
  if coalesce(p_num_atual, '') !~ '^[0-9]{15}$'
     or coalesce(p_num_novo, '') !~ '^[0-9]{15}$' then
    raise exception 'numero de processo fora do padrao (15 digitos)' using errcode = '22023';
  end if;

  if p_num_atual = p_num_novo then
    raise exception 'o numero novo e igual ao atual' using errcode = '22023';
  end if;

  if coalesce(p_escopo, '') not in ('tudo', 'acervo', 'julgados') then
    raise exception 'escopo desconhecido: %', p_escopo using errcode = '22023';
  end if;

  select count(*) into encontrados from (
    select 1 from public.acervo_cj a where a.num_processo = p_num_atual
     union all
    select 1 from public.julgados_cj j where j.num_processo = p_num_atual) t;
  if encontrados = 0 then
    raise exception 'processo % nao encontrado', p_num_atual using errcode = '22023';
  end if;

  if p_escopo in ('tudo', 'acervo') then
    for linha_a in
      select * from public.acervo_cj a where a.num_processo = p_num_atual
       order by a.id for update
    loop
      begin
        update public.acervo_cj a set num_processo = p_num_novo where a.id = linha_a.id;
      exception when unique_violation then
        raise exception 'ja existe esta distribuicao com o numero %', p_num_novo
          using errcode = '23505';
      end;
      perform public.auditar('CJ', 'corrigir_processo', 'acervo_cj', linha_a.id,
        jsonb_build_object('num_processo', p_num_atual),
        jsonb_build_object('num_processo', p_num_novo), p_motivo);
      acervo := acervo || linha_a.id;
    end loop;
  end if;

  if p_escopo in ('tudo', 'julgados') then
    for linha_j in
      select * from public.julgados_cj j where j.num_processo = p_num_atual
       order by j.id for update
    loop
      begin
        update public.julgados_cj j set num_processo = p_num_novo where j.id = linha_j.id
        returning * into nova_j;
      exception when unique_violation then
        raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
      end;
      perform public.auditar('CJ', 'corrigir_processo', 'julgados_cj', linha_j.id,
        jsonb_build_object('num_processo', p_num_atual, 'acervo_id', linha_j.acervo_id),
        jsonb_build_object('num_processo', p_num_novo, 'acervo_id', nova_j.acervo_id),
        p_motivo);
      julgados := julgados || linha_j.id;
      -- Com escopo 'julgados' nenhuma linha do acervo carrega o número novo, e o
      -- gatilho DERRUBA o vínculo — o que é a verdade do que ficou, mas era
      -- verdade só no rastro: `desvinculados` voltava vazio e o painel não tinha
      -- o que avisar. Com 'tudo' o acervo foi renumerado antes e o vínculo se
      -- mantém, então este ramo não acrescenta nada lá.
      if nova_j.acervo_id is null and linha_j.acervo_id is not null then
        desvinculados := desvinculados || linha_j.id;
      end if;
    end loop;
  elsif p_escopo = 'acervo' then
    -- Sem renumerar os julgados, o vínculo passaria a apontar para um processo
    -- DIFERENTE — o ERRO "Julgado apontando para processo diferente no acervo"
    -- de verificacao_cj.sql. Tocar num_processo com o mesmo valor redispara o
    -- gatilho, que rederiva e DERRUBA o vínculo em vez de deixá-lo mentir.
    -- Julgado sem acervo é apenas AVISO, e é a verdade do que ficou.
    for linha_j in
      select * from public.julgados_cj j where j.acervo_id = any (acervo)
       order by j.id for update
    loop
      update public.julgados_cj j set num_processo = j.num_processo where j.id = linha_j.id
      returning * into nova_j;
      if nova_j.acervo_id is distinct from linha_j.acervo_id then
        perform public.auditar('CJ', 'corrigir_processo', 'julgados_cj', linha_j.id,
          jsonb_build_object('acervo_id', linha_j.acervo_id),
          jsonb_build_object('acervo_id', nova_j.acervo_id), p_motivo);
        desvinculados := desvinculados || linha_j.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'num_processo', jsonb_build_object('antes', p_num_atual, 'depois', p_num_novo),
    'acervo', to_jsonb(acervo), 'julgados', to_jsonb(julgados),
    'desvinculados', to_jsonb(desvinculados));
end;
$$;

create or replace function public.admin_corrigir_processo_creg(
  p_num_atual text, p_num_novo text, p_escopo text default 'tudo',
  p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha_b public.acervo_creg%rowtype;
  linha_k public.julgados_creg%rowtype;
  nova_k  public.julgados_creg%rowtype;
  acervo        bigint[] := '{}';
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
  encontrados int;
begin
  perform public.admin_exigir('CREG');

  if coalesce(p_num_atual, '') !~ '^[0-9]{15}$'
     or coalesce(p_num_novo, '') !~ '^[0-9]{15}$' then
    raise exception 'numero de processo fora do padrao (15 digitos)' using errcode = '22023';
  end if;

  if p_num_atual = p_num_novo then
    raise exception 'o numero novo e igual ao atual' using errcode = '22023';
  end if;

  if coalesce(p_escopo, '') not in ('tudo', 'acervo', 'julgados') then
    raise exception 'escopo desconhecido: %', p_escopo using errcode = '22023';
  end if;

  select count(*) into encontrados from (
    select 1 from public.acervo_creg b where b.num_processo = p_num_atual
     union all
    select 1 from public.julgados_creg k where k.num_processo = p_num_atual) t;
  if encontrados = 0 then
    raise exception 'processo % nao encontrado', p_num_atual using errcode = '22023';
  end if;

  if p_escopo in ('tudo', 'acervo') then
    for linha_b in
      select * from public.acervo_creg b where b.num_processo = p_num_atual
       order by b.id for update
    loop
      begin
        update public.acervo_creg b set num_processo = p_num_novo where b.id = linha_b.id;
      exception when unique_violation then
        raise exception 'ja existe esta distribuicao com o numero %', p_num_novo
          using errcode = '23505';
      end;
      perform public.auditar('CREG', 'corrigir_processo', 'acervo_creg', linha_b.id,
        jsonb_build_object('num_processo', p_num_atual),
        jsonb_build_object('num_processo', p_num_novo), p_motivo);
      acervo := acervo || linha_b.id;
    end loop;
  end if;

  if p_escopo in ('tudo', 'julgados') then
    for linha_k in
      select * from public.julgados_creg k where k.num_processo = p_num_atual
       order by k.id for update
    loop
      begin
        update public.julgados_creg k set num_processo = p_num_novo where k.id = linha_k.id
        returning * into nova_k;
      exception when unique_violation then
        raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
      end;
      perform public.auditar('CREG', 'corrigir_processo', 'julgados_creg', linha_k.id,
        jsonb_build_object('num_processo', p_num_atual, 'acervo_id', linha_k.acervo_id),
        jsonb_build_object('num_processo', p_num_novo, 'acervo_id', nova_k.acervo_id),
        p_motivo);
      julgados := julgados || linha_k.id;
      if nova_k.acervo_id is null and linha_k.acervo_id is not null then
        desvinculados := desvinculados || linha_k.id;
      end if;
    end loop;
  elsif p_escopo = 'acervo' then
    for linha_k in
      select * from public.julgados_creg k where k.acervo_id = any (acervo)
       order by k.id for update
    loop
      update public.julgados_creg k set num_processo = k.num_processo where k.id = linha_k.id
      returning * into nova_k;
      if nova_k.acervo_id is distinct from linha_k.acervo_id then
        perform public.auditar('CREG', 'corrigir_processo', 'julgados_creg', linha_k.id,
          jsonb_build_object('acervo_id', linha_k.acervo_id),
          jsonb_build_object('acervo_id', nova_k.acervo_id), p_motivo);
        desvinculados := desvinculados || linha_k.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'num_processo', jsonb_build_object('antes', p_num_atual, 'depois', p_num_novo),
    'acervo', to_jsonb(acervo), 'julgados', to_jsonb(julgados),
    'desvinculados', to_jsonb(desvinculados));
end;
$$;

-- Os corpos compartilhados não são portas: só as funções nomeadas acima, que
-- declaram a intenção, ficam ao alcance de quem chama pelo PostgREST.
revoke all on function public.admin_alterar_acervo_cj(bigint, jsonb, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_alterar_acervo_creg(bigint, jsonb, boolean, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_corrigir_julgado_cj(bigint, jsonb, text)
  from public, anon, service_role;
revoke all on function public.admin_corrigir_julgado_creg(bigint, jsonb, text)
  from public, anon, service_role;
revoke all on function public.admin_religar_julgado_cj(bigint, text)
  from public, anon, service_role;
revoke all on function public.admin_religar_julgado_creg(bigint, text)
  from public, anon, service_role;
revoke all on function public.admin_corrigir_acervo_cj(bigint, jsonb, text)
  from public, anon, service_role;
revoke all on function public.admin_corrigir_acervo_creg(bigint, jsonb, text)
  from public, anon, service_role;
revoke all on function public.admin_redistribuir_cj(bigint, jsonb, text)
  from public, anon, service_role;
revoke all on function public.admin_redistribuir_creg(bigint, jsonb, text)
  from public, anon, service_role;
revoke all on function public.admin_corrigir_processo_cj(text, text, text, text)
  from public, anon, service_role;
revoke all on function public.admin_corrigir_processo_creg(text, text, text, text)
  from public, anon, service_role;

grant execute on function public.admin_corrigir_julgado_cj(bigint, jsonb, text) to authenticated;
grant execute on function public.admin_corrigir_julgado_creg(bigint, jsonb, text) to authenticated;
grant execute on function public.admin_religar_julgado_cj(bigint, text) to authenticated;
grant execute on function public.admin_religar_julgado_creg(bigint, text) to authenticated;
grant execute on function public.admin_corrigir_acervo_cj(bigint, jsonb, text) to authenticated;
grant execute on function public.admin_corrigir_acervo_creg(bigint, jsonb, text) to authenticated;
grant execute on function public.admin_redistribuir_cj(bigint, jsonb, text) to authenticated;
grant execute on function public.admin_redistribuir_creg(bigint, jsonb, text) to authenticated;
grant execute on function public.admin_corrigir_processo_cj(text, text, text, text) to authenticated;
grant execute on function public.admin_corrigir_processo_creg(text, text, text, text) to authenticated;

-- ── Exclusão pelo painel administrativo ──────────────────────────────────────
-- A porta que faltava: um registro que não deveria existir — distribuição
-- lançada em duplicidade na carga de ata, julgado de outro órgão importado da
-- pauta — só saía por SQL direto no banco, sem rastro nenhum.
--
-- As três regras de 20260908120000 continuam valendo:
--
--   1. as tabelas seguem sem policy de DELETE: só funções nomeadas apagam;
--   2. a intenção mora no NOME. excluir_julgado, excluir_distribuicao (os
--      julgados ficam, sem vínculo) e excluir_distribuicao_e_julgados são
--      portas diferentes, e não um booleano do cliente;
--   3. nada é silencioso. A auditoria guarda a LINHA INTEIRA em `antes` e `{}`
--      em `depois`. As correções guardam só as colunas tocadas; numa exclusão
--      todas foram, e o retrato é a única memória do registro — é dele que uma
--      restauração por SQL partiria. Isso inclui `interessado` do Conselho, que
--      já está no banco e continua legível só por admin do próprio órgão (RLS
--      de auditoria_admin).
--
-- O motivo é obrigatório aqui, e só aqui: numa correção o valor anterior
-- explica a si mesmo; numa exclusão não sobra registro para explicar nada.

-- ── Julgado ──────────────────────────────────────────────────────────────────
-- Nada referencia julgados_*: apagar a linha não derruba vínculo de ninguém.
--
-- Consequência que a tela avisa: sincronizar.py filtra pautas pela URL e insere
-- com `on conflict do nothing`. Se a AGR republicar a pauta numa URL nova, o
-- processo volta a ser importado.
create or replace function public.admin_excluir_julgado_cj(p_id bigint, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes public.julgados_cj%rowtype;
begin
  perform public.admin_exigir('CJ');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.julgados_cj where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  delete from public.julgados_cj j where j.id = p_id;
  perform public.auditar('CJ', 'excluir_julgado', 'julgados_cj', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', 'excluir_julgado', 'num_processo', antes.num_processo,
                            'acervo', '[]'::jsonb, 'julgados', jsonb_build_array(p_id),
                            'desvinculados', '[]'::jsonb);
end;
$$;

create or replace function public.admin_excluir_julgado_creg(p_id bigint, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes public.julgados_creg%rowtype;
begin
  perform public.admin_exigir('CREG');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.julgados_creg where id = p_id for update;
  if not found then
    raise exception 'julgado % nao encontrado', p_id using errcode = '22023';
  end if;

  delete from public.julgados_creg k where k.id = p_id;
  perform public.auditar('CREG', 'excluir_julgado', 'julgados_creg', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', 'excluir_julgado', 'num_processo', antes.num_processo,
                            'acervo', '[]'::jsonb, 'julgados', jsonb_build_array(p_id),
                            'desvinculados', '[]'::jsonb);
end;
$$;

-- ── Distribuição ─────────────────────────────────────────────────────────────
-- Um corpo, duas portas, como em admin_alterar_acervo_*. O que muda é o destino
-- dos julgados que apontam para a linha — e a FK (sem ON DELETE) exige que eles
-- saiam do caminho ANTES do DELETE:
--
--   excluir_distribuicao            -> desvincula. acervo_id NÃO está no
--                                      `update of` do gatilho de derivação,
--                                      então gravar null ali não redispara nada
--                                      e a cópia (relator/unidade, defesa/
--                                      recurso, datas) fica como está — é o
--                                      registro de quem levou o processo à mesa;
--   excluir_distribuicao_e_julgados -> apaga os julgados junto, cada um com o
--                                      seu retrato.
--
-- Ordem das travas igual à da correção de acervo: a distribuição primeiro, os
-- julgados depois.
create or replace function public.admin_remover_acervo_cj(
  p_id bigint, p_com_julgados boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes     public.acervo_cj%rowtype;
  vinculado public.julgados_cj%rowtype;
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
begin
  perform public.admin_exigir('CJ');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.acervo_cj where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  for vinculado in
    select * from public.julgados_cj j where j.acervo_id = p_id order by j.id for update
  loop
    if p_com_julgados then
      delete from public.julgados_cj j where j.id = vinculado.id;
      perform public.auditar('CJ', p_operacao, 'julgados_cj', vinculado.id,
                             to_jsonb(vinculado), '{}'::jsonb, p_motivo);
      julgados := julgados || vinculado.id;
    else
      update public.julgados_cj j
         set acervo_id = null, atualizado_em = now(), atualizado_por = public.auth_email()
       where j.id = vinculado.id;
      perform public.auditar('CJ', p_operacao, 'julgados_cj', vinculado.id,
                             jsonb_build_object('acervo_id', p_id),
                             jsonb_build_object('acervo_id', null), p_motivo);
      desvinculados := desvinculados || vinculado.id;
    end if;
  end loop;

  delete from public.acervo_cj a where a.id = p_id;
  perform public.auditar('CJ', p_operacao, 'acervo_cj', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', p_operacao, 'num_processo', antes.num_processo,
                            'acervo', jsonb_build_array(p_id), 'julgados', to_jsonb(julgados),
                            'desvinculados', to_jsonb(desvinculados));
end;
$$;

create or replace function public.admin_remover_acervo_creg(
  p_id bigint, p_com_julgados boolean, p_operacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes     public.acervo_creg%rowtype;
  vinculado public.julgados_creg%rowtype;
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
begin
  perform public.admin_exigir('CREG');

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'informe o motivo da exclusao' using errcode = '22023';
  end if;

  select * into antes from public.acervo_creg where id = p_id for update;
  if not found then
    raise exception 'distribuicao % nao encontrada', p_id using errcode = '22023';
  end if;

  for vinculado in
    select * from public.julgados_creg k where k.acervo_id = p_id order by k.id for update
  loop
    if p_com_julgados then
      delete from public.julgados_creg k where k.id = vinculado.id;
      perform public.auditar('CREG', p_operacao, 'julgados_creg', vinculado.id,
                             to_jsonb(vinculado), '{}'::jsonb, p_motivo);
      julgados := julgados || vinculado.id;
    else
      update public.julgados_creg k
         set acervo_id = null, atualizado_em = now(), atualizado_por = public.auth_email()
       where k.id = vinculado.id;
      perform public.auditar('CREG', p_operacao, 'julgados_creg', vinculado.id,
                             jsonb_build_object('acervo_id', p_id),
                             jsonb_build_object('acervo_id', null), p_motivo);
      desvinculados := desvinculados || vinculado.id;
    end if;
  end loop;

  delete from public.acervo_creg b where b.id = p_id;
  perform public.auditar('CREG', p_operacao, 'acervo_creg', p_id,
                         to_jsonb(antes), '{}'::jsonb, p_motivo);

  return jsonb_build_object('operacao', p_operacao, 'num_processo', antes.num_processo,
                            'acervo', jsonb_build_array(p_id), 'julgados', to_jsonb(julgados),
                            'desvinculados', to_jsonb(desvinculados));
end;
$$;

create or replace function public.admin_excluir_distribuicao_cj(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_cj(p_id, false, 'excluir_distribuicao', p_motivo)
$$;

create or replace function public.admin_excluir_distribuicao_e_julgados_cj(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_cj(p_id, true, 'excluir_distribuicao_e_julgados', p_motivo)
$$;

create or replace function public.admin_excluir_distribuicao_creg(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_creg(p_id, false, 'excluir_distribuicao', p_motivo)
$$;

create or replace function public.admin_excluir_distribuicao_e_julgados_creg(p_id bigint, p_motivo text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_remover_acervo_creg(p_id, true, 'excluir_distribuicao_e_julgados', p_motivo)
$$;

-- ── Privilégios ──────────────────────────────────────────────────────────────
-- Os corpos não são portas: só as funções nomeadas, que declaram a intenção,
-- ficam ao alcance de quem chama pelo PostgREST.
revoke all on function public.admin_remover_acervo_cj(bigint, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_remover_acervo_creg(bigint, boolean, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_excluir_julgado_cj(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_julgado_creg(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_cj(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_creg(bigint, text) from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_e_julgados_cj(bigint, text)
  from public, anon, service_role;
revoke all on function public.admin_excluir_distribuicao_e_julgados_creg(bigint, text)
  from public, anon, service_role;
revoke all on function public.admin_auditoria(text, int, bigint) from public, anon, service_role;

grant execute on function public.admin_excluir_julgado_cj(bigint, text) to authenticated;
grant execute on function public.admin_excluir_julgado_creg(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_cj(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_creg(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_e_julgados_cj(bigint, text) to authenticated;
grant execute on function public.admin_excluir_distribuicao_e_julgados_creg(bigint, text) to authenticated;
grant execute on function public.admin_auditoria(text, int, bigint) to authenticated;
