-- O navegador só grava sorteio: declarar outra origem era o jeito de gravar
-- sem autor. Importações rodam por conexão direta; 'retorno' nasce dentro de
-- função do banco, que não passa por esta política.
drop policy if exists "usuario com acesso cj pode inserir" on public.acervo_cj;
create policy "usuario com acesso cj pode inserir"
  on public.acervo_cj for insert to authenticated
  with check ((select public.tem_acesso_orgao('CJ')) and origem = 'sorteio');

drop policy if exists "usuario com acesso creg pode inserir" on public.acervo_creg;
create policy "usuario com acesso creg pode inserir"
  on public.acervo_creg for insert to authenticated
  with check ((select public.tem_acesso_orgao('CREG')) and origem = 'sorteio');

-- Toda linha gravada com sessão leva o autor, qualquer que seja a origem.
-- Token sem e-mail não derruba o sorteio: cai para o cadastro e para o id.
create or replace function public.acervo_registrar_autor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  usuario uuid := (select auth.uid());
begin
  new.criado_por := case when usuario is not null then
    coalesce(nullif(public.auth_email(), ''),
             nullif((select u.email from auth.users u where u.id = usuario), ''),
             usuario::text)
  end;
  return new;
end;
$$;

revoke all on function public.acervo_registrar_autor()
  from public, anon, authenticated, service_role;

-- Quem passa a ser a lista de autores distintos do lote.
drop function if exists public.admin_sorteios(text);
create function public.admin_sorteios(p_colegiado text)
returns table (data_distribuicao date, sorteado_em timestamptz, origem text,
               processos int, destinos text[], quem text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  return query
  with linhas as (
    select a.data_distribuicao as dia, a.sorteado_em as carimbo,
           a.origem as fonte, a.relator as destino, a.criado_por as autor
      from public.acervo_cj a
     where p_colegiado = 'CJ'
    union all
    select b.data_distribuicao, b.sorteado_em, b.origem, b.unidade, b.criado_por
      from public.acervo_creg b
     where p_colegiado = 'CREG'
  ), por_destino as (
    select l.dia, l.carimbo, l.fonte, l.destino, l.autor, count(*)::int as qtd
      from linhas l
     group by l.dia, l.carimbo, l.fonte, l.destino, l.autor
  )
  select d.dia, d.carimbo, d.fonte, sum(d.qtd)::int,
         array_agg(distinct d.destino order by d.destino),
         array_agg(distinct d.autor order by d.autor) filter (where d.autor is not null)
    from por_destino d
   group by d.dia, d.carimbo, d.fonte
   order by 1 desc, 2 desc nulls last, 3;
end;
$$;

revoke all on function public.admin_sorteios(text) from public, anon, service_role;
grant execute on function public.admin_sorteios(text) to authenticated;
