-- Issue #77, item 03: o sorteio gravado com sessão é conferido pelo banco.
--
-- O INSERT no acervo vem da API REST, e a política só exigia o órgão e a
-- origem 'sorteio'. Quem tem papel de operador conseguia gravar cadeira
-- inexistente, texto sem limite, ordem negativa e — o pior — uma rodada com
-- criado_em e sorteado_em de qualquer data, que o histórico mostraria como
-- sorteio de verdade. O gatilho de autoria, que já roda em todo INSERT dos dois
-- acervos, passa a conferir esses campos. Linhas antigas não são tocadas.
--
-- O motivo do painel administrativo ganha o mesmo limite do campo da tela.

create or replace function public.acervo_registrar_autor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  usuario uuid := (select auth.uid());
  agora   timestamptz := now();
begin
  new.criado_por := case when usuario is not null then
    coalesce(nullif(public.auth_email(), ''),
             nullif((select u.email from auth.users u where u.id = usuario), ''),
             usuario::text)
  end;

  -- O papel, e não o token: a API REST sempre grava como `authenticated`, e é
  -- dela que se desconfia. Função do banco e importação rodam como dono.
  if current_setting('role', true) is distinct from 'authenticated'
     or new.origem is distinct from 'sorteio' then
    return new;
  end if;

  new.criado_em := agora;
  new.sorteado_em := coalesce(new.sorteado_em, agora);
  -- Uma hora para trás cobre a renovação do token e a rede lenta entre o
  -- sorteio na tela e a gravação; cinco minutos para frente, o relógio da
  -- máquina adiantado.
  if new.sorteado_em not between agora - interval '1 hour' and agora + interval '5 minutes' then
    raise exception 'horario do sorteio fora do permitido: %', new.sorteado_em
      using errcode = '22023';
  end if;
  -- A data vem do relógio local da tela, que pode estar um dia à frente do UTC.
  if abs(new.data_distribuicao - (new.sorteado_em at time zone 'America/Sao_Paulo')::date) > 1 then
    raise exception 'data de distribuicao % nao e a do sorteio', new.data_distribuicao
      using errcode = '22023';
  end if;
  if new.ordem is not null and new.ordem <= 0 then
    raise exception 'ordem invalida: %', new.ordem using errcode = '22023';
  end if;
  if char_length(new.assunto) > 100 or char_length(new.recurso) > 100 then
    raise exception 'assunto ou recurso longo demais' using errcode = '22023';
  end if;

  if tg_table_name = 'acervo_cj' then
    if not exists (select 1 from public.cadeiras_cj c
                    where c.cadeira = new.relator and c.ate is null) then
      raise exception 'cadeira invalida: %', new.relator using errcode = '22023';
    end if;
    if new.assunto is distinct from 'Auto de Infração' then
      raise exception 'na CJ o assunto e sempre Auto de Infracao' using errcode = '22023';
    end if;
  elsif char_length(new.interessado) > 300 then
    raise exception 'interessado longo demais (maximo 300 caracteres)' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function public.acervo_registrar_autor()
  from public, anon, authenticated, service_role;

alter table public.auditoria_admin drop constraint if exists auditoria_admin_motivo_tamanho;
alter table public.auditoria_admin add constraint auditoria_admin_motivo_tamanho
  check (char_length(motivo) <= 200);
