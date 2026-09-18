-- ── Painel administrativo · processos por trás da meta de 45 dias ───────────
-- Cada contagem da aba Meta 45 abre o card com os julgados dela. A função
-- devolve o período inteiro, com meta_45, e o painel recorta dentro, fora e sem
-- prazo aferível: as quatro colunas da linha saem da mesma resposta, e a regra
-- da meta continua morando só na coluna calculada.

create or replace function public.admin_meta_45_processos(p_colegiado text, p_de date, p_ate date)
returns table (num_processo text, destino text, data_distribuicao date, data_sessao date,
               dias int, meta_45 boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_exigir(p_colegiado);

  -- Mesmo recorte de admin_meta_45 (status 'Julgado', período pela sessão):
  -- se os dois divergirem, o card abre um número diferente do que a célula
  -- mostrava. Os mais atrasados primeiro, que é o que se procura na lista.
  return query
  select j.num_processo, j.relator, j.data_distribuicao, j.data_sessao, j.dias_dt, j.meta_45
    from public.julgados_cj j
   where p_colegiado = 'CJ' and j.status = 'Julgado'
     and j.data_sessao between p_de and p_ate
   union all
  select k.num_processo, k.unidade, k.data_distribuicao, k.data_sessao, k.dias_dt, k.meta_45
    from public.julgados_creg k
   where p_colegiado = 'CREG' and k.status = 'Julgado'
     and k.data_sessao between p_de and p_ate
   order by 5 desc nulls last, 1;
end;
$$;

revoke all on function public.admin_meta_45_processos(text, date, date) from public, anon, service_role;
grant execute on function public.admin_meta_45_processos(text, date, date) to authenticated;
