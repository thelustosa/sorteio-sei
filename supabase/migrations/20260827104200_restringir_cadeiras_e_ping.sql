-- Fecha o privilégio SQL amplo herdado quando cadeiras_cj foi criada. A tabela
-- não é API pública: resumo_acervo_cj/processos_acervo_cj fazem a leitura com
-- SECURITY DEFINER e retornam apenas os recortes necessários ao painel.
revoke all privileges on table public.cadeiras_cj from anon, authenticated;

-- A versão hospedada de ping antecede o endurecimento do schema.sql. Embora a
-- função só devolva uma constante, manter search_path explícito evita drift e
-- satisfaz o mesmo padrão de segurança usado pelas demais funções públicas.
alter function public.ping() set search_path = '';
revoke all on function public.ping() from public, service_role;
grant execute on function public.ping() to anon, authenticated;

-- Primeira RPC experimental do painel, substituída por resumo_acervo_cj. Não há
-- consumidor no frontend; removê-la evita manter uma porta SECURITY DEFINER
-- obsoleta no schema exposto.
drop function if exists public.painel_cj_nao_julgados();
