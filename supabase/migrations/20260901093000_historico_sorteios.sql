-- Histórico de sorteios: a consulta das rodadas já realizadas
-- (historico-cj.html e historico-creg.html).
--
-- Só acrescenta funções de LEITURA. Nenhuma tabela, coluna, política ou
-- privilégio de escrita muda — o histórico é uma consulta, e o que já está
-- gravado continua exatamente como está. Por isso a migração é repetível.
--
-- O conteúdo abaixo é idêntico ao bloco "Histórico de sorteios" do
-- sql/schema.sql; um teste compara as definições que as migrações entregam com
-- as do schema, e uma cópia que divergir aparece como falha.

-- A primeira versão desta função não tinha parâmetro: servia os dois colegiados
-- na mesma lista. `create or replace` não muda a assinatura de uma função, então
-- a antiga precisa sair antes da nova entrar.
drop function if exists public.historico_sorteios();

-- ── Histórico de sorteios ────────────────────────────────────────────────────
-- O que alimenta historico-cj.html e historico-creg.html: as rodadas de sorteio
-- já realizadas, uma tela por colegiado, como o painel do acervo.
--
-- Um SORTEIO é o lote que a tela gravou de uma vez: as linhas do acervo que
-- compartilham (data_distribuicao, sorteado_em). index.js usa um só instante
-- para o lote inteiro — ver "Um só instante para o sorteio inteiro" lá —, então
-- o carimbo já identifica a rodada e o histórico não precisa de tabela nova nem
-- de escrever coisa alguma: consultar não pode mexer no que está gravado. Cada
-- sorteio novo entra aqui por ter sido gravado no acervo, sem passo nenhum a
-- mais depois do sorteio.
--
-- O carimbo pode faltar, e por isso a chave é o PAR (data, carimbo) e não o
-- carimbo sozinho. Quando falta, quem data o sorteio é a distribuição.
--
-- Duas condições recortam o que entra, e as duas dizem a mesma coisa por
-- ângulos diferentes — "o que o sistema sorteou, do marco em diante":
--
--   origem = 'sorteio'       o que foi distribuído POR ESTA TELA. Fica de fora
--                            'planilha' (acervo herdado dos gabinetes, que
--                            nunca foi um evento de sorteio — 3.064 linhas no
--                            Conselho contra 81 de sorteio) e 'ata' (sorteio
--                            real, mas anterior ao sistema e conhecido só pelo
--                            PDF publicado no SEI).
--   data >= historico_marco  o início da série, definido abaixo.
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

create or replace function public.historico_sorteios(p_colegiado text)
returns table (
  data_sorteio date,
  sorteado_em  timestamptz,
  processos    int,
  destinos     text[]
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

  return query
  -- Os destinos saem por extenso, não como contagem: "CREG1, CREG2, CREG4" diz
  -- quem participou da rodada, e "3" só diz quantos foram.
  select a.data_distribuicao, a.sorteado_em, count(*)::int,
         array_agg(distinct a.relator order by a.relator)
    from public.acervo_cj a
   where p_colegiado = 'CJ'
     and a.origem = 'sorteio'
     and a.data_distribuicao >= marco
   group by a.data_distribuicao, a.sorteado_em
   union all
  select b.data_distribuicao, b.sorteado_em, count(*)::int,
         array_agg(distinct b.unidade order by b.unidade)
    from public.acervo_creg b
   where p_colegiado = 'CREG'
     and b.origem = 'sorteio'
     and b.data_distribuicao >= marco
   group by b.data_distribuicao, b.sorteado_em
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
    left join public.cadeiras_cj c
           on c.cadeira = a.relator
          and a.data_distribuicao >= c.desde
          and (c.ate is null or a.data_distribuicao <= c.ate)
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
