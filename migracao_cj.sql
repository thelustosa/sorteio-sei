-- Migração da Câmara de Julgamento: processos_sorteados -> acervo_cj.
--
-- Rode UMA VEZ no SQL Editor do Supabase, depois do schema.sql. Rodar de novo
-- não faz mal: nada é duplicado e os passos seguintes viram no-op.
--
-- O que acontece aqui:
--   1. cada sorteio CJ que hoje está em processos_sorteados vira uma linha de
--      acervo_cj (unidade sorteada -> relator, data_hora -> sorteado_em);
--   2. o banco confere, linha a linha, que tudo chegou do outro lado;
--   3. só então as linhas CJ saem da tabela antiga, para não existirem duas
--      fontes de verdade para o mesmo processo;
--   4. a tabela antiga passa a aceitar apenas CREG.
--
-- Tudo numa transação: se a conferência do passo 2 falhar, nada é apagado.
begin;

-- 1. Cópia. O ON CONFLICT absorve tanto a reexecução deste script quanto um
--    eventual sorteio repetido (mesmo processo, mesma data, mesma cadeira).
insert into public.acervo_cj (
  num_processo, interessado, relator, data_distribuicao,
  assunto, recurso, ordem, sorteado_em, origem, criado_em
)
select p.num_processo, p.interessado, p.unidade, p.data_distribuicao,
       p.assunto, p.recurso, p.ordem, p.data_hora, 'sorteio', p.criado_em
  from public.processos_sorteados p
 where p.modo = 'CJ'
 order by p.data_hora, p.ordem, p.id
on conflict on constraint acervo_cj_distribuicao_unica do nothing;

-- 2. Conferência: nenhuma distribuição CJ pode ter ficado para trás.
do $$
declare
  faltando bigint;
begin
  select count(*) into faltando
    from public.processos_sorteados p
   where p.modo = 'CJ'
     and not exists (
       select 1 from public.acervo_cj a
        where a.num_processo      = p.num_processo
          and a.data_distribuicao = p.data_distribuicao
          and a.relator           = p.unidade
     );

  if faltando > 0 then
    raise exception
      'Migração abortada: % linhas CJ não chegaram em acervo_cj. Nada foi apagado.',
      faltando;
  end if;
end;
$$;

-- 3. A tabela antiga deixa de ser fonte de dados da CJ.
delete from public.processos_sorteados where modo = 'CJ';

-- 4. E não volta a ser: daqui em diante só entra CREG.
alter table public.processos_sorteados
  drop constraint if exists processos_sorteados_modo_check;
alter table public.processos_sorteados
  add  constraint processos_sorteados_modo_check check (modo = 'CREG');

commit;
