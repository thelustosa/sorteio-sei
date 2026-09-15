
-- ── Câmara · número de processo com 15 dígitos ──────────────────────────────
-- Paridade com o Conselho: acervo_creg e julgados_creg recusam processo fora do
-- padrão SEI desde o CREATE TABLE, e as tabelas da Câmara não recusavam. O
-- navegador barrava (index.js), mas acervo_cj aceita INSERT direto de quem tem
-- acesso à CJ — um POST no PostgREST gravava 'ABC' sem passar pela tela.
--
-- Sem NOT VALID: em 15/09/2026 nenhuma linha de acervo_cj (194), julgados_cj
-- (223) ou do backup_cj (3.199 e 3.144) fugia do padrão, então a validação
-- alcança a base inteira de uma vez. O drop/add deixa o arquivo repetível.
--
-- O relator fica sem restrição de formato de propósito: o histórico em
-- backup_cj e a importação da planilha guardam pelo nome os conselheiros que
-- não estão em cadeiras_cj (ver FLUXO-CJ.md, "Fronteira conhecida").
--
-- admin_corrigir_processo_cj só troca o comentário que dizia que a Câmara não
-- tinha o check; a lógica é a mesma.

alter table public.acervo_cj
  drop constraint if exists acervo_cj_num_processo_check;
alter table public.acervo_cj
  add constraint acervo_cj_num_processo_check check (num_processo ~ '^[0-9]{15}$');

alter table public.julgados_cj
  drop constraint if exists julgados_cj_num_processo_check;
alter table public.julgados_cj
  add constraint julgados_cj_num_processo_check check (num_processo ~ '^[0-9]{15}$');

create or replace function public.admin_corrigir_processo_cj(
  p_num_atual text, p_num_novo text, p_escopo text default 'tudo',
  p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha_a public.acervo_cj%rowtype;
  linha_j public.julgados_cj%rowtype;
  nova_j  public.julgados_cj%rowtype;
  acervo        bigint[] := '{}';
  julgados      bigint[] := '{}';
  desvinculados bigint[] := '{}';
  encontrados int;
begin
  perform public.admin_exigir('CJ');

  -- acervo_cj e julgados_cj também recusam número fora dos 15 dígitos, mas com o
  -- erro cru da restrição; a porta valida antes, com a mensagem pensada para a
  -- tela.
  if coalesce(p_num_atual, '') !~ '^[0-9]{15}$'
     or coalesce(p_num_novo, '') !~ '^[0-9]{15}$' then
    raise exception 'numero de processo fora do padrao (15 digitos)' using errcode = '22023';
  end if;

  if p_num_atual = p_num_novo then
    raise exception 'o numero novo e igual ao atual' using errcode = '22023';
  end if;

  if coalesce(p_escopo, '') not in ('tudo', 'acervo', 'julgados') then
    raise exception 'escopo desconhecido: %', p_escopo using errcode = '22023';
  end if;

  select count(*) into encontrados from (
    select 1 from public.acervo_cj a where a.num_processo = p_num_atual
     union all
    select 1 from public.julgados_cj j where j.num_processo = p_num_atual) t;
  if encontrados = 0 then
    raise exception 'processo % nao encontrado', p_num_atual using errcode = '22023';
  end if;

  if p_escopo in ('tudo', 'acervo') then
    for linha_a in
      select * from public.acervo_cj a where a.num_processo = p_num_atual
       order by a.id for update
    loop
      begin
        update public.acervo_cj a set num_processo = p_num_novo where a.id = linha_a.id;
      exception when unique_violation then
        raise exception 'ja existe esta distribuicao com o numero %', p_num_novo
          using errcode = '23505';
      end;
      perform public.auditar('CJ', 'corrigir_processo', 'acervo_cj', linha_a.id,
        jsonb_build_object('num_processo', p_num_atual),
        jsonb_build_object('num_processo', p_num_novo), p_motivo);
      acervo := acervo || linha_a.id;
    end loop;
  end if;

  if p_escopo in ('tudo', 'julgados') then
    for linha_j in
      select * from public.julgados_cj j where j.num_processo = p_num_atual
       order by j.id for update
    loop
      begin
        update public.julgados_cj j set num_processo = p_num_novo where j.id = linha_j.id
        returning * into nova_j;
      exception when unique_violation then
        raise exception 'ja existe julgado deste processo nessa sessao' using errcode = '23505';
      end;
      perform public.auditar('CJ', 'corrigir_processo', 'julgados_cj', linha_j.id,
        jsonb_build_object('num_processo', p_num_atual, 'acervo_id', linha_j.acervo_id),
        jsonb_build_object('num_processo', p_num_novo, 'acervo_id', nova_j.acervo_id),
        p_motivo);
      julgados := julgados || linha_j.id;
      -- Com escopo 'julgados' nenhuma linha do acervo carrega o número novo, e o
      -- gatilho DERRUBA o vínculo — o que é a verdade do que ficou, mas era
      -- verdade só no rastro: `desvinculados` voltava vazio e o painel não tinha
      -- o que avisar. Com 'tudo' o acervo foi renumerado antes e o vínculo se
      -- mantém, então este ramo não acrescenta nada lá.
      if nova_j.acervo_id is null and linha_j.acervo_id is not null then
        desvinculados := desvinculados || linha_j.id;
      end if;
    end loop;
  elsif p_escopo = 'acervo' then
    -- Sem renumerar os julgados, o vínculo passaria a apontar para um processo
    -- DIFERENTE — o ERRO "Julgado apontando para processo diferente no acervo"
    -- de verificacao_cj.sql. Tocar num_processo com o mesmo valor redispara o
    -- gatilho, que rederiva e DERRUBA o vínculo em vez de deixá-lo mentir.
    -- Julgado sem acervo é apenas AVISO, e é a verdade do que ficou.
    for linha_j in
      select * from public.julgados_cj j where j.acervo_id = any (acervo)
       order by j.id for update
    loop
      update public.julgados_cj j set num_processo = j.num_processo where j.id = linha_j.id
      returning * into nova_j;
      if nova_j.acervo_id is distinct from linha_j.acervo_id then
        perform public.auditar('CJ', 'corrigir_processo', 'julgados_cj', linha_j.id,
          jsonb_build_object('acervo_id', linha_j.acervo_id),
          jsonb_build_object('acervo_id', nova_j.acervo_id), p_motivo);
        desvinculados := desvinculados || linha_j.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'num_processo', jsonb_build_object('antes', p_num_atual, 'depois', p_num_novo),
    'acervo', to_jsonb(acervo), 'julgados', to_jsonb(julgados),
    'desvinculados', to_jsonb(desvinculados));
end;
$$;
