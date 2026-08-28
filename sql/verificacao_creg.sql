-- Verificação de consistência dos dados do Conselho Regulador.
--
-- Rode no SQL Editor do Supabase a qualquer momento — e, sobretudo, logo depois
-- de importar acervo_creg.sql e julgados_creg.sql. Só lê: nenhum comando altera
-- dado. Devolve uma linha por conferência, com a gravidade e quantos registros
-- estão fora do esperado.
--
--   ERRO   quebra uma regra do sistema. Não deveria existir; investigue.
--   AVISO  dado suspeito ou incompleto. Não impede o funcionamento, e boa parte
--          é qualidade herdada da planilha (ver FLUXO-CREG.md).
--   INFO   contagem para acompanhamento, sem julgamento de valor.
--
-- Para ver os registros de uma conferência específica, copie o SELECT dela e
-- troque o count(*) pelas colunas que interessam.

with conferencias as (

-- ── Integridade estrutural ───────────────────────────────────────────────────

select 1::numeric as ordem, 'ERRO' as gravidade,
       'Distribuição repetida no acervo' as conferencia,
       'mesmo processo, mesma data e mesma unidade mais de uma vez' as explicacao,
       (select count(*) from (
          select 1 from public.acervo_creg
           group by num_processo, data_distribuicao, unidade
          having count(*) > 1) x) as quantidade

union all
select 2, 'ERRO',
       'Processo julgado duas vezes na mesma sessão',
       'mesmo num_processo com a mesma data_sessao',
       (select count(*) from (
          select 1 from public.julgados_creg
           group by num_processo, data_sessao
          having count(*) > 1) x)

union all
select 3, 'ERRO',
       'Julgado apontando para processo diferente no acervo',
       'acervo_id existe mas o num_processo dos dois não bate',
       (select count(*) from public.julgados_creg j
           join public.acervo_creg a on a.id = j.acervo_id
          where a.num_processo <> j.num_processo)

union all
select 4, 'ERRO',
       'Data de distribuição divergente do acervo vinculado',
       'a cópia guardada no julgado não é a do registro a que ele se liga',
       (select count(*) from public.julgados_creg j
           join public.acervo_creg a on a.id = j.acervo_id
          where a.data_distribuicao is distinct from j.data_distribuicao)

union all
select 7, 'AVISO',
       'Unidade divergente do acervo vinculado',
       'a coluna "Unidade CREG" da aba Página diz um gabinete e a distribuição '
       'daquela data, nas planilhas de gabinete, diz outro. Divergência entre as '
       'duas fontes, não do sistema: vale o valor informado, e o vínculo aponta '
       'para a distribuição da data',
       (select count(*) from public.julgados_creg j
           join public.acervo_creg a on a.id = j.acervo_id
          where a.unidade is distinct from j.unidade)

union all
select 8, 'AVISO',
       'Sessão anterior à distribuição',
       'dias_dt negativo: a planilha registrou o processo julgado antes de '
       'distribuído. Ela exibia esses casos como uma data de 1899',
       (select count(*) from public.julgados_creg where dias_dt < 0)

-- ── Qualidade do dado importado ──────────────────────────────────────────────

union all
select 10, 'AVISO',
       'Julgado de processo que não está no acervo',
       'julgado antes de as planilhas de gabinete existirem (a mais antiga '
       'começa em ago/2023 e os julgados em jan/2023). Só acervo_id fica nulo: '
       'unidade e data_distribuicao vêm da própria aba Página, e por isso '
       'dias_dt, meta_45 e periodo_dt continuam calculados e ENTRAM nos '
       'indicadores de prazo',
       (select count(*) from public.julgados_creg j
         where j.acervo_id is null
           and not exists (select 1 from public.acervo_creg a
                            where a.num_processo = j.num_processo))

union all
select 10.5, 'AVISO',
       'Julgado com data de distribuição que o acervo não tem',
       'o processo existe no acervo, mas em outra data — a distribuição que a '
       'aba Página registrou não sobreviveu nas planilhas de gabinete. Fica sem '
       'vínculo de propósito, para não apontar para distribuição de outra data. '
       'Se as planilhas de gabinete recuperarem essas distribuições, '
       'sql/rederivar_creg.sql religa os julgados',
       (select count(*) from public.julgados_creg j
         where j.acervo_id is null
           and exists (select 1 from public.acervo_creg a
                        where a.num_processo = j.num_processo))

union all
select 11, 'AVISO',
       'Voto fora da lista do Conselho',
       'grafia do histórico sem equivalente em Manter/Anular/Aprovação/'
       'Indeferimento/Extinção/Retirado/Vista — preservada de propósito',
       (select count(*) from public.julgados_creg
         where voto is not null
           and voto not in ('Manter', 'Anular', 'Aprovação', 'Indeferimento',
                            'Extinção', 'Retirado', 'Vista'))

union all
select 12, 'AVISO',
       'Status fora da lista do Conselho',
       'idem, para Julgado/Retirado/Vista/Sobrestado/Prejudicado',
       (select count(*) from public.julgados_creg
         where status is not null
           and status not in ('Julgado', 'Retirado', 'Vista',
                              'Sobrestado', 'Prejudicado'))

union all
select 13, 'AVISO',
       'Julgado sem voto ou sem status',
       'a fila de trabalho da secretaria: sessão realizada e decisão não '
       'registrada',
       (select count(*) from public.julgados_creg
         where voto is null or status is null)

union all
select 14, 'AVISO',
       'Distribuição sem assunto',
       'linha da planilha de gabinete com a coluna Assunto em branco',
       (select count(*) from public.acervo_creg where assunto is null)

union all
select 15, 'AVISO',
       'Distribuição sem recurso',
       'linha da planilha de gabinete com a coluna Recurso em branco',
       (select count(*) from public.acervo_creg where recurso is null)

union all
select 16, 'AVISO',
       'Processo distribuído a mais de uma unidade',
       'redistribuição, ou o mesmo processo lançado em dois gabinetes; o painel '
       'conta só a distribuição mais recente',
       (select count(*) from (
          select num_processo from public.acervo_creg
           group by num_processo having count(distinct unidade) > 1) x)

union all
select 17, 'AVISO',
       'Sessão dos julgados sem pauta registrada',
       'data_sessao que não aparece em pautas_creg — normal no histórico '
       'importado, que é anterior à sincronização',
       (select count(distinct j.data_sessao) from public.julgados_creg j
         where not exists (select 1 from public.pautas_creg p
                            where p.data_sessao = j.data_sessao
                              and p.url like 'https://%'))

union all
select 18, 'AVISO',
       'Julgado sem a decisão da Câmara',
       'voto_cj em branco: processo que não passou pela CJ, ou linha em que a '
       'fórmula da planilha não encontrou o processo',
       (select count(*) from public.julgados_creg where voto_cj is null)

-- ── Contagens ────────────────────────────────────────────────────────────────

union all
select 20, 'INFO',
       'Distribuições no acervo',
       'uma linha por distribuição de um processo a uma unidade',
       (select count(*) from public.acervo_creg)

union all
select 21, 'INFO',
       'Processos distintos no acervo',
       'sem contar as redistribuições',
       (select count(distinct num_processo) from public.acervo_creg)

union all
select 22, 'INFO',
       'Total de julgados',
       'uma linha por processo levado a uma sessão',
       (select count(*) from public.julgados_creg)

union all
select 23, 'INFO',
       'Sessões distintas',
       'data_sessao diferentes — a chave confiável, já que o número da pauta '
       'diverge do da AGR no histórico',
       (select count(distinct data_sessao) from public.julgados_creg)

union all
select 24, 'INFO',
       'Processos pendentes de julgamento',
       'no acervo e ausentes de julgados_creg: é o que o painel conta',
       -- Uma linha por processo, na distribuição mais recente. O critério é o
       -- MESMO de resumo_acervo_creg e processos_acervo_creg — data primeiro,
       -- id só para desempatar. Ordenar por id sozinho daria outra resposta:
       -- as atas de sorteio foram importadas depois das planilhas e têm id
       -- maior mesmo quando a data é anterior.
       (select count(*) from (
          select distinct on (a.num_processo) a.num_processo
            from public.acervo_creg a
           where not exists (select 1 from public.julgados_creg j
                              where j.num_processo = a.num_processo)
           order by a.num_processo, a.data_distribuicao desc, a.id desc) x)

union all
select 25, 'INFO',
       'Julgados fora da META 45',
       'mais de 45 dias entre a distribuição no CREG e a sessão',
       (select count(*) from public.julgados_creg where meta_45 is false)

union all
select 26, 'INFO',
       'Divergências em relação à Câmara',
       'Conselho decidiu diferente da CJ, pelos critérios da coluna '
       '"Em relação à CJ"',
       (select count(*) from public.julgados_creg where em_relacao_cj is not null)

union all
select 27, 'INFO',
       'Pautas já sincronizadas da AGR',
       'documentos processados por sincronizacao/sincronizar.py --colegiado CREG',
       (select count(*) from public.pautas_creg where url like 'https://%')

)
select gravidade, conferencia, quantidade, explicacao
  from conferencias
 where quantidade > 0 or gravidade = 'INFO'
 order by case gravidade when 'ERRO' then 1 when 'AVISO' then 2 else 3 end, ordem;
