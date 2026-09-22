-- Corrige o recorte "Em diligência" do painel do CREG.
--
-- A migração anterior (20260922100000) definiu "em diligência" como "pendente e
-- com diligência registrada". Está errado, e mostrava falso positivo: um
-- processo que FOI a diligência, VOLTOU e ainda não foi julgado aparecia como
-- se estivesse em diligência. São estados diferentes — "aguarda pauta" não é
-- "está fora com a área técnica".
--
-- Quem marca o estado é a coluna RETORNO da planilha, confirmado com a
-- secretaria em 22/09/2026:
--
--     RETORNO = NÃO  -> a diligência está aberta, o processo está fora
--     RETORNO = SIM  -> o processo voltou
--
-- Na planilha a linha encerrada também fica tachada e com o SIM em verde, mas
-- o recorte NÃO lê formatação: o `?output=csv` que a sincronização consome não
-- transporta nem tachado nem cor, e regra que depende de formatação muda de
-- significado num copiar-colar. RETORNO é texto, vem no CSV, e é o campo que a
-- equipe de fato mantém — as 44 linhas de 22/09/2026 estavam todas em SIM,
-- todas encerradas, o que é o próprio recorte devolvendo zero.
--
--     em diligência = pendente no acervo
--                     E tem diligência com RETORNO = NÃO
--                        e data_diligencia >= data_distribuicao
--
-- A guarda de data continua cobrindo a redistribuição, como antes.
--
-- Vazio não conta como aberta. A convenção é explícita (SIM/NÃO), então uma
-- célula em branco é linha que ninguém preencheu, não diligência aberta — e o
-- recorte prefere não mostrar nada a mostrar um processo que já voltou.

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
