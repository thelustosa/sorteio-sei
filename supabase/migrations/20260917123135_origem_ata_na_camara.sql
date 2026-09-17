-- ── Câmara · origem 'ata' no acervo ─────────────────────────────────────────
-- Paridade com o Conselho: acervo_creg distingue planilha, ata e sorteio desde o
-- CREATE TABLE, e acervo_cj só conhecia planilha e sorteio. Sem a opção, as
-- distribuições lidas dos PDFs das atas entraram como 'sorteio' — e
-- historico_sorteios, que lista origem = 'sorteio' a partir do marco de 27/08,
-- passou a mostrar a ata 016 (16/09/2026, 32 processos) como rodada feita na
-- tela, que ela não foi.
--
-- As seis rodadas reclassificadas são todas de carga por ata, nenhuma da tela:
--   29/06, 13/07, 27/07 e 14/08  atas 011 a 014, carga de recuperação de 21/08
--   24/08 e 16/09                atas 015 e 016, carga de 17/09
-- Nenhuma tem sorteado_em — a ata não traz a hora —, e o filtro exige isso para
-- não alcançar um sorteio da tela que caia numa dessas datas.
--
-- O drop/add e o update deixam o arquivo repetível.

alter table public.acervo_cj
  drop constraint if exists acervo_cj_origem_check;
alter table public.acervo_cj
  add constraint acervo_cj_origem_check check (origem in ('sorteio', 'planilha', 'ata'));

update public.acervo_cj
   set origem = 'ata'
 where origem = 'sorteio'
   and sorteado_em is null
   and data_distribuicao in (date '2026-06-29', date '2026-07-13', date '2026-07-27',
                             date '2026-08-14', date '2026-08-24', date '2026-09-16');
