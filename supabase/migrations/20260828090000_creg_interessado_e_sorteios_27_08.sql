-- Conselho Regulador: a coluna interessado e o sorteio de 27/08/2026.
--
-- 1. O interessado voltou para o Conselho em 27/08/2026, digitado na tela do
-- sorteio. Saiu da Câmara em 20/08 porque lá ninguém o consultava; aqui a
-- secretaria o usa para reconhecer o processo na ata.
--
-- Anulável, e não preenchido por importação: no histórico das planilhas ele é
-- nome de pessoa física em volume, e o repositório do projeto é público.
alter table public.acervo_creg add column if not exists interessado text;

-- 2. Os 81 processos sorteados em 27/08/2026 entraram por processos_sorteados,
-- porque a tela em produção ainda era a que gravava lá. Desta versão em diante
-- o sorteio do CREG vai para acervo_creg, e sem esta cópia esses 81 ficariam
-- fora do painel de pendentes — distribuídos e invisíveis.
--
-- processos_sorteados NÃO é esvaziada: continua sendo o que a tela gravou na
-- época, e é dela que sai esta cópia.
--
-- origem = 'sorteio' porque é o que foram: sorteio de verdade, feito pelo
-- sistema. O que muda é só a tabela de destino.
insert into public.acervo_creg
  (num_processo, unidade, data_distribuicao, assunto, recurso, interessado,
   ordem, sorteado_em, origem)
select p.num_processo, p.unidade, p.data_distribuicao, p.assunto, p.recurso,
       p.interessado, p.ordem, p.data_hora, 'sorteio'
  from public.processos_sorteados p
 -- O recorte é a DATA, não o modo: `modo` já é 'CREG' por check constraint da
 -- tabela, então filtrar por ele não recorta nada e esta cópia levaria junto
 -- qualquer sorteio antigo que a tabela guardasse, inflando o acervo e o painel
 -- de pendentes com distribuição que já foi julgada.
 where p.data_hora >= timestamptz '2026-08-27 00:00-03'
   and p.data_hora <  timestamptz '2026-08-28 00:00-03'
on conflict on constraint acervo_creg_distribuicao_unica do nothing;
