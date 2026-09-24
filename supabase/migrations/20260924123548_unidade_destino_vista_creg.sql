-- Unidade escolhida para o voto Vista, preservada no julgamento para a futura
-- redistribuicao ao acervo. Registros historicos permanecem sem destino.
alter table public.julgados_creg add column if not exists unidade_vista text;
alter table public.julgados_creg drop constraint if exists julgados_creg_unidade_vista_valida;
alter table public.julgados_creg add constraint julgados_creg_unidade_vista_valida
  check (unidade_vista is null or
         (coalesce(voto, '') = 'Vista' and unidade_vista in ('CREG1', 'CREG2', 'CREG3', 'CREG4')));

create or replace function public.registrar_votos_creg(itens jsonb)
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

  if not (select public.tem_acesso_orgao('CREG')) then
    raise exception 'acesso ao orgao CREG nao autorizado' using errcode = '42501';
  end if;

  if jsonb_typeof(itens) is distinct from 'array' then
    raise exception 'registrar_votos_creg espera uma lista de itens';
  end if;

  select count(*) into invalido
    from jsonb_array_elements(itens) i
   -- Campo VAZIO é ausência de decisão, e é legítimo: processo retirado de
      -- pauta tem status e não tem voto. Recusa-se o rótulo PREENCHIDO fora da
      -- lista, não o campo em branco.
   where coalesce(i ->> 'id', '') !~ '^[0-9]+$'
      or (nullif(i ->> 'voto', '') is not null
          and nullif(i ->> 'voto', '') not in
              ('Manter', 'Anular', 'Aprovação', 'Indeferimento', 'Extinção',
               'Retirado', 'Vista'))
      or (nullif(i ->> 'status', '') is not null
          and nullif(i ->> 'status', '') not in
              ('Julgado', 'Retirado', 'Vista', 'Sobrestado', 'Prejudicado'))
      or (i ? 'unidade_vista' and i ->> 'unidade_vista' is not null
          and i ->> 'unidade_vista' not in ('CREG1', 'CREG2', 'CREG3', 'CREG4'));

  if invalido > 0 then
    raise exception 'id, voto, status ou unidade de vista fora do permitido (% item(ns))', invalido;
  end if;

  -- Só o que ainda está pendente, ou o que esta mesma página já preencheu antes
  -- (typo se corrige). O histórico que veio da planilha tem atualizado_em nulo
  -- e os dois campos preenchidos: fica intocável por aqui.
  --
  -- Campo em BRANCO não apaga o que já está gravado — daí o coalesce. Branco
  -- quer dizer "ainda não decidi", e a linha do histórico que tem voto e não
  -- tem status entra nesta fila justamente por isso: sem o coalesce, gravar a
  -- sessão inteira levaria o voto antigo junto, e a mesma porta aceitaria um
  -- POST de {"voto":"","status":""} para zerar uma decisão. Trocar um rótulo
  -- por outro continua funcionando; só apagar por aqui é que não.
  --
  -- Isso não tira nada da tela: a opção em branco do select é `disabled`, então
  -- a secretaria nunca pôde voltar um campo ao vazio. DESFAZER um registro é
  -- decisão administrativa, e vai ter porta própria — um painel de admin com
  -- permissão que a secretaria não tem. Enquanto ela não existe, o certo é a
  -- ausência da operação, não um branco que apaga em silêncio.
  -- Trava em ordem de id antes de comparar e atualizar. Duas transações
  -- concorrentes não podem validar a mesma fotografia e sobrescrever decisões.
  perform j.id from public.julgados_creg j
    where j.id in (select (i ->> 'id')::bigint from jsonb_array_elements(itens) i)
    order by j.id for update;

  if exists (
    select 1 from public.julgados_creg j
    join jsonb_array_elements(itens) i on j.id = (i ->> 'id')::bigint
    where (j.voto is null or j.status is null or j.atualizado_em is not null)
      and coalesce(nullif(i ->> 'voto', ''), j.voto) = 'Vista'
      and (case when i ? 'unidade_vista' then i ->> 'unidade_vista'
                else j.unidade_vista end) is null
  ) then
    raise exception 'Voto Vista exige unidade de destino (CREG1 a CREG4).'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.julgados_creg j
    join jsonb_array_elements(itens) i on j.id = (i ->> 'id')::bigint
    cross join (values ('voto'), ('status'), ('unidade_vista')) c(campo)
    where (j.voto is null or j.status is null or j.atualizado_em is not null)
      and (case when c.campo = 'unidade_vista' then i ? c.campo
                else nullif(i ->> c.campo, '') is not null end)
      and (i ->> c.campo) is distinct from (to_jsonb(j) ->> c.campo)
      and (
        -- Clientes antigos podem preencher vazios, mas não substituir uma
        -- decisão sem informar o valor anterior. Reenvio idêntico é seguro.
        (not coalesce((i -> 'anterior') ? c.campo, false)
          and (to_jsonb(j) ->> c.campo) is not null)
        or (coalesce((i -> 'anterior') ? c.campo, false)
          and nullif(i -> 'anterior' ->> c.campo, '')
              is distinct from (to_jsonb(j) ->> c.campo))
      )
  ) then
    raise exception 'Este julgamento foi alterado por outra pessoa. Suas escolhas foram preservadas; atualize a página para conferir os valores atuais antes de salvar.'
      using errcode = '40001';
  end if;

  update public.julgados_creg j
     set voto           = coalesce(nullif(i ->> 'voto', ''), j.voto),
         status         = coalesce(nullif(i ->> 'status', ''), j.status),
         unidade_vista  = case
                           when coalesce(nullif(i ->> 'voto', ''), j.voto) is distinct from 'Vista'
                             then null
                           when i ? 'unidade_vista' then i ->> 'unidade_vista'
                           else j.unidade_vista
                         end,
         atualizado_em  = now(),
         atualizado_por = quem
    from jsonb_array_elements(itens) i
   where j.id = (i ->> 'id')::bigint
     and (j.voto is null or j.status is null or j.atualizado_em is not null);

  get diagnostics gravados = row_count;
  return gravados;
end;
$$;

revoke all on function public.registrar_votos_creg(jsonb)
  from public, anon, service_role;
grant execute on function public.registrar_votos_creg(jsonb) to authenticated;
