
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

-- Agrupa por (data, carimbo, ORIGEM). Uma data pode ter a rodada do sorteio
-- eletrônico e um registro importado de ata; fundi-las esconderia justamente a
-- linha que precisa de conserto.
create or replace function public.admin_sorteios(p_colegiado text)
returns table (data_distribuicao date, sorteado_em timestamptz, origem text,
               processos int, destinos text[])
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
           a.origem as fonte, a.relator as destino
      from public.acervo_cj a
     where p_colegiado = 'CJ'
    union all
    select b.data_distribuicao, b.sorteado_em, b.origem, b.unidade
      from public.acervo_creg b
     where p_colegiado = 'CREG'
  ), por_destino as (
    select l.dia, l.carimbo, l.fonte, l.destino, count(*)::int as qtd
      from linhas l
     group by l.dia, l.carimbo, l.fonte, l.destino
  )
  select d.dia, d.carimbo, d.fonte, sum(d.qtd)::int,
         array_agg(d.destino order by d.destino)
    from por_destino d
   group by d.dia, d.carimbo, d.fonte
   order by 1 desc, 2 desc nulls last, 3;
end;
$$;

create or replace function public.admin_processos_acervo(
  p_colegiado text, p_data date, p_sorteado_em timestamptz default null,
  p_origem text default null)
returns table (id bigint, ordem int, num_processo text, destino text, assunto text,
               decisao text, interessado text, origem text, julgados int)
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
  select a.id, a.ordem, a.num_processo, a.relator, a.assunto,
         case when a.defesa is null then a.recurso
              when a.defesa        then 'Sim'
              else 'Não' end,
         null::text, a.origem,
         (select count(*)::int from public.julgados_cj j where j.acervo_id = a.id)
    from public.acervo_cj a
   where p_colegiado = 'CJ'
     and a.data_distribuicao = p_data
     and a.sorteado_em is not distinct from p_sorteado_em
     and (p_origem is null or a.origem = p_origem)
   union all
  select b.id, b.ordem, b.num_processo, b.unidade, b.assunto, b.recurso,
         b.interessado, b.origem,
         (select count(*)::int from public.julgados_creg k where k.acervo_id = b.id)
    from public.acervo_creg b
   where p_colegiado = 'CREG'
     and b.data_distribuicao = p_data
     and b.sorteado_em is not distinct from p_sorteado_em
     and (p_origem is null or b.origem = p_origem)
   order by 2 nulls last, 3;
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

create or replace function public.admin_auditoria(
  p_colegiado text, p_limite int default 50, p_antes_de bigint default null)
