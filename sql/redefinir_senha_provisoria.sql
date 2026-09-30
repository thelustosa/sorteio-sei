-- Redefine a senha de UMA conta para uma provisória e liga a marca de troca
-- obrigatória. É o caminho do "Esqueci minha senha". Rode no SQL Editor
-- trocando os dois valores entre <>, e não salve o arquivo com eles: o
-- repositório é público.
--
-- Por que não pelo painel ou pela Admin API: o gatilho da migração
-- 20260930111200 apaga a marca em qualquer escrita da senha, porque não sabe
-- quem a escreveu. Aqui a marca vem numa escrita separada, depois da senha, e
-- o gatilho (que só olha encrypted_password) não a vê.
begin;

-- Custo 10 é o padrão do GoTrue. Com custo 4 ou acima de 10, o login regrava o
-- hash com a senha provisória, o gatilho toma isso por troca e a marca sai.
update auth.users
   set encrypted_password = extensions.crypt('<SENHA PROVISÓRIA>', extensions.gen_salt('bf', 10))
 where email = '<email@goias.gov.br>';

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"senha_provisoria": true}'::jsonb
 where email = '<email@goias.gov.br>';

-- Sessões abertas com a senha antiga caem: quem estava dentro entra de novo,
-- com a provisória, e passa pela troca.
delete from auth.sessions
 where user_id = (select id from auth.users where email = '<email@goias.gov.br>');

-- Confira antes do commit: uma linha, com a marca.
select email, raw_app_meta_data from auth.users where email = '<email@goias.gov.br>';

commit;
