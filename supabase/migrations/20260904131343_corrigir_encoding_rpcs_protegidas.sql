-- Correção de encoding das oito RPCs protegidas.
--
-- A migration 20260904110552_controle_acesso_por_orgao chegou ao banco com o
-- conteúdo UTF-8 lido como Windows-1252 (`Get-Content -Raw` sem `-Encoding UTF8`
-- no Windows PowerShell). A lógica veio íntegra, mas todo caractere acentuado
-- foi gravado como a sequência de dois caracteres correspondente — e dois casos
-- passavam do cosmético:
--
--   * registrar_votos_creg recusava os votos "Aprovação" e "Extinção": a lista
--     branca gravada no banco tinha a versão corrompida desses dois rótulos, e
--     o texto correto vindo da tela não casava com ela;
--   * resumo_acervo_cj, resumo_acervo_creg e processos_sorteio devolviam à tela
--     os rótulos de faixa ("Até 15 dias", "Há 3 meses") e a defesa negativa
--     ("Não") corrompidos.
--
-- As oito funções são recriadas aqui a partir do arquivo em UTF-8, byte a byte
-- iguais às da migration original. O ledger daquela migration não é editado.
-- `create or replace` preserva dono, grants e os atributos `security definer` e
-- `search_path = ''` — conferidos antes e depois.

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

create or replace function public.resumo_acervo_cj()
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

create or replace function public.resumo_acervo_creg()
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

create or replace function public.processos_acervo_creg(
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
         p.dias
    from pendentes p
    join faixas f on p.dias between f.de and f.ate
   where (p_ordem   is null or f.ordem   = p_ordem)
     and (p_unidade is null or p.unidade = p_unidade)
   order by p.data_distribuicao, p.num_processo;
end;
$$;

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
