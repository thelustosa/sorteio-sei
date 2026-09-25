-- ── Processos que voltaram ao acervo por Vista ─────────────────────────────
-- O card do painel pinta o número desses processos e mostra, no hover, a
-- unidade ou cadeira de antes da Vista (a do julgado que criou o retorno).
-- Função à parte, e não coluna nova em processos_acervo_*: mudar o retorno
-- delas quebraria a reaplicação das migrações antigas, que as recriam sem drop.
--
-- Só entra o processo PENDENTE cuja distribuição mais recente é o retorno de
-- uma Vista — a mesma linha que processos_acervo_* mostra (mesmo distinct on,
-- mesma definição de pendente). Assim uma distribuição posterior no mesmo dia
-- não herda o destaque, e a resposta tem o tamanho da fila atual, não o do
-- histórico inteiro de Vistas.
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
  with ultima_cj as (
    select distinct on (a.num_processo)
           a.num_processo, a.data_distribuicao, a.retorno_julgado_id
      from public.acervo_cj a
     where p_colegiado = 'CJ'
     order by a.num_processo, a.data_distribuicao desc, a.id desc
  ),
  ultima_creg as (
    select distinct on (b.num_processo)
           b.num_processo, b.data_distribuicao, b.retorno_julgado_id
      from public.acervo_creg b
     where p_colegiado = 'CREG'
     order by b.num_processo, b.data_distribuicao desc, b.id desc
  )
  -- Na Câmara a cadeira vem com quem a ocupa hoje, como no resto do painel.
  select u.num_processo, u.data_distribuicao, j.relator, c.conselheiro
    from ultima_cj u
    join public.julgados_cj j on j.id = u.retorno_julgado_id
    left join public.cadeiras_cj c on c.cadeira = j.relator and c.ate is null
   where j.voto = 'Vista'
     and not exists (select 1 from public.julgados_cj x
                      where x.num_processo = u.num_processo
                        and x.data_sessao >= u.data_distribuicao
                        and x.id is distinct from u.retorno_julgado_id)
   union all
  select u.num_processo, u.data_distribuicao, k.unidade, null::text
    from ultima_creg u
    join public.julgados_creg k on k.id = u.retorno_julgado_id
   where k.voto = 'Vista'
     and not exists (select 1 from public.julgados_creg x
                      where x.num_processo = u.num_processo
                        and x.data_sessao >= u.data_distribuicao
                        and x.id is distinct from u.retorno_julgado_id);
end;
$$;

revoke all on function public.retornos_de_vista(text) from public, anon, service_role;
grant execute on function public.retornos_de_vista(text) to authenticated;
