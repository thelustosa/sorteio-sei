-- Devolve o histórico da planilha (schema backup_cj) às tabelas de produção,
-- somando-o ao que a nova série gravou desde 19/08/2026. Feito em 18/09/2026.
--
-- Pré-requisito: backup_pre_mesclagem_cj.sql. A volta é desfazer_mesclagem_cj.sql.
--
-- Por que dá para mesclar sem remapear nada (medido antes de escrever):
--   * nenhum id do backup está em uso na produção, fora as 37 distribuições
--     residuais do reinício, que são as mesmas linhas — elas são puladas;
--   * nenhum julgado do backup repete (num_processo, data_sessao) da produção;
--     o backup termina em 18/06/2026, a produção começa em 25/06;
--   * as sequências já estão acima do maior id do backup: nada a reposicionar.
--
-- Relator: 2026 vira cadeira (CJ1..CJ5) pelo de-para de cadeiras_cj, a mesma
-- regra da migração 20260824180000 — distribuição pela data da distribuição,
-- julgado pela data da sessão. 2023 a 2025 ficam com o nome, porque a
-- composição daqueles anos não está cadastrada.
--
-- O gatilho de derivação fica desligado: relator e defesa digitados à mão na
-- planilha (13 e 12 julgados) voltam como estavam. Voto e status também — os
-- 10 julgados históricos sem um dos dois voltam para a fila da tela de
-- registro, e a secretaria os preenche por lá.
--
-- UM comando só: ou tudo entra, ou nada.

do $$
declare
  acervo_antes   bigint := (select count(*) from public.acervo_cj);
  julgados_antes bigint := (select count(*) from public.julgados_cj);
  acervo_novo    bigint;
  julgados_novo  bigint;
begin
  if not exists (select 1 from information_schema.schemata
                  where schema_name = 'backup_cj_pre_mesclagem') then
    raise exception 'Rode backup_pre_mesclagem_cj.sql antes.';
  end if;
  if exists (select 1 from public.julgados_cj j join backup_cj.julgados_cj b using (id)) then
    raise exception 'O histórico já foi mesclado. Nada a fazer.';
  end if;

  -- As residuais precisam ser as mesmas linhas, não só o mesmo id.
  if exists (select 1 from public.acervo_cj p join backup_cj.acervo_cj b using (id)
              where (p.num_processo, p.data_distribuicao, p.defesa)
                    is distinct from (b.num_processo, b.data_distribuicao, b.defesa)) then
    raise exception 'Id do backup em uso por outra distribuição. Desfeito.';
  end if;

  insert into public.acervo_cj
    (id, num_processo, relator, data_distribuicao, defesa, assunto,
     ordem, recurso, sorteado_em, origem, criado_em) overriding system value
  select b.id, b.num_processo, coalesce(c.cadeira, b.relator), b.data_distribuicao,
         b.defesa, b.assunto, b.ordem, b.recurso, b.sorteado_em, b.origem, b.criado_em
    from backup_cj.acervo_cj b
    left join public.cadeiras_cj c
           on c.conselheiro = b.relator
          and b.data_distribuicao >= c.desde
          and (c.ate is null or b.data_distribuicao <= c.ate)
   where not exists (select 1 from public.acervo_cj p where p.id = b.id);
  get diagnostics acervo_novo = row_count;

  alter table public.julgados_cj disable trigger julgados_cj_derivar;

  insert into public.julgados_cj
    (id, acervo_id, num_processo, data_sessao, pauta, voto, status,
     defesa, relator, data_distribuicao, criado_em, atualizado_em,
     atualizado_por) overriding system value
  select b.id, b.acervo_id, b.num_processo, b.data_sessao, b.pauta, b.voto, b.status,
         b.defesa, coalesce(c.cadeira, b.relator), b.data_distribuicao, b.criado_em,
         b.atualizado_em, b.atualizado_por
    from backup_cj.julgados_cj b
    left join public.cadeiras_cj c
           on c.conselheiro = b.relator
          and b.data_sessao >= c.desde
          and (c.ate is null or b.data_sessao <= c.ate);
  get diagnostics julgados_novo = row_count;

  alter table public.julgados_cj enable trigger julgados_cj_derivar;

  -- ── Conferências: qualquer divergência desfaz o bloco inteiro ──────────────
  if acervo_novo <> (select count(*) from (select id from backup_cj.acervo_cj
                                            except
                                            select id from backup_cj_pre_mesclagem.acervo_cj) x)
     or julgados_novo <> (select count(*) from backup_cj.julgados_cj)
     or (select count(*) from public.acervo_cj)   <> acervo_antes + acervo_novo
     or (select count(*) from public.julgados_cj) <> julgados_antes + julgados_novo then
    raise exception 'Contagens não bateram (acervo +%, julgados +%). Desfeito.',
                    acervo_novo, julgados_novo;
  end if;
  if exists (select 1 from public.acervo_cj
              where data_distribuicao >= date '2026-01-01' and relator !~ '^CJ[0-9]+$')
     or exists (select 1 from public.julgados_cj
                 where data_sessao >= date '2026-01-01' and relator !~ '^CJ[0-9]+$') then
    raise exception 'Sobrou nome em vez de cadeira em 2026. Desfeito.';
  end if;
  if (select max(id) from public.acervo_cj) > (select last_value from public.acervo_cj_id_seq)
     or (select max(id) from public.julgados_cj) > (select last_value from public.julgados_cj_id_seq) then
    raise exception 'Sequência abaixo do maior id. Desfeito.';
  end if;

  raise notice 'Mesclado: acervo % → %, julgados % → %.',
               acervo_antes, acervo_antes + acervo_novo,
               julgados_antes, julgados_antes + julgados_novo;
end;
$$;
