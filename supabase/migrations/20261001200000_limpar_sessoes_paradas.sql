-- Issue #77, item 14: sessão parada há mais de 30 dias cai.
--
-- O Supabase não expira sessão sozinho, e o plano Free não oferece o prazo no
-- painel. Cada aba fechada sem "Sair" deixava um refresh token válido para
-- sempre: em 01/10/2026 eram 174 sessões vivas para 8 usuários, 96 delas
-- paradas havia mais de 30 dias. Quem marcou "Lembrar-me" e passa 30 dias sem
-- abrir o sistema entra de novo; quem usa, renova a sessão e nem percebe.
--
-- updated_at acompanha cada renovação do token (conferido contra refreshed_at,
-- que é timestamp sem fuso). Apagar a sessão leva junto os refresh tokens dela.
--
-- O Postgres dos testes não tem pg_cron: lá o bloco só avisa e sai.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or to_regclass('auth.sessions') is null then
    raise notice 'pg_cron ou auth.sessions indisponível: limpeza de sessões não agendada';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;

  -- Nome fixo: agendar de novo com o mesmo nome atualiza o job em vez de
  -- duplicá-lo.
  perform cron.schedule('limpar-sessoes-paradas', '17 6 * * *', $job$
    delete from auth.sessions
     where coalesce(updated_at, created_at) < now() - interval '30 days'
  $job$);

  -- As que já passaram do prazo não esperam a primeira rodada.
  delete from auth.sessions
   where coalesce(updated_at, created_at) < now() - interval '30 days';
end $$;
