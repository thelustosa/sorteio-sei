-- Desfaz mesclar_historico_cj.sql: tira da produção o que veio de backup_cj e
-- devolve resumo_acervo_cj à definição guardada por backup_pre_mesclagem_cj.sql.
--
-- Remove só as linhas que a mesclagem trouxe (id presente em backup_cj e
-- ausente do backup pré-mesclagem). Sorteios, pautas e votos gravados depois
-- da mesclagem ficam — inclusive os da nova série. Voto preenchido pela tela
-- num julgado histórico sai junto com ele.
--
-- Se algum julgado novo tiver se ligado a uma distribuição histórica (o
-- processo voltou à pauta sem sorteio novo), o bloco para e nomeia a situação,
-- em vez de apagar o vínculo em silêncio.
--
-- UM comando só: ou tudo volta, ou nada é tocado.

do $$
declare
  definicao text;
begin
  if not exists (select 1 from information_schema.schemata
                  where schema_name = 'backup_cj_pre_mesclagem') then
    raise exception 'Não existe backup_cj_pre_mesclagem neste banco. Nada a desfazer.';
  end if;

  if exists (select 1 from public.julgados_cj j
              where j.acervo_id in (select id from backup_cj.acervo_cj
                                     except select id from backup_cj_pre_mesclagem.acervo_cj)
                and j.id not in (select id from backup_cj.julgados_cj)) then
    raise exception 'Há julgado novo ligado a distribuição histórica. Resolva o vínculo antes de desfazer.';
  end if;

  delete from public.julgados_cj
   where id in (select id from backup_cj.julgados_cj
                except select id from backup_cj_pre_mesclagem.julgados_cj);

  delete from public.acervo_cj
   where id in (select id from backup_cj.acervo_cj
                except select id from backup_cj_pre_mesclagem.acervo_cj);

  select f.definicao into definicao
    from backup_cj_pre_mesclagem.funcoes f where f.nome = 'resumo_acervo_cj';
  execute definicao;

  if exists (select id from backup_cj_pre_mesclagem.acervo_cj
             except select id from public.acervo_cj)
     or exists (select id from backup_cj_pre_mesclagem.julgados_cj
                except select id from public.julgados_cj) then
    raise exception 'Linha anterior à mesclagem sumiu. Desfeito.';
  end if;

  raise notice 'Mesclagem desfeita: % no acervo, % julgados.',
               (select count(*) from public.acervo_cj),
               (select count(*) from public.julgados_cj);
end;
$$;
