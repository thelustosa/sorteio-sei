#!/usr/bin/env python3
"""Testes do modelo de permissões por órgão em Postgres de verdade."""

import json
import sys
from pathlib import Path

import psycopg2
from psycopg2.errors import InsufficientPrivilege

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

PG = banco.Postgres('sorteio_sei_acesso_test', 55435)

USUARIOS = {
    'alberto': '00000000-0000-0000-0000-000000000011',
    'terezinha': '00000000-0000-0000-0000-000000000012',
    'lucas': '00000000-0000-0000-0000-000000000013',
    'sec-agr': '00000000-0000-0000-0000-000000000014',
    'sem-acesso': '00000000-0000-0000-0000-000000000015',
}

testes = []


def teste(fn):
    testes.append(fn)
    return fn


def autenticar(cur, nome):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({'sub': USUARIOS[nome],
                             'role': 'authenticated',
                             'email': f'{nome}@goias.gov.br'}),))
    cur.execute('set local role authenticated')


def permissoes(cur):
    cur.execute('select orgao from public.orgaos_autorizados() order by orgao')
    return [linha[0] for linha in cur.fetchall()]


@teste
def matriz_de_permissoes(cur):
    for nome, esperado in {
        'alberto': ['CREG'],
        'terezinha': ['CJ'],
        'lucas': ['CJ', 'CREG'],
        'sec-agr': ['CJ', 'CREG'],
        'sem-acesso': [],
    }.items():
        autenticar(cur, nome)
        assert permissoes(cur) == esperado


@teste
def tem_acesso_orgao_respeita_a_identidade(cur):
    for nome, orgao, esperado in [
        ('alberto', 'CREG', True),
        ('alberto', 'CJ', False),
        ('sem-acesso', 'CREG', False),
    ]:
        autenticar(cur, nome)
        cur.execute('select public.tem_acesso_orgao(%s)', (orgao,))
        assert cur.fetchone()[0] is esperado


@teste
def usuario_so_le_a_propria_permissao(cur):
    autenticar(cur, 'alberto')
    cur.execute('select user_id, orgao from public.permissoes_usuario')
    assert cur.fetchall() == [(USUARIOS['alberto'], 'CREG')]


@teste
def usuario_nao_altera_permissoes(cur):
    autenticar(cur, 'alberto')
    comandos = [
        "insert into public.permissoes_usuario (user_id, orgao) values "
        "('00000000-0000-0000-0000-000000000011', 'CJ')",
        "update public.permissoes_usuario set orgao = 'CJ' "
        "where user_id = '00000000-0000-0000-0000-000000000011'",
        "delete from public.permissoes_usuario "
        "where user_id = '00000000-0000-0000-0000-000000000011'",
    ]
    for comando in comandos:
        try:
            cur.execute(comando)
        except InsufficientPrivilege:
            cur.connection.rollback()
            autenticar(cur, 'alberto')
        else:
            raise AssertionError(f'{comando.split()[0].upper()} deveria falhar')


def preparar_banco():
    PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')
    PG.executar("""insert into public.permissoes_usuario (user_id, orgao) values
                    ('00000000-0000-0000-0000-000000000011', 'CREG'),
                    ('00000000-0000-0000-0000-000000000012', 'CJ'),
                    ('00000000-0000-0000-0000-000000000013', 'CJ'),
                    ('00000000-0000-0000-0000-000000000013', 'CREG'),
                    ('00000000-0000-0000-0000-000000000014', 'CJ'),
                    ('00000000-0000-0000-0000-000000000014', 'CREG');""")


def main():
    PG.subir()
    try:
        preparar_banco()
        falhas = 0
        with PG.conectar() as conn:
            for fn in testes:
                with conn.cursor() as cur:
                    try:
                        fn(cur)
                        conn.commit()
                        print(f'ok    {fn.__name__}')
                    except Exception as e:
                        conn.rollback()
                        falhas += 1
                        print(f'FALHA {fn.__name__}: {type(e).__name__}: {e}')

        print(f'\n{len(testes) - falhas}/{len(testes)} testes passaram.')
        return 1 if falhas else 0
    finally:
        PG.derrubar()


if __name__ == '__main__':
    sys.exit(main())
