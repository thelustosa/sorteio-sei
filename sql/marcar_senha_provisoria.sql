-- Liga a marca "senha provisória" nas contas que ainda usam a senha padrão.
-- Rode UMA vez no SQL Editor, depois da migração 20260930111200_marca_senha_provisoria.sql
-- (sem o gatilho da migração, a marca nunca sairia depois da troca).
--
-- Marca todas as contas de e-mail. Quem já trocou a senha por conta própria vai
-- ver o popup uma vez: ao salvar a nova senha, o gatilho apaga a marca.
-- A senha provisória NÃO aparece aqui: o repositório é público.
--
-- 1) Confira antes quem seria marcado:
--    select id, email, raw_app_meta_data from auth.users order by email;
--
-- 2) Marque:
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"senha_provisoria": true}'::jsonb
 where email is not null;

-- 3) Acompanhe quem ainda não trocou (a marca some sozinha a cada troca):
--    select email from auth.users where raw_app_meta_data ? 'senha_provisoria' order by email;
--
-- Depois do prazo, redefina no painel do Supabase as contas que continuarem na lista.
