-- Papel para quem consulta o acervo e o histórico de sorteios, sem a Meta 45.
-- 'consulta' e 'consulta_historico' abrem a Meta 45; este não. O recorte no banco
-- fica em duas portas: tem_acesso_historico() aceita o papel novo, e
-- meta_45_exigir() e orgaos_consultados() continuam sem listá-lo.
alter table public.permissoes_usuario
  drop constraint if exists permissoes_usuario_papel_check;
alter table public.permissoes_usuario
  add constraint permissoes_usuario_papel_check
  check (papel in ('operador', 'admin', 'consulta', 'consulta_historico', 'acervo_historico'));

create or replace function public.tem_acesso_historico(p_orgao text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.permissoes_usuario p
     where p.user_id = (select auth.uid())
       and p.orgao = p_orgao
       and p.papel in ('operador', 'admin', 'consulta_historico', 'acervo_historico')
  )
$$;
