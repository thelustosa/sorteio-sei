-- Rederivação dos julgados que ficaram sem acervo.
--
-- O gatilho julgados_cj_derivar (schema.sql) dispara quando alguém mexe em
-- julgados_cj — e só então. Um processo que chegou pela pauta antes de ter sido
-- sorteado entra com acervo_id nulo, e cadastrar a distribuição depois NÃO o
-- conserta sozinho: inserir em acervo_cj não toca em julgados_cj, então nada
-- reexecuta e o julgado fica órfão para sempre.
--
-- Este script é o empurrão que falta. Gravar null num campo derivado é como
-- pedir a fórmula de volta — o gatilho só preenche o que vem nulo, por causa do
-- coalesce — então zerar os três faz o banco procurar o processo no acervo de
-- novo e vincular o que agora existe.
--
-- Rode no SQL Editor do Supabase depois de cada sorteio, enquanto o acervo
-- estiver em reconstrução: é o passo que fecha o ciclo "sorteei um processo que
-- já tinha ido a julgamento". Ver FLUXO-CJ.md, seção 3.
--
-- É seguro repetir:
--   · o filtro só alcança linha que já está vazia, então nunca sobrescreve o
--     relator de um julgamento que já aconteceu;
--   · na segunda passada a linha vinculada já não casa com o filtro;
--   · voto e status não são tocados — o gatilho não encosta neles, e o que a
--     secretaria preencheu na tela continua lá.
--
-- É um comando só, de propósito: no SQL Editor os comandos passam por um pooler
-- em modo transação e podem cair em conexões diferentes, então begin;…commit;
-- não segura nada. Num comando único, ou tudo passa ou nada é gravado — e o
-- RETURNING ainda devolve o relatório do que aconteceu com cada julgado.
--
-- Quem continuar aparecendo como "continua fora do acervo" é processo que ainda
-- não foi sorteado pelo sistema. É a mesma contagem do AVISO "Julgado sem
-- processo no acervo" do verificacao_cj.sql.

update public.julgados_cj
   set relator           = null,
       defesa            = null,
       data_distribuicao = null
 where acervo_id is null
returning num_processo,
          data_sessao,
          case when acervo_id is null
               then 'continua fora do acervo'
               else 'vinculado agora' end as resultado,
          relator,
          data_distribuicao,
          dias_dt;
