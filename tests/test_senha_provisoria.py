#!/usr/bin/env python3
"""Marca de senha provisória (app_metadata) em Postgres de verdade.

A tela de login lê raw_app_meta_data.senha_provisoria; quem apaga a marca é o
gatilho da migração, ao trocar a senha por qualquer caminho.
"""

import sys
from pathlib import Path

import psycopg2
from psycopg2.errors import InsufficientPrivilege

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

PG = banco.Postgres('sorteio_sei_senha_provisoria_test')
ANA = '00000000-0000-0000-0000-000000000001'
BIA = '00000000-0000-0000-0000-000000000011'

testes = []


def teste(fn):
    testes.append(fn)
    return fn


def app_metadata(cur, user_id):
    return banco.uma(cur, 'select raw_app_meta_data from auth.users where id = %s', (user_id,))


def redefinir_marcas(cur):
    cur.execute("update auth.users set encrypted_password = 'hash-provisorio', "
                "raw_app_meta_data = '{\"provider\": \"email\"}'::jsonb")
    cur.execute((RAIZ / 'sql' / 'marcar_senha_provisoria.sql').read_text(encoding='utf-8')
                .split('-- 3)')[0])


@teste
def marcacao_liga_a_marca_sem_perder_o_resto(cur):
    redefinir_marcas(cur)
    for user_id in (ANA, BIA):
        meta = app_metadata(cur, user_id)
        assert meta == {'provider': 'email', 'senha_provisoria': True}, meta


@teste
def trocar_a_senha_apaga_a_marca_so_dessa_conta(cur):
    redefinir_marcas(cur)
    cur.execute("update auth.users set encrypted_password = 'hash-novo' where id = %s", (ANA,))
    assert app_metadata(cur, ANA) == {'provider': 'email'}
    assert app_metadata(cur, BIA)['senha_provisoria'] is True


@teste
def gravar_a_mesma_senha_nao_apaga_a_marca(cur):
    redefinir_marcas(cur)
    cur.execute("update auth.users set encrypted_password = 'hash-provisorio' where id = %s", (ANA,))
    assert app_metadata(cur, ANA)['senha_provisoria'] is True


@teste
def outras_escritas_na_conta_nao_apagam_a_marca(cur):
    redefinir_marcas(cur)
    cur.execute("update auth.users set email = 'ana2@goias.gov.br' where id = %s", (ANA,))
    assert app_metadata(cur, ANA)['senha_provisoria'] is True


@teste
def escrita_que_traz_a_marca_velha_junto_com_a_senha_nova_ainda_apaga(cur):
    # O GoTrue pode regravar o objeto inteiro que leu antes da troca, marca
    # incluída. O gatilho roda depois do SET e tem a última palavra.
    redefinir_marcas(cur)
    cur.execute("""update auth.users
                      set encrypted_password = 'hash-novo',
                          raw_app_meta_data = '{"provider": "email", "senha_provisoria": true}'::jsonb
                    where id = %s""", (ANA,))
    assert 'senha_provisoria' not in app_metadata(cur, ANA)


@teste
def conta_sem_app_metadata_nao_quebra_a_troca(cur):
    cur.execute("update auth.users set raw_app_meta_data = null where id = %s", (ANA,))
    cur.execute("update auth.users set encrypted_password = 'hash-outro' where id = %s", (ANA,))
    assert app_metadata(cur, ANA) == {}


def redefinir(cur, email, senha):
    # A transação é do teste: o begin/commit do script ficam de fora.
    sql = ((RAIZ / 'sql' / 'redefinir_senha_provisoria.sql').read_text(encoding='utf-8')
           .replace('<SENHA PROVISÓRIA>', senha).replace('<email@goias.gov.br>', email)
           .replace('begin;', '').replace('commit;', ''))
    cur.execute(sql)


@teste
def redefinicao_pelo_administrador_deixa_a_marca_ligada(cur):
    # "Esqueci minha senha": a senha que o administrador define é conhecida por
    # ele, e a pessoa precisa passar pela troca de novo.
    redefinir_marcas(cur)
    cur.execute("update auth.users set encrypted_password = 'hash-novo' where id = %s", (ANA,))
    assert 'senha_provisoria' not in app_metadata(cur, ANA)
    cur.execute('delete from auth.sessions')
    cur.execute('insert into auth.sessions (id, user_id) values (gen_random_uuid(), %s), (gen_random_uuid(), %s)',
                (ANA, BIA))

    # O e-mail vem do banco: outro teste o troca.
    redefinir(cur, banco.uma(cur, 'select email from auth.users where id = %s', (ANA,)), 'provisoria-de-teste')

    assert app_metadata(cur, ANA) == {'provider': 'email', 'senha_provisoria': True}, app_metadata(cur, ANA)
    hash_ = banco.uma(cur, 'select encrypted_password from auth.users where id = %s', (ANA,))
    assert hash_.startswith('$2a$10$'), f'custo 10: o login não regrava o hash (e não apaga a marca): {hash_}'
    assert banco.uma(cur, 'select extensions.crypt(%s, %s) = %s', ('provisoria-de-teste', hash_, hash_)), hash_
    assert banco.uma(cur, 'select count(*) from auth.sessions where user_id = %s', (ANA,)) == 0, \
        'as sessões abertas com a senha antiga caem'
    assert banco.uma(cur, 'select count(*) from auth.sessions where user_id = %s', (BIA,)) == 1, \
        'e só as dessa conta'


@teste
def funcao_do_gatilho_nao_e_chamavel_pelos_papeis_da_api(cur):
    for papel in ('anon', 'authenticated'):
        cur.execute('reset role')
        cur.execute(f'set local role {papel}')
        try:
            cur.execute('select public.limpar_marca_senha_provisoria()')
        except InsufficientPrivilege:
            cur.connection.rollback()
        else:
            raise AssertionError(f'{papel} conseguiu executar a função do gatilho')


def preparar_banco():
    PG.executar("""create schema if not exists public;
                   create schema if not exists extensions;
                   create extension if not exists pgcrypto schema extensions;
                   create table if not exists auth.sessions (id uuid primary key, user_id uuid not null);""")
    PG.rodar_arquivo(RAIZ / 'supabase' / 'migrations' / '20260930111200_marca_senha_provisoria.sql')


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
