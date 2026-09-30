-- Marca "senha provisória" nas contas do Supabase Auth.
--
-- A tela de login lê raw_app_meta_data.senha_provisoria na resposta do login e,
-- se estiver ligada, pede a nova senha antes de entrar. A marca só é visível
-- depois que a pessoa provou saber a senha: nenhuma consulta anônima revela
-- quais e-mails existem ou quais ainda têm a senha padrão.
--
-- Mora em app_metadata, e não em user_metadata: o usuário edita o próprio
-- user_metadata pela API, mas não o app_metadata.
--
-- Quem DESLIGA a marca é o banco, não o navegador: trocar a senha por qualquer
-- caminho (popup do login, painel do Supabase) apaga a marca
-- na mesma escrita. A marca em si é ligada uma vez, por sql/marcar_senha_provisoria.sql.
create or replace function public.limpar_marca_senha_provisoria()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) - 'senha_provisoria';
  return new;
end;
$$;

-- Função de gatilho não vira endpoint em /rest/v1/rpc, mas o revoke tira também
-- o EXECUTE que o Postgres concede a PUBLIC por padrão.
revoke all on function public.limpar_marca_senha_provisoria()
  from public, anon, authenticated, service_role;

drop trigger if exists limpar_marca_senha_provisoria on auth.users;
create trigger limpar_marca_senha_provisoria
  before update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.limpar_marca_senha_provisoria();
