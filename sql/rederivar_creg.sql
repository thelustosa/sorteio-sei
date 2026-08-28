-- Rederivação dos julgados do Conselho Regulador que ficaram sem acervo.
--
-- O gatilho julgados_creg_derivar (schema.sql) dispara quando alguém mexe em
-- julgados_creg — e só então. Um processo que chegou pela pauta antes de ter
-- sido sorteado entra com acervo_id nulo, e cadastrar a distribuição depois NÃO
-- o conserta sozinho: inserir em acervo_creg não toca em julgados_creg, então
-- nada reexecuta e o julgado fica órfão para sempre.
--
-- Este script é o empurrão que falta. Gravar um campo derivado nele mesmo faz o
-- gatilho procurar o processo no acervo de novo. O vínculo é preenchido, mas os
-- valores já informados continuam vencendo os derivados por causa do coalesce.
--
-- Quando rodar, no CREG especificamente:
--
--   · depois de cada sincronização, enquanto o acervo estiver defasado — a
--     pauta de 19/08/2026, por exemplo, tinha 18 processos que as planilhas de
--     gabinete ainda não conheciam;
--   · depois de importar uma versão atualizada de CREG1..4.xlsx. A carga de
--     27/08/2026 deixou 47 julgados cuja data de distribuição não existe no
--     acervo: são distribuições que a aba Página registrou e que não
--     sobreviveram nas planilhas de gabinete. Se elas voltarem, este script
--     religa os julgados.
--
-- É seguro repetir:
--   · o filtro só alcança linha sem vínculo e nenhum valor manual é zerado;
--   · na segunda passada a linha vinculada já não casa com o filtro;
--   · voto e status não são tocados — o gatilho não encosta neles, e o que a
--     secretaria preencheu na tela continua lá.
--
-- É um comando só, de propósito: no SQL Editor os comandos passam por um pooler
-- em modo transação e podem cair em conexões diferentes, então begin;…commit;
-- não segura nada. Num comando único, ou tudo passa ou nada é gravado — e o
-- RETURNING ainda devolve o relatório do que aconteceu com cada julgado.
--
-- Quem continuar aparecendo como "continua fora do acervo" é processo que o
-- acervo não tem naquela data. Ver os dois AVISOs de verificacao_creg.sql que
-- separam esse caso do processo que nunca esteve no acervo.

update public.julgados_creg
   set data_distribuicao = data_distribuicao
 where acervo_id is null
returning num_processo,
          data_sessao,
          case when acervo_id is null
               then 'continua fora do acervo'
               else 'vinculado agora' end as resultado,
          unidade,
          data_distribuicao,
          dias_dt;
