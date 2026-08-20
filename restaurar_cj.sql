-- Desfaz a limpeza: devolve acervo_cj, julgados_cj e pautas_cj ao estado do
-- backup feito por backup_cj.sql.
--
-- ATENÇÃO: apaga tudo o que existe hoje nas três tabelas e põe o backup no
-- lugar. O que foi gravado DEPOIS da limpeza — sorteios novos, julgados
-- sincronizados, votos registrados — se perde. Se quiser guardar esses, copie-os
-- antes.
--
-- É UM comando só, de propósito. No SQL Editor do Supabase os comandos passam
-- por um pooler em modo transação e podem cair em conexões diferentes, então
-- `begin;…commit;` não segura nada — um script em vários comandos poderia
-- apagar as tabelas e falhar na hora de repor. Dentro de um único bloco, ou
-- tudo volta ou nada é tocado.
--
-- Dois detalhes fazem um `insert ... select *` ingênuo falhar aqui, e por isso
-- as colunas são listadas uma a uma:
--   * as colunas id são `generated always as identity` e exigem
--     `overriding system value`;
--   * dias_dt e periodo_dt são colunas geradas e recusam qualquer valor — o
--     backup as copiou como dado comum e o banco vai recalculá-las.
--
-- O gatilho fica desligado durante a carga para que os campos derivados voltem
-- exatamente como estavam, e as sequências são reposicionadas no fim.

do $$
declare
  r record;
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'backup_cj') then
    raise exception 'Não existe backup_cj neste banco. Nada a restaurar.';
  end if;

  select * into r from backup_cj.resumo;

  -- Ordem: julgados primeiro, por causa da chave estrangeira para o acervo.
  delete from public.julgados_cj;
  delete from public.acervo_cj;
  delete from public.pautas_cj;

  alter table public.julgados_cj disable trigger julgados_cj_derivar;

  insert into public.acervo_cj
    (id, num_processo, interessado, relator, data_distribuicao, defesa, assunto,
     ordem, recurso, sorteado_em, origem, criado_em) overriding system value
  select id, num_processo, interessado, relator, data_distribuicao, defesa, assunto,
         ordem, recurso, sorteado_em, origem, criado_em
    from backup_cj.acervo_cj;

  insert into public.julgados_cj
    (id, acervo_id, num_processo, interessado, data_sessao, pauta, voto, status,
     defesa, relator, data_distribuicao, criado_em, atualizado_em,
     atualizado_por) overriding system value
  select id, acervo_id, num_processo, interessado, data_sessao, pauta, voto, status,
         defesa, relator, data_distribuicao, criado_em, atualizado_em, atualizado_por
    from backup_cj.julgados_cj;

  insert into public.pautas_cj
    (id, url, titulo, numero, data_sessao, sha256, processos_encontrados,
     processos_importados, processos_sem_acervo, processado_em) overriding system value
  select id, url, titulo, numero, data_sessao, sha256, processos_encontrados,
         processos_importados, processos_sem_acervo, processado_em
    from backup_cj.pautas_cj;

  alter table public.julgados_cj enable trigger julgados_cj_derivar;

  perform setval(pg_get_serial_sequence('public.acervo_cj', 'id'),
                 coalesce((select max(id) from public.acervo_cj), 1));
  perform setval(pg_get_serial_sequence('public.julgados_cj', 'id'),
                 coalesce((select max(id) from public.julgados_cj), 1));
  perform setval(pg_get_serial_sequence('public.pautas_cj', 'id'),
                 coalesce((select max(id) from public.pautas_cj), 1));

  -- ── Conferências: qualquer divergência desfaz o bloco inteiro ──────────────
  if (select count(*) from public.acervo_cj)   <> r.acervo
     or (select count(*) from public.julgados_cj) <> r.julgados
     or (select count(*) from public.pautas_cj)   <> r.pautas then
    raise exception 'A restauração não bateu com o backup. Desfeito.';
  end if;
  if exists (select 1 from public.julgados_cj j
              where j.acervo_id is not null
                and not exists (select 1 from public.acervo_cj a where a.id = j.acervo_id)) then
    raise exception 'Sobraram vínculos quebrados para o acervo. Desfeito.';
  end if;

  raise notice 'Restaurado: % no acervo, % julgados, % pautas (backup de %).',
               r.acervo, r.julgados, r.pautas, r.feito_em::date;
end;
$$;
