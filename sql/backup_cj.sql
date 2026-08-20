-- Backup dos dados da Câmara de Julgamento, dentro do próprio banco.
--
-- Copia acervo_cj, julgados_cj e pautas_cj para o schema backup_cj, com os
-- dados exatamente como estão agora. Rode antes de qualquer alteração de risco;
-- o restaurar_cj.sql é a volta.
--
-- Este backup vive no mesmo banco: serve para desfazer a limpeza sem depender
-- de arquivo nenhum. Ele NÃO substitui uma cópia fora do Supabase — para isso,
-- rode antes o pg_dump indicado no README, que é o que protege contra perder o
-- projeto inteiro.
--
-- É UM comando só, de propósito: no SQL Editor do Supabase os comandos passam
-- por um pooler em modo transação e podem cair em conexões diferentes, então
-- `begin;…commit;` não segura nada. Num bloco único, ou o backup sai inteiro ou
-- não sai nada — nunca pela metade.
--
-- Roda uma vez só. Se o schema já existir, para sem tocar em nada, para não
-- sobrescrever um backup bom com dados já alterados.

do $$
declare
  a bigint;
  j bigint;
  p bigint;
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'backup_cj') then
    raise exception 'O schema backup_cj já existe. Apague-o à mão se quiser refazer o backup.';
  end if;

  execute 'create schema backup_cj';
  execute 'comment on schema backup_cj is ' || quote_literal(
    'Cópia de acervo_cj, julgados_cj e pautas_cj feita antes da limpeza que '
    'esvaziou os julgados históricos. Ver FLUXO-CJ.md.');

  -- EXECUTE porque as tabelas são criadas neste mesmo bloco: sem ele o plano
  -- seria preparado antes de elas existirem.
  execute 'create table backup_cj.acervo_cj   as select * from public.acervo_cj';
  execute 'create table backup_cj.julgados_cj as select * from public.julgados_cj';
  execute 'create table backup_cj.pautas_cj   as select * from public.pautas_cj';

  execute 'create table backup_cj.resumo as
           select now() as feito_em,
                  (select count(*) from backup_cj.acervo_cj)   as acervo,
                  (select count(*) from backup_cj.julgados_cj) as julgados,
                  (select count(*) from backup_cj.pautas_cj)   as pautas';

  -- O schema de backup não é exposto pela API: nada de RLS, nada de grants.
  execute 'revoke all on schema backup_cj from anon, authenticated';

  execute 'select acervo, julgados, pautas from backup_cj.resumo' into a, j, p;

  if a <> (select count(*) from public.acervo_cj)
     or j <> (select count(*) from public.julgados_cj)
     or p <> (select count(*) from public.pautas_cj) then
    raise exception 'A cópia não bateu com a origem. Desfeito.';
  end if;

  raise notice 'Backup feito: % no acervo, % julgados, % pautas.', a, j, p;
end;
$$;
