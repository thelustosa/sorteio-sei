-- Coluna Interessado no sorteio do Conselho Regulador: texto livre digitado
-- pela secretaria na tela do sorteio. Anulável porque os sorteios já gravados
-- não têm o dado e ninguém pode inventá-lo depois.
alter table public.processos_sorteados
  add column if not exists interessado text;
