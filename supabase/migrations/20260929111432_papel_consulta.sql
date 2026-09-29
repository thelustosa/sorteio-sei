-- ── Papel de consulta ────────────────────────────────────────────────────────
-- Um terceiro papel em permissoes_usuario: quem o tem vê o acervo e o painel da
-- Meta 45 do órgão, e mais nada. Não sorteia, não lê nem registra julgados, não
-- abre o histórico e não entra no painel administrativo.
--
-- O recorte mora no banco, e não só na tela:
--
--   1. tem_acesso_orgao() deixa de aceitar 'consulta'. É ela que guarda o
--      INSERT do sorteio, o SELECT dos julgados, registrar_votos e o
--      histórico — tudo isso fecha de uma vez, e qualquer porta nova que usar
--      tem_acesso_orgao() já nasce fechada para a consulta;
--   2. tem_acesso_acervo() é a regra antiga (qualquer papel) e passa a guardar
--      só as RPCs do painel do acervo;
--   3. meta_45_exigir() é o porteiro das duas RPCs da Meta 45: administrador ou
--      consulta. As demais portas administrativas seguem em admin_exigir().
--
-- orgaos_autorizados() continua devolvendo todo órgão com linha na tabela: é o
-- que mantém a pessoa logada e roteia as páginas do acervo. O front descobre o
-- papel por orgaos_consultados(), como já fazia com orgaos_administrados().

alter table public.permissoes_usuario
  drop constraint if exists permissoes_usuario_papel_check;
alter table public.permissoes_usuario
  add constraint permissoes_usuario_papel_check
  check (papel in ('operador', 'admin', 'consulta'));

create or replace function public.tem_acesso_orgao(p_orgao text)
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
       and p.papel <> 'consulta'
  )
$$;

create or replace function public.tem_acesso_acervo(p_orgao text)
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
  )
$$;

create or replace function public.orgaos_consultados()
returns table (orgao text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.orgao
    from public.permissoes_usuario p
   where p.user_id = (select auth.uid())
     and p.papel = 'consulta'
   order by p.orgao
$$;

-- Mesmas três recusas de admin_exigir, na mesma ordem.
create or replace function public.meta_45_exigir(p_orgao text)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or nullif(public.auth_email(), '') is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if coalesce(p_orgao, '') not in ('CJ', 'CREG') then
    raise exception 'colegiado desconhecido: %', p_orgao using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.permissoes_usuario p
     where p.user_id = (select auth.uid())
       and p.orgao = p_orgao
       and p.papel in ('admin', 'consulta')
  ) then
    raise exception 'acesso a meta 45 do orgao % nao autorizado', p_orgao
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.tem_acesso_acervo(text) from public, anon, service_role;
revoke all on function public.orgaos_consultados() from public, anon, service_role;
revoke all on function public.meta_45_exigir(text) from public, anon, service_role;
grant execute on function public.tem_acesso_acervo(text) to authenticated;
grant execute on function public.orgaos_consultados() to authenticated;
grant execute on function public.meta_45_exigir(text) to authenticated;

-- As sete RPCs trocam só o porteiro. Reescrevê-las a partir da definição que
-- está no banco, em vez de colar os corpos aqui, garante que nada além da
-- chamada muda; o cast para regprocedure falha alto se uma assinatura tiver
-- mudado, e a checagem abaixo falha se a troca não pegou. CREATE OR REPLACE
-- preserva os grants de cada uma.
do $$
declare
  alvo record;
  antes text;
  depois text;
begin
  for alvo in
    select * from (values
      ('public.resumo_acervo_cj()'::regprocedure,                        'public.tem_acesso_orgao(', 'public.tem_acesso_acervo('),
      ('public.processos_acervo_cj(integer, text)'::regprocedure,        'public.tem_acesso_orgao(', 'public.tem_acesso_acervo('),
      ('public.resumo_acervo_creg(boolean)'::regprocedure,               'public.tem_acesso_orgao(', 'public.tem_acesso_acervo('),
      ('public.processos_acervo_creg(integer, text, boolean)'::regprocedure, 'public.tem_acesso_orgao(', 'public.tem_acesso_acervo('),
      ('public.retornos_de_vista(text)'::regprocedure,                   'public.tem_acesso_orgao(', 'public.tem_acesso_acervo('),
      ('public.admin_meta_45(text)'::regprocedure,                       'public.admin_exigir(',     'public.meta_45_exigir('),
      ('public.admin_meta_45_processos(text, date, date)'::regprocedure, 'public.admin_exigir(',     'public.meta_45_exigir(')
    ) v(funcao, de, para)
  loop
    antes := pg_get_functiondef(alvo.funcao);
    depois := replace(antes, alvo.de, alvo.para);
    if depois = antes then
      raise exception '% nao chama %', alvo.funcao, alvo.de;
    end if;
    execute depois;
  end loop;
end
$$;
