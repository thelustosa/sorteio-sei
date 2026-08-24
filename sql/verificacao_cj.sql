-- Verificação de consistência dos dados da Câmara de Julgamento.
--
-- Rode no SQL Editor do Supabase a qualquer momento. Só lê: nenhum comando
-- altera dado. Devolve uma linha por conferência, com a gravidade e quantos
-- registros estão fora do esperado.
--
--   ERRO   quebra uma regra do sistema. Não deveria existir; investigue.
--   AVISO  dado suspeito ou incompleto. Não impede o funcionamento.
--   INFO   contagem para acompanhamento, sem julgamento de valor.
--
-- Para ver os registros de uma conferência específica, copie o SELECT dela e
-- troque o count(*) pelas colunas que interessam.

with conferencias as (

-- ── Integridade estrutural ───────────────────────────────────────────────────

select 1::numeric as ordem, 'ERRO' as gravidade,
       'Distribuição repetida no acervo' as conferencia,
       'mesmo processo, mesma data e mesmo relator mais de uma vez' as explicacao,
       (select count(*) from (
          select 1 from public.acervo_cj
           group by num_processo, data_distribuicao, relator
          having count(*) > 1) x) as quantidade

union all
select 2, 'ERRO',
       'Processo julgado duas vezes na mesma sessão',
       'mesmo num_processo com a mesma data_sessao',
       (select count(*) from (
          select 1 from public.julgados_cj
           group by num_processo, data_sessao
          having count(*) > 1) x)

union all
select 2.5, 'ERRO',
       'Distribuição CREG repetida',
       'mesmo processo, data e unidade mais de uma vez',
       (select count(*) from (
          select 1 from public.processos_sorteados
           where modo = 'CREG'
           group by modo, num_processo, data_distribuicao, unidade
          having count(*) > 1) x)

union all
select 3, 'ERRO',
       'Julgado apontando para processo diferente no acervo',
       'acervo_id existe mas o num_processo dos dois não bate',
       (select count(*) from public.julgados_cj j
           join public.acervo_cj a on a.id = j.acervo_id
          where a.num_processo <> j.num_processo)

union all
select 4, 'ERRO',
       'Data de distribuição divergente do acervo vinculado',
       'a cópia guardada no julgado não é a do registro a que ele se liga',
       (select count(*) from public.julgados_cj j
           join public.acervo_cj a on a.id = j.acervo_id
          where a.data_distribuicao is distinct from j.data_distribuicao)

-- ── Formato dos identificadores ──────────────────────────────────────────────

union all
select 5, 'ERRO',
       'Número de processo fora do padrão no acervo',
       'processo SEI da AGR tem 15 dígitos, só dígitos',
       (select count(*) from public.acervo_cj where num_processo !~ '^[0-9]{15}$')

union all
select 6, 'ERRO',
       'Número de processo fora do padrão nos julgados',
       'processo SEI da AGR tem 15 dígitos, só dígitos',
       (select count(*) from public.julgados_cj where num_processo !~ '^[0-9]{15}$')

union all
select 6.5, 'AVISO',
       'Número de processo fora do padrão no CREG',
       'legado preservado; novos registros já exigem 15 dígitos, só dígitos',
       (select count(*) from public.processos_sorteados
         where modo = 'CREG' and num_processo !~ '^[0-9]{15}$')

-- ── Rótulos ──────────────────────────────────────────────────────────────────

union all
select 7, 'ERRO',
       'Voto fora da lista aceita',
       'esperado: Manter, Anular ou Vista',
       (select count(*) from public.julgados_cj
         where voto is not null and voto not in ('Manter', 'Anular', 'Vista'))

union all
select 8, 'ERRO',
       'Status fora da lista aceita',
       'esperado: Julgado, Retornou, Retirado ou Vista',
       (select count(*) from public.julgados_cj
         where status is not null
           and status not in ('Julgado', 'Retornou', 'Retirado', 'Vista'))

-- ── Coerência das datas ──────────────────────────────────────────────────────

union all
select 9, 'AVISO',
       'Sessão anterior à distribuição',
       'dias_dt negativo: o processo foi julgado antes de ser distribuído',
       (select count(*) from public.julgados_cj where dias_dt < 0)

union all
select 10, 'AVISO',
       'Sessão em fim de semana',
       'a Câmara não se reúne sábado nem domingo — em geral é data digitada errada',
       (select count(*) from public.julgados_cj
         where extract(isodow from data_sessao) in (6, 7))

union all
select 11, 'AVISO',
       'Mesma pauta em datas de sessão diferentes',
       'uma reunião tem uma data só; várias datas indicam data preenchida errada',
       (select count(*) from (
          select 1 from public.julgados_cj
           where pauta is not null
           group by extract(year from data_sessao), pauta
          having count(distinct data_sessao) > 1) x)

union all
select 11.5, 'AVISO',
       'Numeração da pauta andando para trás',
       'a numeração cresce com o tempo; recuar indica número trocado',
       (select count(*) from (
          select 1 from (
            select extract(year from data_sessao)::int as ano, pauta,
                   lag(pauta) over (partition by extract(year from data_sessao)
                                        order by data_sessao) as anterior
              from (select distinct data_sessao, pauta from public.julgados_cj
                     where pauta is not null) s) p
           where pauta < anterior) x)

union all
select 12, 'AVISO',
       'Sessão no futuro',
       'julgamento registrado para data que ainda não chegou',
       (select count(*) from public.julgados_cj where data_sessao > current_date)

union all
select 13, 'AVISO',
       'Distribuição no futuro',
       'processo distribuído em data que ainda não chegou',
       (select count(*) from public.acervo_cj where data_distribuicao > current_date)

-- ── Vínculo com o acervo ─────────────────────────────────────────────────────

union all
select 14, 'AVISO',
       'Julgado sem processo no acervo',
       'apareceu na pauta mas nunca foi registrada uma distribuição para ele',
       (select count(*) from public.julgados_cj where acervo_id is null)

union all
select 15, 'AVISO',
       'Relator divergente do acervo vinculado',
       'esperado nos processos redistribuídos e no histórico vindo da planilha',
       (select count(*) from public.julgados_cj j
           join public.acervo_cj a on a.id = j.acervo_id
          where a.relator is distinct from j.relator)

union all
select 16, 'AVISO',
       'Defesa divergente do acervo vinculado',
       'esperado onde a Defesa foi digitada à mão na planilha',
       (select count(*) from public.julgados_cj j
           join public.acervo_cj a on a.id = j.acervo_id
          where a.defesa is distinct from j.defesa)

-- ── Completude ───────────────────────────────────────────────────────────────

union all
select 17, 'INFO',
       'Julgados aguardando voto ou status',
       'é a fila de trabalho da página julgados.html',
       (select count(*) from public.julgados_cj where voto is null or status is null)

union all
select 18, 'AVISO',
       'Julgado sem número de pauta',
       'sem a pauta não dá para agrupar por reunião na tela de registro',
       (select count(*) from public.julgados_cj where pauta is null)

union all
select 19, 'INFO',
       'Acervo sem informação de defesa',
       'a planilha registrava; sorteios antigos migrados da tabela velha não',
       (select count(*) from public.acervo_cj where defesa is null)

union all
select 20, 'INFO',
       'Processos com mais de uma distribuição',
       'redistribuição é normal e esperada',
       (select count(*) from (
          select 1 from public.acervo_cj
           group by num_processo having count(*) > 1) x)

union all
select 21, 'INFO',
       'Total no acervo',
       'uma linha por distribuição, não por processo',
       (select count(*) from public.acervo_cj)

union all
select 22, 'INFO',
       'Total de julgados',
       'uma linha por processo levado a uma sessão',
       (select count(*) from public.julgados_cj)

union all
select 23, 'INFO',
       'Pautas já sincronizadas da AGR',
       'documentos processados por sincronizacao/sincronizar.py',
       (select count(*) from public.pautas_cj where url like 'https://%')

union all
select 24, 'ERRO',
       'Processo CJ ainda na tabela antiga',
       'processos_sorteados deixou de ser fonte de dados da Câmara',
       (select count(*) from public.processos_sorteados where modo <> 'CREG')

)
select gravidade, conferencia, quantidade, explicacao
  from conferencias
 where quantidade > 0 or gravidade = 'INFO'
 order by case gravidade when 'ERRO' then 1 when 'AVISO' then 2 else 3 end, ordem;
