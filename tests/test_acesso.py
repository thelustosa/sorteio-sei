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


def deve_negar(cur, sql, args=None):
    try:
        cur.execute(sql, args)
    except InsufficientPrivilege:
        cur.connection.rollback()
    else:
        raise AssertionError(f'operacao proibida foi aceita: {sql}')


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


@teste
def alberto_so_opera_tabelas_creg(cur):
    autenticar(cur, 'alberto')
    cur.execute("""insert into public.acervo_creg
                   (num_processo, unidade, data_distribuicao, origem)
                   values ('202600029009901', 'CREG1', current_date, 'sorteio')""")
    cur.connection.rollback()

    autenticar(cur, 'alberto')
    deve_negar(cur, """insert into public.acervo_cj
                        (num_processo, relator, data_distribuicao, origem)
                        values ('202600029009902', 'CJ1', current_date, 'sorteio')""")

    autenticar(cur, 'alberto')
    cur.execute("select num_processo from public.julgados_cj")
    assert cur.fetchall() == []


@teste
def terezinha_so_opera_tabelas_cj(cur):
    autenticar(cur, 'terezinha')
    cur.execute("""insert into public.acervo_cj
                   (num_processo, relator, data_distribuicao, origem)
                   values ('202600029009903', 'CJ1', current_date, 'sorteio')""")
    cur.connection.rollback()

    autenticar(cur, 'terezinha')
    deve_negar(cur, """insert into public.acervo_creg
                        (num_processo, unidade, data_distribuicao, origem)
                        values ('202600029009904', 'CREG1', current_date, 'sorteio')""")

    autenticar(cur, 'terezinha')
    cur.execute("select num_processo from public.julgados_creg")
    assert cur.fetchall() == []


@teste
def lucas_e_sec_agr_operam_tabelas_dos_dois_orgaos(cur):
    for indice, nome in enumerate(['lucas', 'sec-agr'], start=5):
        autenticar(cur, nome)
        cur.execute("""insert into public.acervo_cj
                       (num_processo, relator, data_distribuicao, origem)
                       values (%s, 'CJ1', current_date, 'sorteio')""",
                    (f'2026000290099{indice:02d}',))
        cur.connection.rollback()

        autenticar(cur, nome)
        cur.execute("""insert into public.acervo_creg
                       (num_processo, unidade, data_distribuicao, origem)
                       values (%s, 'CREG1', current_date, 'sorteio')""",
                    (f'2026000290099{indice + 2:02d}',))
        cur.connection.rollback()


RPCS = {
    'CJ': [
        'select * from public.resumo_acervo_cj()',
        'select * from public.processos_acervo_cj(null, null)',
        "select public.registrar_votos('[]'::jsonb)",
        "select * from public.historico_sorteios('CJ')",
        "select * from public.processos_sorteio('CJ', current_date, null)",
    ],
    'CREG': [
        'select * from public.resumo_acervo_creg()',
        'select * from public.processos_acervo_creg(null, null)',
        "select public.registrar_votos_creg('[]'::jsonb)",
        "select * from public.historico_sorteios('CREG')",
        "select * from public.processos_sorteio('CREG', current_date, null)",
    ],
}


@teste
def rpcs_so_aceitam_o_orgao_autorizado(cur):
    for nome, permitidos in {
        'alberto': ['CREG'],
        'terezinha': ['CJ'],
        'lucas': ['CJ', 'CREG'],
        'sec-agr': ['CJ', 'CREG'],
    }.items():
        for orgao, rpcs in RPCS.items():
            for rpc in rpcs:
                autenticar(cur, nome)
                if orgao in permitidos:
                    cur.execute(rpc)
                    cur.fetchall()
                    cur.connection.rollback()
                else:
                    deve_negar(cur, rpc)


@teste
def rpcs_preservam_contrato_de_autenticacao_e_colegiado(cur):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', '', true)")
    cur.execute('set local role authenticated')
    try:
        cur.execute('select * from public.resumo_acervo_cj()')
    except psycopg2.Error as erro:
        assert erro.pgcode == '28000'
        cur.connection.rollback()
    else:
        raise AssertionError('RPC anonima deveria exigir autenticacao')

    autenticar(cur, 'alberto')
    for rpc in [
        "select * from public.historico_sorteios('OUTRO')",
        "select * from public.processos_sorteio('OUTRO', current_date, null)",
    ]:
        try:
            cur.execute(rpc)
        except psycopg2.Error as erro:
            assert erro.pgcode == '22023'
            cur.connection.rollback()
            autenticar(cur, 'alberto')
        else:
            raise AssertionError('colegiado desconhecido foi aceito')


def preparar_banco():
    PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')
    PG.executar("""insert into public.permissoes_usuario (user_id, orgao) values
                    ('00000000-0000-0000-0000-000000000011', 'CREG'),
                    ('00000000-0000-0000-0000-000000000012', 'CJ'),
                    ('00000000-0000-0000-0000-000000000013', 'CJ'),
                    ('00000000-0000-0000-0000-000000000013', 'CREG'),
                    ('00000000-0000-0000-0000-000000000014', 'CJ'),
                    ('00000000-0000-0000-0000-000000000014', 'CREG');""")
    PG.executar("""insert into public.julgados_cj
                  (num_processo, data_sessao)
                  values ('202600029009911', current_date);
                  insert into public.julgados_creg
                  (num_processo, data_sessao)
                  values ('202600029009912', current_date);""")


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
