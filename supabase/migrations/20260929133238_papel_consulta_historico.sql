-- Consulta do acervo e da Meta 45 com acesso adicional, somente leitura,
-- ao histórico de sorteios do órgão autorizado.
alter table public.permissoes_usuario
  drop constraint if exists permissoes_usuario_papel_check;
alter table public.permissoes_usuario
  add constraint permissoes_usuario_papel_check
  check (papel in ('operador', 'admin', 'consulta', 'consulta_historico'));

-- Esta porta continua exclusiva das operações plenas, inclusive INSERTs e
-- julgados. Uma lista positiva impede que papéis futuros ganhem escrita.
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
       and p.papel in ('operador', 'admin')
  )
$$;

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
       and p.papel in ('operador', 'admin', 'consulta_historico')
  )
$$;

revoke all on function public.tem_acesso_historico(text)
  from public, anon, service_role;
grant execute on function public.tem_acesso_historico(text) to authenticated;

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
     and p.papel in ('consulta', 'consulta_historico')
   order by p.orgao
$$;

create or replace function public.meta_45_exigir(p_orgao text)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or nullif(public.auth_email(), '') is null then
    raise exception 'autenticacao exigida' using errcode = '28000';
  end if;

  if coalesce(p_orgao, '') not in ('CJ', 'CREG') then
    raise exception 'colegiado desconhecido: %', p_orgao using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.permissoes_usuario p
     where p.user_id = (select auth.uid())
       and p.orgao = p_orgao
       and p.papel in ('admin', 'consulta', 'consulta_historico')
  ) then
    raise exception 'acesso a meta 45 do orgao % nao autorizado', p_orgao
      using errcode = '42501';
  end if;
end;
$$;

-- As duas RPCs de histórico mantêm seu corpo e seus grants; só o porteiro
-- muda. Falhar se alguma assinatura ou chamada mudou evita abrir outra rota.
do $$
declare
  alvo regprocedure;
  antes text;
  depois text;
begin
  foreach alvo in array array[
    'public.historico_sorteios(text)'::regprocedure,
    'public.processos_sorteio(text, date, timestamptz)'::regprocedure
  ] loop
    antes := pg_get_functiondef(alvo);
    depois := replace(antes,
      'public.tem_acesso_orgao(p_colegiado)',
      'public.tem_acesso_historico(p_colegiado)');
    if depois = antes then
      raise exception '% nao chama tem_acesso_orgao(p_colegiado)', alvo;
    end if;
    execute depois;
  end loop;
end
$$;
