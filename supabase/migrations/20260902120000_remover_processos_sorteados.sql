-- Remove processos_sorteados, a tabela do sorteio antigo do Conselho Regulador.
--
-- Ela foi medida provisória: até 27/08/2026 o CREG não tinha o desenho da
-- Câmara (acervo + julgados + pautas) e o sorteador gravava numa tabela solta,
-- sem acervo, sem julgados e sem vínculo com nada. Desde a migração
-- 20260827150000 o Conselho tem o par completo, e index.js grava em
-- acervo_creg.
--
-- O que ela guardava — os 81 processos do sorteio de 27/08/2026, o último
-- feito antes da virada — foi copiado para acervo_creg pela migração
-- 20260828090000, com origem = 'sorteio'. Aquela migração deixou a tabela de
-- pé de propósito: apagar tabela com dado dentro não é efeito colateral de
-- rodar um schema, é decisão de quem opera o banco. Esta migração é essa
-- decisão, tomada depois de a cópia ter sido conferida linha a linha.
--
-- Nada mais depende dela: nenhuma FK aponta para cá, nenhuma view a lê,
-- nenhuma função a consulta e o front não a conhece. O índice, a restrição de
-- 15 dígitos, a política de RLS e a sequência caem junto com a tabela.

-- A cópia é conferida agora, e não presumida: se sobrar uma linha sem
-- correspondente em acervo_creg, a migração para em vez de apagar dado que
-- ninguém mais teria como recuperar. Repetível — quando a tabela já não existe
-- não há o que conferir nem o que derrubar.
do $$
declare
  sem_copia bigint;
begin
  if to_regclass('public.processos_sorteados') is null then
    return;
  end if;

  select count(*) into sem_copia
    from public.processos_sorteados p
   where not exists (
     select 1
       from public.acervo_creg a
      where a.num_processo      = p.num_processo
        and a.unidade           = p.unidade
        and a.data_distribuicao = p.data_distribuicao
   );

  if sem_copia > 0 then
    raise exception
      'processos_sorteados tem % linha(s) fora de acervo_creg; a cópia '
      '(migração 20260828090000) precisa rodar antes da remoção', sem_copia;
  end if;
end
$$;

drop table if exists public.processos_sorteados;
