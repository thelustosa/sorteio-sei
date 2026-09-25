-- ── Processos que voltaram ao acervo por Vista ─────────────────────────────
-- O card do painel pinta o número desses processos e mostra, no hover, a
-- unidade ou cadeira de antes da Vista (a do julgado que criou o retorno).
-- Função à parte, e não coluna nova em processos_acervo_*: mudar o retorno
-- delas quebraria a reaplicação das migrações antigas, que as recriam sem drop.
-- A tela casa pelo par (num_processo, data_distribuicao), que identifica a
-- distribuição mostrada na linha.
create or replace function public.retornos_de_vista(p_colegiado text)
returns table (num_processo text, data_distribuicao date, destino_anterior text,
               conselheiro_anterior text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if p_colegiado not in ('CJ', 'CREG')
     or not (select public.tem_acesso_orgao(p_colegiado)) then
    raise exception 'acesso ao orgao % nao autorizado', p_colegiado using errcode = '42501';
  end if;

  return query
  -- Na Câmara a cadeira vem com quem a ocupa hoje, como no resto do painel.
  select a.num_processo, a.data_distribuicao, j.relator, c.conselheiro
    from public.acervo_cj a
    join public.julgados_cj j on j.id = a.retorno_julgado_id
    left join public.cadeiras_cj c on c.cadeira = j.relator and c.ate is null
   where p_colegiado = 'CJ' and j.voto = 'Vista'
   union all
  select b.num_processo, b.data_distribuicao, k.unidade, null::text
    from public.acervo_creg b
    join public.julgados_creg k on k.id = b.retorno_julgado_id
   where p_colegiado = 'CREG' and k.voto = 'Vista';
end;
$$;

revoke all on function public.retornos_de_vista(text) from public, anon, service_role;
grant execute on function public.retornos_de_vista(text) to authenticated;
