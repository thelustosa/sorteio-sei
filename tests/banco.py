"""Postgres descartável em container, para os testes.

É o mesmo motor do Supabase, com os papéis (anon/authenticated/service_role)
que as políticas de RLS do schema.sql esperam encontrar.
"""

import subprocess
import time
from pathlib import Path

import psycopg2

IMAGEM = 'postgres:15-alpine'


def docker(*args):
    return subprocess.run(['docker', *args], capture_output=True, text=True)


def uma(cur, sql, args=None):
    """Executa e devolve o valor único (ou a linha, se houver mais colunas)."""
    cur.execute(sql, args)
    linha = cur.fetchone()
    return linha[0] if linha and len(linha) == 1 else linha


class Postgres:
    def __init__(self, nome, porta):
        self.nome = nome
        self.porta = porta
        self.dsn = f'host=localhost port={porta} dbname=cj user=postgres password=postgres'

    def subir(self):
        docker('rm', '-f', self.nome)
        r = docker('run', '-d', '--rm', '--name', self.nome,
                   '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=cj',
                   '-p', f'{self.porta}:5432', IMAGEM)
        if r.returncode:
            raise SystemExit(f'docker run falhou: {r.stderr}')

        for _ in range(60):
            try:
                psycopg2.connect(self.dsn).close()
                break
            except psycopg2.OperationalError:
                time.sleep(1)
        else:
            raise SystemExit('Postgres não subiu a tempo.')

        self.executar('create role anon; create role authenticated; create role service_role;')
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
