-- Banco do Sorteio de Processos SEI (Supabase / PostgreSQL).
-- Rode este script no SQL Editor do projeto Supabase.
-- Uma linha por processo sorteado — equivale às planilhas CSV que o sistema gerava.

create table if not exists public.processos_sorteados (
  id                bigint generated always as identity primary key,
  criado_em         timestamptz not null default now(),
  modo              text        not null check (modo in ('CREG', 'CJ')),
  data_hora         timestamptz not null,
  ordem             int         not null,
  num_processo      text        not null,
  interessado       text        not null,
  assunto           text        not null,
  data_distribuicao date        not null,
  recurso           text        not null,
  unidade           text        not null
);

create index if not exists idx_processos_sorteados_modo_data
  on public.processos_sorteados (modo, data_hora desc);

alter table public.processos_sorteados enable row level security;

-- Duas camadas de proteção:
--
-- 1. Somente INSERT. O site acrescenta registros, mas não pode ler, alterar nem
--    apagar um sorteio já gravado. Consultas e relatórios são feitos pelo painel
--    do Supabase, nunca pelo navegador.
-- 2. Somente autenticado. A chave publicável fica visível no index.js (o
--    repositório é aberto para auditoria), então ela sozinha não basta: é preciso
--    ter feito login com um usuário cadastrado em Authentication → Users.
--
-- IMPORTANTE: com esta política, é obrigatório desativar o cadastro público em
-- Authentication → Providers → Email → "Enable sign ups". Caso contrário qualquer
-- visitante criaria a própria conta e passaria a poder inserir.
drop policy if exists "front pode inserir" on public.processos_sorteados;
create policy "usuario autenticado pode inserir"
  on public.processos_sorteados
  for insert
  to authenticated
  with check (true);
