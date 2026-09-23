"""Postgres descartável em container, para os testes.

É o mesmo motor do Supabase, com os papéis (anon/authenticated/service_role)
que as políticas de RLS do schema.sql esperam encontrar.
"""

import subprocess
import time
from pathlib import Path
from typing import Any

import psycopg2

IMAGEM = 'postgres:15-alpine'


def docker(*args):
    return subprocess.run(['docker', *args], capture_output=True, text=True)


def uma(cur, sql, args=None) -> Any:
    """Executa e devolve o valor único (ou a linha, se houver mais colunas)."""
    cur.execute(sql, args)
    linha = cur.fetchone()
    return linha[0] if linha and len(linha) == 1 else linha


class Postgres:
    def __init__(self, nome):
        self.nome = nome
        self.dsn = None

    def subir(self):
        docker('rm', '-f', self.nome)
        # Porta escolhida pelo docker: porta fixa no intervalo efêmero do kernel
        # colide de vez em quando com uma conexão de saída do próprio runner.
        r = docker('run', '-d', '--rm', '--name', self.nome,
                   '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=cj',
                   '-p', '5432', IMAGEM)
        if r.returncode:
            raise SystemExit(f'docker run falhou: {r.stderr}')

        publicada = docker('port', self.nome, '5432/tcp')
        if publicada.returncode or not publicada.stdout.strip():
            raise SystemExit(f'docker port falhou: {publicada.stderr}')
        self.porta = publicada.stdout.split()[0].rsplit(':', 1)[-1]
        self.dsn = f'host=localhost port={self.porta} dbname=cj user=postgres password=postgres'

        for _ in range(60):
            try:
                psycopg2.connect(self.dsn).close()
                break
            except psycopg2.OperationalError:
                time.sleep(1)
        else:
            raise SystemExit('Postgres não subiu a tempo.')

        self.executar("""create role anon; create role authenticated; create role service_role;
                        create schema auth;
                        create table auth.users (
                          id uuid primary key,
                          email text not null unique
                        );
                        insert into auth.users (id, email) values
                          ('00000000-0000-0000-0000-000000000001', 'secretaria@goias.gov.br'),
                          ('00000000-0000-0000-0000-000000000011', 'alberto.estrela@goias.gov.br'),
                          ('00000000-0000-0000-0000-000000000012', 'terezinha.bueno@goias.gov.br'),
                          ('00000000-0000-0000-0000-000000000013', 'lucas.coelho@goias.gov.br'),
                          ('00000000-0000-0000-0000-000000000014', 'sec-agr@goias.gov.br'),
                          ('00000000-0000-0000-0000-000000000015', 'sem-acesso@goias.gov.br');
                        create function auth.uid() returns uuid language sql stable
                        set search_path = '' as $$
                          select (nullif(current_setting('request.jwt.claims', true), '')::jsonb
                                  ->> 'sub')::uuid
                        $$;""")
        self.executar('grant usage on schema auth to authenticated')
        return self

    def derrubar(self):
        docker('rm', '-f', self.nome)

    def conectar(self):
        return psycopg2.connect(self.dsn)

    def executar(self, sql):
        with psycopg2.connect(self.dsn) as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(sql)

    def rodar_arquivo(self, caminho):
        self.executar(Path(caminho).read_text(encoding='utf-8'))
