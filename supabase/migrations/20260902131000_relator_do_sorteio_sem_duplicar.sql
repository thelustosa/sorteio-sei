-- O relator na ata do sorteio da Câmara sai uma vez só, sempre.
--
-- processos_sorteio traduz a cadeira (CJ1..CJ5) no nome de quem a ocupava NA
-- DATA do sorteio, e fazia isso com um join comum sobre o período de
-- cadeiras_cj. Mas a tabela não impede dois períodos que cubram a mesma data:
-- a chave primária é (cadeira, desde) e o índice único ux_cadeiras_cj_vigente
-- só alcança o período em aberto (`ate is null`). Com dois intervalos fechados
-- sobrepostos — uma correção de composição registrada sem fechar a linha
-- anterior, por exemplo — todo processo daquela cadeira saía DUPLICADO no card
-- do histórico e na ata .docx que ele exporta.
--
-- O lateral abaixo devolve no máximo uma linha por processo, sem depender de a
-- tabela estar limpa. Escolhe o período que começou por último até a data do
-- sorteio, que é o que vigorava nela.
--
-- Só troca o corpo de uma função de LEITURA: mesma assinatura, mesmo retorno,
-- mesmos privilégios. Nenhuma tabela, coluna, política ou grant muda, e a
-- migração é repetível.

create or replace function public.processos_sorteio(
  p_colegiado   text,
  p_data        date,
  p_sorteado_em timestamptz default null
)
returns table (
  ordem        int,
  num_processo text,
  destino      text,
  responsavel  text,
  assunto      text,
  decisao      text,
  interessado  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  marco constant date := public.historico_marco();
begin
  if (select auth.uid()) is null then
    raise exception 'autenticação exigida' using errcode = '28000';
  end if;

  if coalesce(p_colegiado, '') not in ('CJ', 'CREG') then
    raise exception 'colegiado desconhecido: %', p_colegiado using errcode = '22023';
  end if;

  return query
  select a.ordem,
         a.num_processo,
         a.relator,
         -- O ocupante da cadeira NA DATA do sorteio, não o de hoje: histórico
         -- que reescreve o relator a cada mudança de composição deixa de ser
         -- histórico. Cadeira sem de-para no período sai pelo próprio rótulo.
         coalesce(c.conselheiro, a.relator),
         a.assunto,
         -- Na Câmara a coluna é a DEFESA, booleana. O texto em `recurso` é o
         -- legado da época em que a CJ dividia a tabela com o Conselho: sai
         -- como está, porque relê-lo como defesa inventaria a decisão. E
         -- defesa nula tem de cair nesse legado, não virar 'Não'.
         case when a.defesa is null then a.recurso
              when a.defesa        then 'Sim'
              else 'Não' end,
         null::text
    from public.acervo_cj a
    -- Uma cadeira pode ter mais de um período cobrindo a mesma data: a chave
    -- primária é (cadeira, desde) e o índice único só cobre o período EM
    -- ABERTO, então dois intervalos fechados que se sobrepõem entram sem erro
    -- nenhum. Num join comum, cada processo daquela cadeira sairia repetido —
    -- na lista do card e na ata exportada, que a lista alimenta.
    --
    -- O lateral devolve no máximo uma linha, sempre: o período que começou por
    -- último até a data do sorteio, que é o que vigorava nela.
    left join lateral (
      select cc.conselheiro
        from public.cadeiras_cj cc
       where cc.cadeira = a.relator
         and a.data_distribuicao >= cc.desde
         and (cc.ate is null or a.data_distribuicao <= cc.ate)
       order by cc.desde desc
       limit 1
    ) c on true
   where p_colegiado = 'CJ'
     and a.data_distribuicao = p_data
     and a.sorteado_em is not distinct from p_sorteado_em
     and a.origem = 'sorteio'
     and a.data_distribuicao >= marco
   union all
  select b.ordem, b.num_processo, b.unidade, null::text,
         b.assunto, b.recurso, b.interessado
    from public.acervo_creg b
   where p_colegiado = 'CREG'
     and b.data_distribuicao = p_data
     and b.sorteado_em is not distinct from p_sorteado_em
     and b.origem = 'sorteio'
     and b.data_distribuicao >= marco
   -- A ordem do sorteio é a da ata. Linha sem ordem — gravação que não a
   -- registrou — vai para o fim, com o número do processo como desempate
   -- estável.
   order by 1 nulls last, 2;
end;
$$;

revoke all on function public.processos_sorteio(text, date, timestamptz)
  from public, anon, service_role;
grant execute on function public.processos_sorteio(text, date, timestamptz) to authenticated;
