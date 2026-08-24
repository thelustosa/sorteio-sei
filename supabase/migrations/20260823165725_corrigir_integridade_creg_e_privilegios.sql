-- Protege gravações novas antes de limpar o legado; NOT VALID aceita a base
-- existente sem abrir uma janela para novos processos fora do padrão.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.processos_sorteados'::regclass
       and conname = 'processos_sorteados_num_processo_15_digitos'
  ) then
    alter table public.processos_sorteados
      add constraint processos_sorteados_num_processo_15_digitos
      check (num_processo ~ '^[0-9]{15}$') not valid;
  end if;
end
$$;

-- Os dois únicos registros fora do padrão eram testes sem vínculos. Não há
-- número oficial a inferir: removê-los é a única correção segura.
delete from public.processos_sorteados
 where modo = 'CREG'
   and data_distribuicao = date '2026-08-20'
   and (
     (num_processo = '123421' and unidade = 'CREG2' and recurso = 'Com recurso')
     or
     (num_processo = '1234' and unidade = 'CREG3' and recurso = 'Sem recurso')
   );

alter table public.processos_sorteados
  validate constraint processos_sorteados_num_processo_15_digitos;

create unique index if not exists ux_processos_sorteados_distribuicao
  on public.processos_sorteados
  (modo, num_processo, data_distribuicao, unidade);

insert into public.pautas_cj (url, titulo, numero, data_sessao, sha256)
values ('marco:inicio-da-serie', 'Início da série', 0, date '2026-06-18', 'marco')
on conflict (url) do update
set titulo = excluded.titulo,
    numero = excluded.numero,
    data_sessao = excluded.data_sessao,
    sha256 = excluded.sha256;

create or replace function public.julgados_cj_derivar_do_acervo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origem public.acervo_cj%rowtype;
begin
  if new.data_distribuicao is not null then
    select * into origem
      from public.acervo_cj
     where num_processo = new.num_processo
       and data_distribuicao = new.data_distribuicao
     order by id
     limit 1;
  else
    select * into origem
      from public.acervo_cj
     where num_processo = new.num_processo
       and data_distribuicao <= new.data_sessao
     order by data_distribuicao desc, id desc
     limit 1;
    if origem.id is null then
      select * into origem
        from public.acervo_cj
       where num_processo = new.num_processo
       order by data_distribuicao, id
       limit 1;
    end if;
  end if;

  new.acervo_id         := origem.id;
  new.relator           := coalesce(new.relator, origem.relator);
  new.defesa            := coalesce(new.defesa, origem.defesa);
  new.data_distribuicao := coalesce(new.data_distribuicao, origem.data_distribuicao);
  return new;
end;
$$;

revoke all on function public.julgados_cj_derivar_do_acervo()
  from public, anon, authenticated;

create or replace function public.auth_email()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
$$;

revoke all on function public.auth_email() from public, anon, authenticated;

create or replace function public.registrar_votos(itens jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  quem     text := nullif(public.auth_email(), '');
  invalido int;
  gravados int;
begin
  if (select auth.uid()) is null or quem is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if jsonb_typeof(itens) is distinct from 'array' then
    raise exception 'registrar_votos espera uma lista de itens';
  end if;

  select count(*) into invalido
    from jsonb_array_elements(itens) i
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or nullif(i ->> 'voto', '')   not in ('Manter', 'Anular', 'Vista')
      or nullif(i ->> 'status', '') not in ('Julgado', 'Retornou', 'Retirado', 'Vista');

  if invalido > 0 then
    raise exception 'id, voto ou status fora do permitido (% item(ns))', invalido;
  end if;

  update public.julgados_cj j
     set voto           = nullif(i ->> 'voto', ''),
         status         = nullif(i ->> 'status', ''),
         atualizado_em  = now(),
         atualizado_por = quem
    from jsonb_array_elements(itens) i
   where j.id = (i ->> 'id')::bigint
     and (j.voto is null or j.status is null or j.atualizado_em is not null);

  get diagnostics gravados = row_count;
  return gravados;
end;
$$;

revoke all on function public.registrar_votos(jsonb)
  from public, anon, service_role;
grant execute on function public.registrar_votos(jsonb) to authenticated;

revoke all privileges on table public.processos_sorteados, public.acervo_cj,
                               public.julgados_cj, public.pautas_cj
  from anon, authenticated;
revoke all privileges on sequence public.processos_sorteados_id_seq,
                                  public.acervo_cj_id_seq,
                                  public.julgados_cj_id_seq,
                                  public.pautas_cj_id_seq
  from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant insert on public.processos_sorteados to authenticated;
grant insert on public.acervo_cj to authenticated;
grant select on public.julgados_cj to authenticated;
grant usage on sequence public.processos_sorteados_id_seq,
                        public.acervo_cj_id_seq
  to authenticated;