returns table (id bigint, operacao text, tabela text, registro_id bigint,
               antes jsonb, depois jsonb, motivo text, feito_por text,
               feito_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  select a.id, a.operacao, a.tabela, a.registro_id, a.antes, a.depois,
         a.motivo, a.feito_por, a.feito_em
    from public.auditoria_admin a
   where a.orgao = p_colegiado
     and (p_antes_de is null or a.id < p_antes_de)
   order by a.id desc
   limit greatest(1, least(coalesce(p_limite, 50), 500));
end;
$$;

revoke all on function public.admin_sessoes(text) from public, anon, service_role;
revoke all on function public.admin_processos_sessao(text, date, int) from public, anon, service_role;
revoke all on function public.admin_sorteios(text) from public, anon, service_role;
revoke all on function public.admin_processos_acervo(text, date, timestamptz, text)
  from public, anon, service_role;
revoke all on function public.admin_julgados_do_acervo(text, bigint) from public, anon, service_role;
revoke all on function public.admin_auditoria(text, int, bigint) from public, anon, service_role;
grant execute on function public.admin_sessoes(text) to authenticated;
grant execute on function public.admin_processos_sessao(text, date, int) to authenticated;
grant execute on function public.admin_sorteios(text) to authenticated;
grant execute on function public.admin_processos_acervo(text, date, timestamptz, text) to authenticated;
grant execute on function public.admin_julgados_do_acervo(text, bigint) to authenticated;
grant execute on function public.admin_auditoria(text, int, bigint) to authenticated;

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
     and p_campos ->> 'voto' not in ('Manter', 'Anular', 'Vista') then
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

  if p_campos ? 'data_distribuicao' then
    if p_campos ->> 'data_distribuicao' is null then
      raise exception 'a data de distribuicao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_distribuicao')::date > current_date then
      raise exception 'distribuicao no futuro: %', p_campos ->> 'data_distribuicao'
        using errcode = '22023';
    end if;
  end if;

  if p_campos ? 'assunto' and coalesce(btrim(p_campos ->> 'assunto'), '') = '' then
    raise exception 'o assunto nao pode ficar vazio' using errcode = '22023';
  end if;

  if p_campos ? 'ordem' and p_campos ->> 'ordem' is not null
     and (p_campos ->> 'ordem')::int <= 0 then
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
                          then (p_campos ->> 'defesa')::boolean else a.defesa end,
           ordem   = case when p_campos ? 'ordem'
                          then (p_campos ->> 'ordem')::int else a.ordem end
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
      if j_delta <> '{}'::jsonb then
        perform public.auditar('CJ', p_operacao, 'julgados_cj', j_antes.id,
          public.admin_fatiar(to_jsonb(j_antes), j_delta),
          public.admin_fatiar(to_jsonb(j_depois), j_delta), p_motivo);
      end if;
      propagados := propagados || j_antes.id;
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

  if p_campos ? 'data_distribuicao' then
    if p_campos ->> 'data_distribuicao' is null then
      raise exception 'a data de distribuicao nao pode ficar vazia' using errcode = '22023';
    end if;
    if (p_campos ->> 'data_distribuicao')::date > current_date then
      raise exception 'distribuicao no futuro: %', p_campos ->> 'data_distribuicao'
        using errcode = '22023';
    end if;
  end if;

  if p_campos ? 'ordem' and p_campos ->> 'ordem' is not null
     and (p_campos ->> 'ordem')::int <= 0 then
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
                          then (p_campos ->> 'ordem')::int else b.ordem end,
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
      if k_delta <> '{}'::jsonb then
        perform public.auditar('CREG', p_operacao, 'julgados_creg', k_antes.id,
          public.admin_fatiar(to_jsonb(k_antes), k_delta),
          public.admin_fatiar(to_jsonb(k_depois), k_delta), p_motivo);
      end if;
      propagados := propagados || k_antes.id;
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

  -- O check de 15 dígitos existe em acervo_creg e não na Câmara; a porta exige
  -- nos dois, para não abrir aqui o ERRO "Número de processo fora do padrão".
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

-- ── Quem administra ──────────────────────────────────────────────────────────
-- Só estes dois, e nos dois órgãos. A migração procura pelo e-mail e falha com
-- mensagem clara se algum não existir: implantação parcialmente autorizada é
-- pior que implantação nenhuma. UUIDs gerados pelo Supabase não são fixados
-- aqui, pela mesma razão da migração de controle de acesso.
--
-- Este bloco NÃO vai para sql/schema.sql: lá mora a estrutura, e a matriz de
-- quem é quem é dado do ambiente.
do $$
declare
  faltando text;
begin
  select string_agg(e, ', ') into faltando
    from unnest(array['lucas.coelho@goias.gov.br', 'sec-agr@goias.gov.br']) e
   where not exists (select 1 from auth.users u where u.email = e);

  if faltando is not null then
    raise exception 'usuarios nao encontrados em auth.users: %', faltando;
  end if;
end $$;

insert into public.permissoes_usuario (user_id, orgao, papel)
select u.id, o.orgao, 'admin'
  from auth.users u
 cross join (values ('CJ'), ('CREG')) as o(orgao)
 where u.email in ('lucas.coelho@goias.gov.br', 'sec-agr@goias.gov.br')
    on conflict (user_id, orgao) do update set papel = 'admin';
