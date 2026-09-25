"""Regressões da revisão 4.0, em PostgreSQL descartável."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import date
from pathlib import Path
from unittest.mock import patch

import psycopg2
import banco

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / 'sincronizacao'))
import agr
import pauta
import sincronizar

PG = banco.Postgres('sorteio_sei_review_regression')
USUARIO = '00000000-0000-0000-0000-000000000013'
testes = []


def teste(fn):
    testes.append(fn)
    return fn


def autenticar(cur):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({'sub': USUARIO, 'email': 'review@goias.gov.br'}),))
    cur.execute('set local role authenticated')


def criar(cur, tabela, numero='202600029999901', voto: str | None = 'Manter'):
    cur.execute('reset role')
    cur.execute(f"insert into public.{tabela}(num_processo,data_sessao,voto) "
                "values (%s,'2026-07-02',%s) returning id", (numero, voto))
    return cur.fetchone()[0]


def gravar(cur, rpc, itens):
    autenticar(cur)
    cur.execute(f'select public.{rpc}(%s::jsonb)', (json.dumps(itens),))
    return cur.fetchone()[0]


PORTAS = [('julgados_cj', 'registrar_votos'), ('julgados_creg', 'registrar_votos_creg')]


@teste
def campos_independentes_nao_sobrescrevem_voto(conn):
    with conn.cursor() as cur:
        for tabela, rpc in PORTAS:
            ident = criar(cur, tabela)
            assert gravar(cur, rpc, [{'id': ident, 'voto': 'Anular',
                                     'anterior': {'voto': 'Manter'}}]) == 1
            assert gravar(cur, rpc, [{'id': ident, 'status': 'Julgado',
                                     'anterior': {'voto': 'Manter', 'status': None}}]) == 1
            cur.execute(f'select voto,status from public.{tabela} where id=%s', (ident,))
            assert cur.fetchone() == ('Anular', 'Julgado')


@teste
def conflito_recusa_lote_inteiro_e_cliente_antigo(conn):
    with conn.cursor() as cur:
        for tabela, rpc in PORTAS:
            ident = criar(cur, tabela)
            outro = criar(cur, tabela, '202600029999902', None)
            gravar(cur, rpc, [{'id': ident, 'voto': 'Anular', 'anterior': {'voto': 'Manter'}}])
            for item in [
                {'id': ident, 'voto': 'Vista', 'anterior': {'voto': 'Manter'},
                 **({'unidade_vista': 'CREG2'} if tabela == 'julgados_creg'
                    else {'cadeira_vista': 'CJ2'})},
                {'id': ident, 'voto': 'Manter', 'status': 'Julgado'},
            ]:
                cur.execute('savepoint conflito')
                try:
                    gravar(cur, rpc, [{'id': outro, 'voto': 'Manter'}, item])
                except psycopg2.errors.SerializationFailure:
                    cur.execute('rollback to savepoint conflito')
                else:
                    raise AssertionError('aceitou tela desatualizada')
                cur.execute(f'select voto from public.{tabela} where id=%s', (outro,))
                assert cur.fetchone()[0] is None


@teste
def reenvio_identico_e_seguro(conn):
    with conn.cursor() as cur:
        for tabela, rpc in PORTAS:
            ident = criar(cur, tabela)
            itens = [{'id': ident, 'voto': 'Anular', 'anterior': {'voto': 'Manter'}}]
            assert gravar(cur, rpc, itens) == 1
            assert gravar(cur, rpc, itens) == 1


@teste
def transacoes_concorrentes_nao_validam_o_mesmo_valor_antigo(conn):
    for tabela, rpc in PORTAS:
        with conn.cursor() as cur:
            ident = criar(cur, tabela, voto=None)
        conn.commit()
        with conn.cursor() as cur:
            gravar(cur, rpc, [{'id': ident, 'voto': 'Anular', 'anterior': {'voto': None}}])

        def outra_transacao():
            with PG.conectar() as outra, outra.cursor() as cur:
                try:
                    gravar(cur, rpc, [{'id': ident, 'voto': 'Manter', 'anterior': {'voto': None}}])
                except psycopg2.errors.SerializationFailure:
                    return 'conflito'
                return 'sobrescreveu'

        with ThreadPoolExecutor(max_workers=1) as executor:
            futuro = executor.submit(outra_transacao)
            try:
                futuro.result(timeout=0.2)
            except TimeoutError:
                pass
            finally:
                conn.commit()  # libera a linha; a outra transação deve reler o valor
            assert futuro.result(timeout=10) == 'conflito'
        with conn.cursor() as cur:
            cur.execute(f'select voto from public.{tabela} where id=%s', (ident,))
            assert cur.fetchone()[0] == 'Anular'


def documento():
    return agr.Pauta('https://goias.gov.br/agr/regressao.pdf', 'Reuniao 23', 23, date(2026, 7, 2))


@teste
def desde_rele_url_atualiza_hash_e_preserva_decisoes(conn):
    for colegiado in ('CJ', 'CREG'):
        col = sincronizar.COLEGIADOS[colegiado]
        doc = documento()
        with patch.object(agr, 'listar_pautas', return_value=[doc]), \
             patch.object(agr, 'baixar_pdf', return_value=(b'fixture', 'a' * 64)), \
             patch.object(pauta, 'extrair_texto', return_value='Processo nº 202600029999901'):
            resumo = sincronizar.sincronizar(conn, colegiado, ano=2026, hoje=date(2026, 7, 3))
            assert resumo['processos_importados'] == 1
        with conn.cursor() as cur:
            cur.execute(f"update public.{col['julgados']} set voto='Anular',status='Julgado'")
        conn.commit()
        with patch.object(agr, 'listar_pautas', return_value=[doc]), \
             patch.object(agr, 'baixar_pdf', return_value=(b'corrigido', 'b' * 64)), \
             patch.object(pauta, 'extrair_texto', return_value=(
                 'Processo nº 202600029999901\nProcesso nº 202600029999902')):
            normal = sincronizar.sincronizar(conn, colegiado, ano=2026, hoje=date(2026, 7, 3))
            assert normal['documentos_processados'] == 0
            forcado = sincronizar.sincronizar(conn, colegiado, ano=2026, hoje=date(2026, 7, 3),
                                             desde=date(2026, 6, 30))
            assert forcado['processos_importados'] == 1 and forcado['processos_duplicados'] == 1
        with conn.cursor() as cur:
            cur.execute(f"select voto,status from public.{col['julgados']} "
                        "where num_processo='202600029999901'")
            assert cur.fetchone() == ('Anular', 'Julgado')
            cur.execute(f"select sha256,processos_encontrados from public.{col['pautas']} where url=%s", (doc.url,))
            assert cur.fetchone() == ('b' * 64, 2)


@teste
def extracao_parcial_falha_sem_gravar_e_pode_ser_retentada(conn):
    for colegiado in ('CJ', 'CREG'):
        col = sincronizar.COLEGIADOS[colegiado]
        with patch.object(agr, 'listar_pautas', return_value=[documento()]), \
             patch.object(agr, 'baixar_pdf', return_value=(b'fixture', 'a' * 64)):
            with patch.object(pauta, 'extrair_texto', return_value=(
                    'Processo nº 202600029999901\nProc. 202600029999902')):
                falha = sincronizar.sincronizar(conn, colegiado, ano=2026, hoje=date(2026, 7, 3))
            assert falha['documentos_com_erro'] == 1
            assert falha['processos_importados'] == 0
            with conn.cursor() as cur:
                cur.execute(f"select count(*) from public.{col['julgados']}")
                assert cur.fetchone()[0] == 0
                cur.execute(f"select count(*) from public.{col['pautas']} where url=%s", (documento().url,))
                assert cur.fetchone()[0] == 0
            with patch.object(pauta, 'extrair_texto', return_value=(
                    'Processo nº 202600029999901\nProcesso nº 202600029999902')):
                sucesso = sincronizar.sincronizar(conn, colegiado, ano=2026, hoje=date(2026, 7, 3))
            assert sucesso['processos_importados'] == 2


def main():
    PG.subir()
    try:
        PG.rodar_arquivo(RAIZ / 'sql/schema.sql')
        PG.executar(f"""insert into public.permissoes_usuario(user_id,orgao)
                         values ('{USUARIO}','CJ'),('{USUARIO}','CREG')""")
        for fn in testes:
            PG.executar('truncate public.julgados_cj, public.julgados_creg, '
                        'public.pautas_cj, public.pautas_creg restart identity cascade')
            with PG.conectar() as conn:
                fn(conn)
            print(f'ok    {fn.__name__}')
        print(f'{len(testes)}/{len(testes)} testes passaram.')
    finally:
        PG.derrubar()


if __name__ == '__main__':
    main()
