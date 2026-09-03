create table if not exists public.permissoes_usuario (
  user_id uuid not null references auth.users(id) on delete cascade,
  orgao text not null check (orgao in ('CJ', 'CREG')),
  primary key (user_id, orgao)
);

alter table public.permissoes_usuario enable row level security;

drop policy if exists "usuario le as proprias permissoes"
  on public.permissoes_usuario;
create policy "usuario le as proprias permissoes"
  on public.permissoes_usuario for select to authenticated
  using (user_id = (select auth.uid()));

revoke all privileges on table public.permissoes_usuario
  from anon, authenticated;
grant select on public.permissoes_usuario to authenticated;

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
  )
$$;

create or replace function public.orgaos_autorizados()
returns table (orgao text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.orgao
    from public.permissoes_usuario p
   where p.user_id = (select auth.uid())
   order by p.orgao
$$;

revoke all on function public.tem_acesso_orgao(text)
  from public, anon, service_role;
revoke all on function public.orgaos_autorizados()
  from public, anon, service_role;
grant execute on function public.tem_acesso_orgao(text) to authenticated;
grant execute on function public.orgaos_autorizados() to authenticated;

do $$
declare
  ausentes text[];
begin
  select array_agg(e.email order by e.email)
    into ausentes
    from (values
      ('alberto.estrela@goias.gov.br'),
      ('terezinha.bueno@goias.gov.br'),
      ('lucas.coelho@goias.gov.br'),
      ('sec-agr@goias.gov.br')
    ) e(email)
   where not exists (
     select 1 from auth.users u where lower(u.email) = e.email
   );

  if cardinality(ausentes) > 0 then
    raise exception 'usuarios ausentes para permissoes: %', ausentes;
  end if;
end
$$;

insert into public.permissoes_usuario (user_id, orgao)
select u.id, x.orgao
  from (values
    ('alberto.estrela@goias.gov.br', 'CREG'),
    ('terezinha.bueno@goias.gov.br', 'CJ'),
    ('lucas.coelho@goias.gov.br', 'CJ'),
    ('lucas.coelho@goias.gov.br', 'CREG'),
    ('sec-agr@goias.gov.br', 'CJ'),
    ('sec-agr@goias.gov.br', 'CREG')
  ) x(email, orgao)
  join auth.users u on lower(u.email) = x.email
on conflict (user_id, orgao) do nothing;
