#!/usr/bin/env python3
"""Testes do modelo de permissões por órgão em Postgres de verdade."""

import json
import sys
from pathlib import Path

import psycopg2
import psycopg2.errors
from psycopg2.errors import InsufficientPrivilege

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

PG = banco.Postgres('sorteio_sei_acesso_test')

USUARIOS = {
    'alberto': '00000000-0000-0000-0000-000000000011',
    'terezinha': '00000000-0000-0000-0000-000000000012',
    'lucas': '00000000-0000-0000-0000-000000000013',
    'sec-agr': '00000000-0000-0000-0000-000000000014',
    'sem-acesso': '00000000-0000-0000-0000-000000000015',
    'consulta': '00000000-0000-0000-0000-000000000016',
    'consulta-cj': '00000000-0000-0000-0000-000000000017',
    'consulta-creg': '00000000-0000-0000-0000-000000000018',
    'consulta-historico': '00000000-0000-0000-0000-000000000019',
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
        # A consulta continua autorizada nos dois órgãos: é o que a mantém
        # logada e abre o acervo. O que ela não passa é tem_acesso_orgao().
        'consulta': ['CJ', 'CREG'],
        'consulta-historico': ['CJ', 'CREG'],
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


# É a leitura com que bootstrap.js decide o porteiro de toda página: órgão e
# papel numa consulta só, e só as linhas da própria pessoa.
@teste
def usuario_le_o_proprio_papel(cur):
    for nome, esperado in [('consulta-cj', [('CJ', 'consulta')]),
                           ('lucas', [('CJ', 'admin'), ('CREG', 'admin')]),
                           ('alberto', [('CREG', 'operador')])]:
        autenticar(cur, nome)
        cur.execute('select orgao, papel from public.permissoes_usuario order by orgao')
        assert cur.fetchall() == esperado, nome


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
def sorteio_pela_api_so_grava_o_que_a_tela_mandaria(cur):
    """Issue #77, item 03: o operador não forja rodada nem foge do formato."""
    recusados = [
        ('acervo_cj', "relator, data_distribuicao", "'QUALQUER', current_date"),
        ('acervo_cj', "relator, data_distribuicao, sorteado_em",
         "'CJ1', date '2020-01-01', timestamptz '2020-01-01 10:00'"),
        ('acervo_cj', "relator, data_distribuicao", "'CJ1', current_date - 30"),
        ('acervo_cj', "relator, data_distribuicao, ordem", "'CJ1', current_date, -5"),
        ('acervo_cj', "relator, data_distribuicao, assunto", "'CJ1', current_date, 'Outros'"),
        ('acervo_creg', "unidade, data_distribuicao, interessado",
         "'CREG1', current_date, repeat('x', 301)"),
        ('acervo_creg', "unidade, data_distribuicao, assunto",
         "'CREG1', current_date, repeat('x', 101)"),
    ]
    for tabela, colunas, valores in recusados:
        autenticar(cur, 'lucas')
        try:
            cur.execute(f"""insert into public.{tabela} (num_processo, {colunas}, origem)
                            values ('202600029009920', {valores}, 'sorteio')""")
        except psycopg2.errors.InvalidParameterValue:
            cur.connection.rollback()
        else:
            raise AssertionError(f'{tabela} aceitou ({colunas}) = ({valores})')

    # O carimbo de criação é do banco, não do cliente.
    autenticar(cur, 'terezinha')
    cur.execute("""insert into public.acervo_cj
                   (num_processo, relator, data_distribuicao, origem, criado_em)
                   values ('202600029009921', 'CJ1', current_date, 'sorteio',
                           timestamptz '2020-01-01 10:00')""")
    cur.execute('reset role')
    cur.execute("""select criado_em > now() - interval '1 minute', sorteado_em is not null
                     from public.acervo_cj where num_processo = '202600029009921'""")
    assert cur.fetchone() == (True, True)
    cur.connection.rollback()

    # O motivo do painel tem o limite do campo da tela.
    cur.execute('reset role')
    try:
        cur.execute("""insert into public.auditoria_admin
                       (orgao, operacao, tabela, registro_id, antes, depois, motivo, feito_por)
                       values ('CJ', 'teste', 'acervo_cj', 1, '{}', '{}', repeat('x', 201), 'x')""")
    except psycopg2.errors.CheckViolation:
        cur.connection.rollback()
    else:
        raise AssertionError('auditoria_admin aceitou motivo com 201 caracteres')


@teste
def sem_acesso_nao_opera_nem_le_tabelas_protegidas(cur):
    autenticar(cur, 'sem-acesso')
    deve_negar(cur, """insert into public.acervo_cj
                        (num_processo, relator, data_distribuicao, origem)
                        values ('202600029009913', 'CJ1', current_date, 'sorteio')""")

    autenticar(cur, 'sem-acesso')
    deve_negar(cur, """insert into public.acervo_creg
                        (num_processo, unidade, data_distribuicao, origem)
                        values ('202600029009914', 'CREG1', current_date, 'sorteio')""")

    for tabela in ['julgados_cj', 'julgados_creg']:
        autenticar(cur, 'sem-acesso')
        cur.execute(f'select num_processo from public.{tabela}')
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


@teste
def lucas_e_sec_agr_leem_julgados_dos_dois_orgaos(cur):
    for nome in ['lucas', 'sec-agr']:
        for tabela, esperado in [
            ('julgados_cj', [('202600029009911',)]),
            ('julgados_creg', [('202600029009912',)]),
        ]:
            autenticar(cur, nome)
            cur.execute(f'select num_processo from public.{tabela} order by num_processo')
            assert cur.fetchall() == esperado


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
        'sem-acesso': [],
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


# ── Papel de consulta ────────────────────────────────────────────────────────
# Vê o acervo e a Meta 45 dos dois órgãos, e mais nada.
ACERVO = [
    'select * from public.resumo_acervo_cj()',
    'select * from public.processos_acervo_cj(null, null)',
    "select * from public.retornos_de_vista('CJ')",
    'select * from public.resumo_acervo_creg()',
    'select * from public.processos_acervo_creg(null, null)',
    "select * from public.retornos_de_vista('CREG')",
]
META_45 = [
    "select * from public.admin_meta_45('CJ')",
    "select * from public.admin_meta_45_processos('CJ', current_date - 30, current_date)",
    "select * from public.admin_meta_45('CREG')",
    "select * from public.admin_meta_45_processos('CREG', current_date - 30, current_date)",
]


@teste
def consulta_le_o_acervo_e_a_meta_45(cur):
    for rpc in ACERVO + META_45:
        autenticar(cur, 'consulta')
        cur.execute(rpc)
        cur.fetchall()
        cur.connection.rollback()

    autenticar(cur, 'consulta')
    cur.execute('select orgao from public.orgaos_consultados() order by orgao')
    assert [linha[0] for linha in cur.fetchall()] == ['CJ', 'CREG']
    for orgao in ['CJ', 'CREG']:
        cur.execute('select public.tem_acesso_orgao(%s), public.tem_acesso_acervo(%s)',
                    (orgao, orgao))
        assert cur.fetchone() == (False, True)


@teste
def consulta_nao_sorteia_nao_registra_nem_ve_historico(cur):
    for rpc in RPCS['CJ'][2:] + RPCS['CREG'][2:]:
        autenticar(cur, 'consulta')
        deve_negar(cur, rpc)

    autenticar(cur, 'consulta')
    deve_negar(cur, """insert into public.acervo_cj
                        (num_processo, relator, data_distribuicao, origem)
                        values ('202600029009921', 'CJ1', current_date, 'sorteio')""")
    autenticar(cur, 'consulta')
    deve_negar(cur, """insert into public.acervo_creg
                        (num_processo, unidade, data_distribuicao, origem)
                        values ('202600029009922', 'CREG1', current_date, 'sorteio')""")

    for tabela in ['julgados_cj', 'julgados_creg']:
        autenticar(cur, 'consulta')
        cur.execute(f'select num_processo from public.{tabela}')
        assert cur.fetchall() == []


@teste
def consulta_nao_entra_no_painel_administrativo(cur):
    autenticar(cur, 'consulta')
    cur.execute('select orgao from public.orgaos_administrados()')
    assert cur.fetchall() == []
    for rpc in ["select * from public.admin_sessoes('CJ')",
                "select * from public.admin_sorteios('CREG')",
                "select * from public.admin_auditoria('CJ', 10, null)"]:
        autenticar(cur, 'consulta')
        deve_negar(cur, rpc)


@teste
def consulta_historico_so_amplia_as_duas_leituras(cur):
    for rpc in ACERVO + META_45 + [
        "select * from public.historico_sorteios('CJ')",
        "select * from public.processos_sorteio('CJ', current_date, null)",
        "select * from public.historico_sorteios('CREG')",
        "select * from public.processos_sorteio('CREG', current_date, null)",
    ]:
        autenticar(cur, 'consulta-historico')
        cur.execute(rpc)
        cur.fetchall()
        cur.connection.rollback()

    autenticar(cur, 'consulta-historico')
    cur.execute("select public.tem_acesso_orgao('CJ'), public.tem_acesso_orgao('CREG'), "
                "public.tem_acesso_historico('CJ'), public.tem_acesso_historico('CREG')")
    assert cur.fetchone() == (False, False, True, True)

    for rpc in ["select public.registrar_votos('[]'::jsonb)",
                "select public.registrar_votos_creg('[]'::jsonb)",
                "select * from public.admin_sessoes('CJ')",
                "select * from public.admin_sessoes('CREG')"]:
        autenticar(cur, 'consulta-historico')
        deve_negar(cur, rpc)

    for tabela, destino in [('acervo_cj', 'relator'), ('acervo_creg', 'unidade')]:
        autenticar(cur, 'consulta-historico')
        deve_negar(cur, f"insert into public.{tabela} "
                  f"(num_processo, {destino}, data_distribuicao, origem) "
                  f"values ('202600029009923', '{'CJ1' if destino == 'relator' else 'CREG1'}', "
                  "current_date, 'sorteio')")

    for tabela in ['julgados_cj', 'julgados_creg']:
        autenticar(cur, 'consulta-historico')
        cur.execute(f'select num_processo from public.{tabela}')
        assert cur.fetchall() == []


# O órgão da consulta é a própria linha de permissoes_usuario: quem só tem a
# linha da CJ vê o acervo e a Meta da CJ, e o CREG fica fechado — e vice-versa.
@teste
def consulta_so_ve_o_proprio_orgao(cur):
    for nome, orgao, outro in [('consulta-cj', 'CJ', 'CREG'), ('consulta-creg', 'CREG', 'CJ')]:
        autenticar(cur, nome)
        cur.execute('select orgao from public.orgaos_consultados()')
        assert [linha[0] for linha in cur.fetchall()] == [orgao]
        assert permissoes(cur) == [orgao]

        for rpc in ACERVO + META_45:
            autenticar(cur, nome)
            if f"'{outro}'" in rpc or rpc.split('(')[0].endswith(outro.lower()):
                deve_negar(cur, rpc)
            else:
                cur.execute(rpc)
                cur.fetchall()
                cur.connection.rollback()


@teste
def meta_45_continua_fechada_para_o_operador(cur):
    for rpc in META_45:
        autenticar(cur, 'alberto')
        deve_negar(cur, rpc)
    # E aberta para o administrador, que a vê no painel.
    for rpc in META_45:
        autenticar(cur, 'lucas')
        cur.execute(rpc)
        cur.fetchall()
        cur.connection.rollback()


def preparar_banco():
    PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')
    PG.executar("""insert into public.permissoes_usuario (user_id, orgao) values
                    ('00000000-0000-0000-0000-000000000011', 'CREG'),
                    ('00000000-0000-0000-0000-000000000012', 'CJ'),
                    ('00000000-0000-0000-0000-000000000013', 'CJ'),
                    ('00000000-0000-0000-0000-000000000013', 'CREG'),
                    ('00000000-0000-0000-0000-000000000014', 'CJ'),
                    ('00000000-0000-0000-0000-000000000014', 'CREG');""")
    PG.executar("""insert into public.permissoes_usuario (user_id, orgao, papel) values
                    ('00000000-0000-0000-0000-000000000016', 'CJ', 'consulta'),
                    ('00000000-0000-0000-0000-000000000016', 'CREG', 'consulta'),
                    ('00000000-0000-0000-0000-000000000017', 'CJ', 'consulta'),
                    ('00000000-0000-0000-0000-000000000018', 'CREG', 'consulta'),
                    ('00000000-0000-0000-0000-000000000019', 'CJ', 'consulta_historico'),
                    ('00000000-0000-0000-0000-000000000019', 'CREG', 'consulta_historico');
                  update public.permissoes_usuario set papel = 'admin'
                   where user_id = '00000000-0000-0000-0000-000000000013';""")
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
