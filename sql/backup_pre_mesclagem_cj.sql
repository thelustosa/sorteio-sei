-- Backup da Câmara de Julgamento antes da mesclagem do histórico (18/09/2026).
--
-- Copia acervo_cj, julgados_cj, pautas_cj e cadeiras_cj para o schema
-- backup_cj_pre_mesclagem, e guarda a definição de resumo_acervo_cj, a única
-- função que a mesclagem altera. O desfazer_mesclagem_cj.sql é a volta.
--
-- Mesmas regras do backup_cj.sql: UM comando só (o SQL Editor passa por um
-- pooler em modo transação), roda uma vez e para sem tocar em nada se o schema
-- já existir. Não substitui o pg_dump do README, que protege o projeto inteiro.

do $$
begin
  if exists (select 1 from information_schema.schemata
              where schema_name = 'backup_cj_pre_mesclagem') then
    raise exception 'O schema backup_cj_pre_mesclagem já existe. Apague-o à mão se quiser refazer o backup.';
  end if;

  execute 'create schema backup_cj_pre_mesclagem';
  execute 'comment on schema backup_cj_pre_mesclagem is ' || quote_literal(
    'Estado da CJ antes da mesclagem do histórico de backup_cj em 18/09/2026. '
    'Ver FLUXO-CJ.md, seção 5.');

  execute 'create table backup_cj_pre_mesclagem.acervo_cj   as select * from public.acervo_cj';
  execute 'create table backup_cj_pre_mesclagem.julgados_cj as select * from public.julgados_cj';
  execute 'create table backup_cj_pre_mesclagem.pautas_cj   as select * from public.pautas_cj';
  execute 'create table backup_cj_pre_mesclagem.cadeiras_cj as select * from public.cadeiras_cj';
  execute 'create table backup_cj_pre_mesclagem.funcoes as
           select p.proname as nome, pg_get_functiondef(p.oid) as definicao
             from pg_proc p
            where p.pronamespace = ''public''::regnamespace
              and p.proname = ''resumo_acervo_cj''';
  execute 'create table backup_cj_pre_mesclagem.resumo as
           select now() as feito_em,
                  (select count(*) from backup_cj_pre_mesclagem.acervo_cj)   as acervo,
                  (select count(*) from backup_cj_pre_mesclagem.julgados_cj) as julgados,
                  (select count(*) from backup_cj_pre_mesclagem.pautas_cj)   as pautas,
                  (select count(*) from backup_cj_pre_mesclagem.cadeiras_cj) as cadeiras';

  execute 'revoke all on schema backup_cj_pre_mesclagem from anon, authenticated';

  if (select count(*) from public.acervo_cj)   <> (select count(*) from backup_cj_pre_mesclagem.acervo_cj)
  or (select count(*) from public.julgados_cj) <> (select count(*) from backup_cj_pre_mesclagem.julgados_cj)
  or (select count(*) from public.pautas_cj)   <> (select count(*) from backup_cj_pre_mesclagem.pautas_cj)
  or (select count(*) from backup_cj_pre_mesclagem.funcoes) <> 1 then
    raise exception 'A cópia não bateu com a origem. Desfeito.';
  end if;
end;
$$;
