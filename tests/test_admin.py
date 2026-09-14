#!/usr/bin/env python3
"""Testes do painel administrativo em Postgres de verdade.

O painel é a primeira porta de ESCRITA ampla que o navegador ganha: até aqui o
acervo só aceitava INSERT e os julgados só SELECT. Por isso o que estes testes
mais perseguem não é o caminho feliz, e sim as três coisas que podem estragar
dado alheio: quem pode chamar, o que o gatilho de derivação faz por baixo de uma
correção, e se toda alteração deixou rastro.
"""

import json
import sys
from pathlib import Path

import psycopg2
from psycopg2.errors import InsufficientPrivilege

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

PG = banco.Postgres('sorteio_sei_admin_test', 55437)

USUARIOS = {
    'alberto': '00000000-0000-0000-0000-000000000011',
    'terezinha': '00000000-0000-0000-0000-000000000012',
    'lucas': '00000000-0000-0000-0000-000000000013',
    'sec-agr': '00000000-0000-0000-0000-000000000014',
    'sem-acesso': '00000000-0000-0000-0000-000000000015',
}

ADMINS = ['lucas', 'sec-agr']
OPERADORES = ['alberto', 'terezinha']

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


def como_dono(cur, sql, args=None):
    """Escreve sem passar pela RLS, para montar o cenário de um teste."""
    cur.execute('reset role')
    cur.execute(sql, args)
    linha = cur.fetchone() if cur.description else None
    return linha[0] if linha and len(linha) == 1 else linha


def deve_negar(cur, sql, args=None):
    try:
        cur.execute(sql, args)
    except InsufficientPrivilege:
        cur.connection.rollback()
    else:
        raise AssertionError(f'operacao proibida foi aceita: {sql}')


def deve_falhar(cur, sql, args=None, codigo=None):
    try:
        cur.execute(sql, args)
    except psycopg2.Error as erro:
        cur.connection.rollback()
        if codigo:
            assert erro.pgcode == codigo, f'esperado {codigo}, veio {erro.pgcode}: {erro}'
        return erro
    raise AssertionError(f'operacao invalida foi aceita: {sql}')


# ── Cenário ──────────────────────────────────────────────────────────────────
# Cada teste que escreve monta os próprios registros: a suíte faz commit entre
# os testes, então compartilhar linha entre eles criaria dependência de ordem.

CONTADOR = [0]


def numero():
    """Um número de processo SEI válido e inédito (15 dígitos)."""
    CONTADOR[0] += 1
    return f'2026000000{CONTADOR[0]:05d}'


def cenario_cj(cur, *, relator='CJ3', data_dist='2026-06-18', data_sessao='2026-07-09',
               defesa=True, voto='Manter', status='Julgado', pauta=24):
    """Uma distribuição na Câmara e um julgado que a copiou."""
    num = numero()
    acervo_id = como_dono(cur, """
        insert into public.acervo_cj
          (num_processo, relator, data_distribuicao, defesa, assunto, ordem,
           sorteado_em, origem)
        values (%s, %s, %s, %s, 'Auto de Infração', 1,
                timestamptz '2026-06-18 10:00-03', 'sorteio')
        returning id""", (num, relator, data_dist, defesa))
    julgado_id = como_dono(cur, """
        insert into public.julgados_cj (num_processo, data_sessao, pauta, voto, status)
        values (%s, %s, %s, %s, %s) returning id""",
                           (num, data_sessao, pauta, voto, status))
    return num, acervo_id, julgado_id


def cenario_creg(cur, *, unidade='CREG2', data_dist='2026-06-18', data_sessao='2026-07-10',
                 recurso='Com recurso', voto='Manter', status='Julgado', pauta=12):
    """Uma distribuição no Conselho e um julgado que a copiou."""
    num = numero()
    acervo_id = como_dono(cur, """
        insert into public.acervo_creg
          (num_processo, unidade, data_distribuicao, assunto, recurso, interessado,
           ordem, sorteado_em, origem)
        values (%s, %s, %s, 'Requerimento', %s, 'Fulano de Tal', 1,
                timestamptz '2026-06-18 10:00-03', 'sorteio')
        returning id""", (num, unidade, data_dist, recurso))
    julgado_id = como_dono(cur, """
        insert into public.julgados_creg (num_processo, data_sessao, pauta, voto, status)
        values (%s, %s, %s, %s, %s) returning id""",
                           (num, data_sessao, pauta, voto, status))
    return num, acervo_id, julgado_id


def julgado(cur, tabela, julgado_id, colunas):
    cur.execute(f'select {colunas} from public.{tabela} where id = %s', (julgado_id,))
    return cur.fetchone()


def auditoria(cur, tabela, registro_id):
    cur.execute("""select operacao, antes, depois, motivo, feito_por
                     from public.auditoria_admin
                    where tabela = %s and registro_id = %s
                    order by id""", (tabela, registro_id))
    return cur.fetchall()


# ── Papel e visibilidade ─────────────────────────────────────────────────────

@teste
def papel_padrao_nao_promove_ninguem(cur):
    """A coluna nasce com default 'operador': migrar não dá poder a quem já existia."""
    cur.execute('reset role')
    cur.execute("""select count(*) from public.permissoes_usuario
                    where user_id in (%s, %s) and papel <> 'operador'""",
                (USUARIOS['alberto'], USUARIOS['terezinha']))
    assert cur.fetchone()[0] == 0


@teste
def so_lucas_e_sec_agr_administram_os_dois_orgaos(cur):
    for nome in ADMINS:
        autenticar(cur, nome)
        cur.execute('select orgao from public.orgaos_administrados() order by orgao')
        assert [linha[0] for linha in cur.fetchall()] == ['CJ', 'CREG']

    for nome in OPERADORES + ['sem-acesso']:
        autenticar(cur, nome)
        cur.execute('select orgao from public.orgaos_administrados() order by orgao')
        assert cur.fetchall() == []


@teste
def e_admin_orgao_responde_por_identidade_e_orgao(cur):
    for nome, esperado in [('lucas', True), ('sec-agr', True),
                           ('alberto', False), ('terezinha', False),
                           ('sem-acesso', False)]:
        for orgao in ['CJ', 'CREG']:
            autenticar(cur, nome)
            cur.execute('select public.e_admin_orgao(%s)', (orgao,))
            assert cur.fetchone()[0] is esperado, f'{nome} / {orgao}'


@teste
def papel_nao_muda_o_acesso_de_orgao_de_ninguem(cur):
    """tem_acesso_orgao continua decidindo só por órgão: o painel não pode ter
    mexido no que a secretaria já fazia."""
    for nome, esperado in {'alberto': ['CREG'], 'terezinha': ['CJ'],
                           'lucas': ['CJ', 'CREG'], 'sec-agr': ['CJ', 'CREG'],
                           'sem-acesso': []}.items():
        autenticar(cur, nome)
        cur.execute('select orgao from public.orgaos_autorizados() order by orgao')
        assert [linha[0] for linha in cur.fetchall()] == esperado


@teste
def usuario_nao_promove_a_si_mesmo(cur):
    autenticar(cur, 'alberto')
    deve_negar(cur, """update public.permissoes_usuario set papel = 'admin'
                        where user_id = %s""", (USUARIOS['alberto'],))


# ── Autorização das RPCs ─────────────────────────────────────────────────────

RPCS_LEITURA = {
    'CJ': [
        "select * from public.admin_sessoes('CJ')",
        "select * from public.admin_processos_sessao('CJ', date '2026-07-09')",
        "select * from public.admin_sorteios('CJ')",
        "select * from public.admin_processos_acervo('CJ', date '2026-06-18', null, null)",
        "select * from public.admin_julgados_do_acervo('CJ', 1)",
        "select * from public.admin_auditoria('CJ', 10, null)",
    ],
    'CREG': [
        "select * from public.admin_sessoes('CREG')",
        "select * from public.admin_processos_sessao('CREG', date '2026-07-10')",
        "select * from public.admin_sorteios('CREG')",
        "select * from public.admin_processos_acervo('CREG', date '2026-06-18', null, null)",
        "select * from public.admin_julgados_do_acervo('CREG', 1)",
        "select * from public.admin_auditoria('CREG', 10, null)",
    ],
}


@teste
def leitura_administrativa_so_para_admin(cur):
    for orgao, rpcs in RPCS_LEITURA.items():
        for rpc in rpcs:
            for nome in ADMINS:
                autenticar(cur, nome)
                cur.execute(rpc)
                cur.fetchall()
                cur.connection.rollback()
            for nome in OPERADORES + ['sem-acesso']:
                autenticar(cur, nome)
                deve_negar(cur, rpc)


@teste
def escrita_administrativa_so_para_admin(cur):
    num_cj, acervo_cj, julgado_cj = cenario_cj(cur)
    num_creg, acervo_creg, julgado_creg = cenario_creg(cur)
    cur.connection.commit()

    escritas = [
        ("select public.admin_corrigir_julgado_cj(%s, '{\"voto\":\"Anular\"}'::jsonb, null)", (julgado_cj,)),
        ('select public.admin_religar_julgado_cj(%s, null)', (julgado_cj,)),
        ("select public.admin_corrigir_acervo_cj(%s, '{\"relator\":\"CJ4\"}'::jsonb, null)", (acervo_cj,)),
        ("select public.admin_redistribuir_cj(%s, '{\"relator\":\"CJ4\"}'::jsonb, null)", (acervo_cj,)),
        ("select public.admin_corrigir_processo_cj(%s, '202600099999901', 'tudo', null)", (num_cj,)),
        ("select public.admin_corrigir_julgado_creg(%s, '{\"voto\":\"Anular\"}'::jsonb, null)", (julgado_creg,)),
        ('select public.admin_religar_julgado_creg(%s, null)', (julgado_creg,)),
        ("select public.admin_corrigir_acervo_creg(%s, '{\"unidade\":\"CREG3\"}'::jsonb, null)", (acervo_creg,)),
        ("select public.admin_redistribuir_creg(%s, '{\"unidade\":\"CREG3\"}'::jsonb, null)", (acervo_creg,)),
        ("select public.admin_corrigir_processo_creg(%s, '202600099999902', 'tudo', null)", (num_creg,)),
    ]

    for sql, args in escritas:
        for nome in OPERADORES + ['sem-acesso']:
            autenticar(cur, nome)
            deve_negar(cur, sql, args)


@teste
def rpc_administrativa_exige_sessao(cur):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', '', true)")
    cur.execute('set local role authenticated')
    deve_falhar(cur, "select * from public.admin_sessoes('CJ')", codigo='28000')


@teste
def rpc_administrativa_recusa_colegiado_desconhecido(cur):
    autenticar(cur, 'lucas')
    deve_falhar(cur, "select * from public.admin_sessoes('OUTRO')", codigo='22023')


# ── Correção de julgado ──────────────────────────────────────────────────────

@teste
def corrigir_julgado_troca_voto_e_status(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_cj(
                     %s, '{"voto":"Anular","status":"Retornou"}'::jsonb, 'erro de digitação')""",
                (julgado_id,))
    retorno = cur.fetchone()[0]
    assert retorno['alterados']['voto'] == {'antes': 'Manter', 'depois': 'Anular'}
    assert retorno['alterados']['status'] == {'antes': 'Julgado', 'depois': 'Retornou'}

    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'voto, status') == ('Anular', 'Retornou')


@teste
def corrigir_julgado_desfaz_campo_com_null_explicito(cur):
    """O que registrar_votos não consegue fazer: voltar um campo a vazio."""
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_cj(
                     %s, '{"voto":null}'::jsonb, 'processo não foi julgado')""",
                (julgado_id,))
    cur.execute('reset role')
    # status ausente do jsonb: não foi tocado.
    assert julgado(cur, 'julgados_cj', julgado_id, 'voto, status') == (None, 'Julgado')


@teste
def corrigir_julgado_trata_string_vazia_como_ausencia(cur):
    """O JSON pode trazer "" onde o cliente mandaria null.

    A validação já usava nullif e deixava passar; o UPDATE gravava a string
    literal. Um voto '' passa pela allowlist, não colide com nenhum CHECK, e
    vira selo vazio em todo painel que lê a coluna.
    """
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_cj(
                     %s, '{"voto":"","status":"","pauta":""}'::jsonb, null)""",
                (julgado_id,))
    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'voto, status, pauta') == (None, None, None)


@teste
def corrigir_julgado_creg_trata_string_vazia_como_ausencia(cur):
    _, _, julgado_id = cenario_creg(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_creg(
                     %s, '{"voto":"","status":""}'::jsonb, null)""", (julgado_id,))
    cur.execute('reset role')
    assert julgado(cur, 'julgados_creg', julgado_id, 'voto, status') == (None, None)


@teste
def corrigir_julgado_recusa_data_vazia_com_a_mensagem_certa(cur):
    """A data em branco tem recusa própria; sem o nullif ela estourava no cast."""
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    deve_falhar(cur, """select public.admin_corrigir_julgado_cj(
                          %s, '{"data_sessao":""}'::jsonb, null)""",
                (julgado_id,), codigo='22023')


@teste
def corrigir_julgado_preserva_rotulo_longo_do_conselho(cur):
    """'Indeferimento' e 'Prejudicado' passam de 10 caracteres.

    O painel truncava todo campo em 10 antes de comparar, e via alteração onde
    não houve. Aqui a garantia é do lado do banco: o rótulo entra e sai inteiro.
    """
    _, _, julgado_id = cenario_creg(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_creg(
                     %s, '{"voto":"Indeferimento","status":"Prejudicado"}'::jsonb, null)""",
                (julgado_id,))
    cur.execute('reset role')
    assert julgado(cur, 'julgados_creg', julgado_id,
                   'voto, status') == ('Indeferimento', 'Prejudicado')


@teste
def corrigir_julgado_recusa_campo_fora_da_allowlist(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    deve_falhar(cur, """select public.admin_corrigir_julgado_cj(
                          %s, '{"relator":"CJ9"}'::jsonb, null)""",
                (julgado_id,), codigo='22023')


@teste
def corrigir_julgado_recusa_rotulo_fora_da_lista(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    for campos in ['{"voto":"Talvez"}', '{"status":"Pendente"}']:
        autenticar(cur, 'lucas')
        deve_falhar(cur, 'select public.admin_corrigir_julgado_cj(%s, %s::jsonb, null)',
                    (julgado_id, campos), codigo='22023')


@teste
def corrigir_julgado_recusa_sessao_no_futuro(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    deve_falhar(cur, """select public.admin_corrigir_julgado_cj(
                          %s, jsonb_build_object('data_sessao',
                              (current_date + 1)::text), null)""",
                (julgado_id,), codigo='22023')


@teste
def corrigir_julgado_recusa_colisao_de_sessao(cur):
    """julgados_cj_sessao_unica: o mesmo processo não é julgado duas vezes na
    mesma sessão, e mudar a data pode esbarrar nisso."""
    num, _, primeiro = cenario_cj(cur, data_sessao='2026-07-09')
    segundo = como_dono(cur, """
        insert into public.julgados_cj (num_processo, data_sessao, pauta)
        values (%s, date '2026-07-16', 25) returning id""", (num,))
    cur.connection.commit()
    autenticar(cur, 'lucas')
    erro = deve_falhar(cur, """select public.admin_corrigir_julgado_cj(
                                 %s, '{"data_sessao":"2026-07-09"}'::jsonb, null)""",
                       (segundo,))
    assert 'sessão' in str(erro) or 'sessao' in str(erro)


@teste
def corrigir_data_da_sessao_reporta_o_vinculo_que_o_gatilho_cria(cur):
    """data_sessao está no `update of` do gatilho, que reatribui acervo_id sem
    pedir licença.

    O caso real é o do job da AGR: a pauta publicada trouxe um processo que
    ainda não tinha distribuição registrada (é o que pautas_cj.processos_sem_acervo
    contabiliza), então o julgado entrou sem vínculo. Quando a distribuição
    aparece e alguém corrige a data da sessão, o gatilho vincula tudo de uma
    vez — relator e data de distribuição inclusive. A operação não pode ser
    silenciosa sobre isso: quem corrigiu uma data precisa saber que mexeu em
    quatro campos.
    """
    num = numero()
    julgado_id = como_dono(cur, """
        insert into public.julgados_cj (num_processo, data_sessao, pauta)
        values (%s, date '2026-07-09', 24) returning id""", (num,))
    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'acervo_id, relator') == (None, None)

    dist = como_dono(cur, """
        insert into public.acervo_cj
          (num_processo, relator, data_distribuicao, defesa, origem)
        values (%s, 'CJ1', date '2026-07-30', false, 'sorteio') returning id""", (num,))
    cur.connection.commit()

    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_cj(
                     %s, '{"data_sessao":"2026-08-13"}'::jsonb, 'data digitada errada')""",
                (julgado_id,))
    retorno = cur.fetchone()[0]
    assert retorno['alterados']['acervo_id'] == {'antes': None, 'depois': dist}
    assert retorno['alterados']['relator'] == {'antes': None, 'depois': 'CJ1'}

    cur.execute('reset role')
    registros = auditoria(cur, 'julgados_cj', julgado_id)
    assert registros and registros[-1][2]['acervo_id'] == dist


@teste
def religar_julgado_rederiva_do_acervo(cur):
    """Cura o AVISO 'Relator divergente do acervo vinculado' de verificacao_cj.sql."""
    num, acervo_id, julgado_id = cenario_cj(cur, relator='CJ3')
    como_dono(cur, "update public.acervo_cj set relator = 'CJ5' where id = %s", (acervo_id,))
    cur.connection.commit()

    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'relator')[0] == 'CJ3'

    autenticar(cur, 'lucas')
    cur.execute('select public.admin_religar_julgado_cj(%s, %s)',
                (julgado_id, 'realinhar com o acervo'))
    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'relator, acervo_id') == ('CJ5', acervo_id)


# ── Correção de acervo, com e sem propagação ─────────────────────────────────

@teste
def corrigir_acervo_propaga_para_os_julgados(cur):
    num, acervo_id, julgado_id = cenario_cj(cur, relator='CJ3', defesa=True)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_acervo_cj(
                     %s, '{"relator":"CJ4"}'::jsonb, 'ata diz CJ4')""", (acervo_id,))
    retorno = cur.fetchone()[0]
    assert retorno['propagados'] == [julgado_id]

    cur.execute('reset role')
    assert julgado(cur, 'acervo_cj', acervo_id, 'relator')[0] == 'CJ4'
    assert julgado(cur, 'julgados_cj', julgado_id, 'relator, acervo_id') == ('CJ4', acervo_id)


@teste
def redistribuir_nao_toca_nos_julgados(cur):
    """O julgado registra quem de fato levou o processo à mesa: redistribuição
    posterior não reescreve o passado."""
    num, acervo_id, julgado_id = cenario_cj(cur, relator='CJ3')
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_redistribuir_cj(
                     %s, '{"relator":"CJ4"}'::jsonb, 'processo redistribuído')""",
                (acervo_id,))
    retorno = cur.fetchone()[0]
    assert retorno['propagados'] == []

    cur.execute('reset role')
    assert julgado(cur, 'acervo_cj', acervo_id, 'relator')[0] == 'CJ4'
    assert julgado(cur, 'julgados_cj', julgado_id, 'relator')[0] == 'CJ3'


@teste
def a_intencao_declarada_fica_no_rastro(cur):
    """Duas funções, dois rótulos: não dá para redistribuir alegando correção."""
    _, acervo_um, _ = cenario_cj(cur)
    _, acervo_dois, _ = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_acervo_cj(%s, '{\"ordem\":9}'::jsonb, null)",
                (acervo_um,))
    cur.execute("select public.admin_redistribuir_cj(%s, '{\"ordem\":9}'::jsonb, null)",
                (acervo_dois,))
    cur.execute('reset role')
    assert auditoria(cur, 'acervo_cj', acervo_um)[0][0] == 'corrigir_acervo'
    assert auditoria(cur, 'acervo_cj', acervo_dois)[0][0] == 'redistribuir'


@teste
def corrigir_acervo_recusa_colisao_de_distribuicao(cur):
    """acervo_cj_distribuicao_unica: mesmo processo, mesma data, mesmo relator."""
    num, primeiro, _ = cenario_cj(cur, relator='CJ3', data_dist='2026-06-18')
    segundo = como_dono(cur, """
        insert into public.acervo_cj (num_processo, relator, data_distribuicao, origem)
        values (%s, 'CJ4', date '2026-06-18', 'sorteio') returning id""", (num,))
    cur.connection.commit()
    autenticar(cur, 'lucas')
    deve_falhar(cur, """select public.admin_corrigir_acervo_cj(
                          %s, '{"relator":"CJ3"}'::jsonb, null)""", (segundo,))


@teste
def corrigir_acervo_creg_aceita_o_vocabulario_do_conselho(cur):
    num, acervo_id, julgado_id = cenario_creg(cur, unidade='CREG2', recurso='Com recurso')
    cur.connection.commit()
    autenticar(cur, 'sec-agr')
    cur.execute("""select public.admin_corrigir_acervo_creg(
                     %s, '{"unidade":"CREG3","recurso":"Sem recurso",
                            "interessado":"Beltrano"}'::jsonb, 'ata do sorteio')""",
                (acervo_id,))
    cur.execute('reset role')
    assert julgado(cur, 'acervo_creg', acervo_id,
                   'unidade, recurso, interessado') == ('CREG3', 'Sem recurso', 'Beltrano')
    assert julgado(cur, 'julgados_creg', julgado_id, 'unidade, recurso') == ('CREG3', 'Sem recurso')


@teste
def acervo_cj_nao_aceita_campo_do_creg(cur):
    """Princípio 4 do produto: a lógica de um colegiado não vaza para o outro."""
    _, acervo_id, _ = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    deve_falhar(cur, """select public.admin_corrigir_acervo_cj(
                          %s, '{"unidade":"CREG1"}'::jsonb, null)""",
                (acervo_id,), codigo='22023')


# ── Correção do número do processo ───────────────────────────────────────────

@teste
def corrigir_numero_do_processo_em_tudo(cur):
    num, acervo_id, julgado_id = cenario_cj(cur)
    novo = numero()
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_processo_cj(%s, %s, 'tudo', 'digitação')",
                (num, novo))
    retorno = cur.fetchone()[0]
    assert retorno['acervo'] == [acervo_id]
    assert retorno['julgados'] == [julgado_id]

    cur.execute('reset role')
    assert julgado(cur, 'acervo_cj', acervo_id, 'num_processo')[0] == novo
    # O acervo é renumerado ANTES dos julgados: se fosse ao contrário, o gatilho
    # procuraria o número novo num acervo que ainda não o tem e zeraria o vínculo.
    assert julgado(cur, 'julgados_cj', julgado_id, 'num_processo, acervo_id') == (novo, acervo_id)


@teste
def corrigir_numero_do_processo_so_no_acervo(cur):
    num, acervo_id, julgado_id = cenario_cj(cur)
    novo = numero()
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_processo_cj(%s, %s, 'acervo', null)", (num, novo))
    retorno = cur.fetchone()[0]
    # Renumerar só o acervo deixaria o julgado apontando para um processo
    # DIFERENTE — o ERRO 'Julgado apontando para processo diferente no acervo'
    # de verificacao_cj.sql. A RPC rederiva os julgados afetados, e o vínculo
    # cai em vez de mentir.
    assert retorno['desvinculados'] == [julgado_id]

    cur.execute('reset role')
    assert julgado(cur, 'acervo_cj', acervo_id, 'num_processo')[0] == novo
    assert julgado(cur, 'julgados_cj', julgado_id, 'num_processo, acervo_id') == (num, None)


@teste
def corrigir_numero_recusa_formato_invalido(cur):
    num, _, _ = cenario_cj(cur)
    cur.connection.commit()
    for invalido in ['12345', '20260000000000A', '2026000000000012']:
        autenticar(cur, 'lucas')
        deve_falhar(cur, "select public.admin_corrigir_processo_cj(%s, %s, 'tudo', null)",
                    (num, invalido), codigo='22023')


@teste
def corrigir_numero_recusa_escopo_desconhecido(cur):
    num, _, _ = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    deve_falhar(cur, "select public.admin_corrigir_processo_cj(%s, %s, 'metade', null)",
                (num, numero()), codigo='22023')


@teste
def corrigir_numero_recusa_processo_inexistente(cur):
    autenticar(cur, 'lucas')
    deve_falhar(cur, "select public.admin_corrigir_processo_cj(%s, %s, 'tudo', null)",
                ('209900000000001', numero()), codigo='22023')


# ── Auditoria ────────────────────────────────────────────────────────────────

@teste
def toda_correcao_deixa_rastro_com_autor_e_delta(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_cj(
                     %s, '{"voto":"Anular"}'::jsonb, 'ata confere Anular')""", (julgado_id,))
    cur.execute('reset role')
    registros = auditoria(cur, 'julgados_cj', julgado_id)
    assert len(registros) == 1
    operacao, antes, depois, motivo, feito_por = registros[0]
    assert operacao == 'corrigir_julgado'
    assert antes['voto'] == 'Manter' and depois['voto'] == 'Anular'
    assert motivo == 'ata confere Anular'
    assert feito_por == 'lucas@goias.gov.br'


@teste
def propagacao_grava_uma_linha_por_registro_tocado(cur):
    num, acervo_id, julgado_id = cenario_cj(cur)
    segundo_julgado = como_dono(cur, """
        insert into public.julgados_cj (num_processo, data_sessao, pauta)
        values (%s, date '2026-07-16', 25) returning id""", (num,))
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_acervo_cj(
                     %s, '{"relator":"CJ4"}'::jsonb, null)""", (acervo_id,))
    retorno = cur.fetchone()[0]
    assert sorted(retorno['propagados']) == sorted([julgado_id, segundo_julgado])

    cur.execute('reset role')
    assert len(auditoria(cur, 'acervo_cj', acervo_id)) == 1
    assert len(auditoria(cur, 'julgados_cj', julgado_id)) == 1
    assert len(auditoria(cur, 'julgados_cj', segundo_julgado)) == 1


@teste
def auditoria_e_append_only_ate_para_o_admin(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_julgado_cj(%s, '{\"voto\":\"Anular\"}'::jsonb, null)",
                (julgado_id,))
    cur.connection.commit()

    autenticar(cur, 'lucas')
    deve_negar(cur, """insert into public.auditoria_admin
                        (orgao, operacao, tabela, registro_id, antes, depois, feito_por)
                        values ('CJ','forjada','julgados_cj',1,'{}'::jsonb,'{}'::jsonb,'x')""")
    autenticar(cur, 'lucas')
    deve_negar(cur, "update public.auditoria_admin set motivo = 'outro'")
    autenticar(cur, 'lucas')
    deve_negar(cur, 'delete from public.auditoria_admin')


@teste
def operador_nao_le_a_auditoria(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_julgado_cj(%s, '{\"voto\":\"Anular\"}'::jsonb, null)",
                (julgado_id,))
    cur.connection.commit()

    for nome in OPERADORES + ['sem-acesso']:
        autenticar(cur, nome)
        cur.execute('select count(*) from public.auditoria_admin')
        assert cur.fetchone()[0] == 0, f'{nome} enxergou a auditoria'


@teste
def admin_de_um_orgao_nao_le_a_auditoria_do_outro(cur):
    """A policy filtra pelo órgão da linha, não pelo fato de ser admin."""
    cur.execute('reset role')
    cur.execute("""update public.permissoes_usuario set papel = 'admin'
                    where user_id = %s and orgao = 'CJ'""", (USUARIOS['terezinha'],))
    _, _, julgado_creg = cenario_creg(cur)
    cur.connection.commit()

    autenticar(cur, 'sec-agr')
    cur.execute("select public.admin_corrigir_julgado_creg(%s, '{\"voto\":\"Anular\"}'::jsonb, null)",
                (julgado_creg,))
    cur.connection.commit()

    autenticar(cur, 'terezinha')
    cur.execute("select count(*) from public.auditoria_admin where orgao = 'CREG'")
    assert cur.fetchone()[0] == 0

    cur.execute('reset role')
    cur.execute("""update public.permissoes_usuario set papel = 'operador'
                    where user_id = %s and orgao = 'CJ'""", (USUARIOS['terezinha'],))
    cur.connection.commit()


@teste
def auditoria_lista_do_mais_recente_para_o_mais_antigo(cur):
    _, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    for voto in ['Anular', 'Vista', 'Manter']:
        cur.execute('select public.admin_corrigir_julgado_cj(%s, %s::jsonb, null)',
                    (julgado_id, json.dumps({'voto': voto})))
    cur.execute("""select id from public.admin_auditoria('CJ', 3, null)""")
    ids = [linha[0] for linha in cur.fetchall()]
    assert ids == sorted(ids, reverse=True)


# ── Leitura ──────────────────────────────────────────────────────────────────

@teste
def sessoes_listam_pendencias_por_data(cur):
    num, _, julgado_id = cenario_cj(cur, data_sessao='2026-09-03', pauta=31,
                                    voto=None, status=None)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select data_sessao, pauta, processos, pendentes
                     from public.admin_sessoes('CJ')
                    where data_sessao = date '2026-09-03'""")
    linha = cur.fetchone()
    assert linha[1] == 31 and linha[2] >= 1 and linha[3] >= 1


@teste
def processos_da_sessao_trazem_id_e_vinculo(cur):
    num, acervo_id, julgado_id = cenario_cj(cur, data_sessao='2026-09-10')
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select id, num_processo, destino, acervo_id
                     from public.admin_processos_sessao('CJ', date '2026-09-10', 24)
                    where id = %s""", (julgado_id,))
    assert cur.fetchone() == (julgado_id, num, 'CJ3', acervo_id)


@teste
def processos_da_sessao_separam_as_pautas_do_mesmo_dia(cur):
    """admin_sessoes devolve uma linha por (data, pauta).

    Filtrando só pela data, as duas linhas abriam a MESMA tabela — com o total
    das duas contradizendo a contagem da linha clicada.
    """
    _, _, primeiro = cenario_cj(cur, data_sessao='2026-09-17', pauta=40)
    _, _, segundo = cenario_cj(cur, data_sessao='2026-09-17', pauta=41)
    cur.connection.commit()
    autenticar(cur, 'lucas')

    cur.execute("""select id from public.admin_processos_sessao('CJ', date '2026-09-17', 40)""")
    assert [linha[0] for linha in cur.fetchall()] == [primeiro]
    cur.execute("""select id from public.admin_processos_sessao('CJ', date '2026-09-17', 41)""")
    assert [linha[0] for linha in cur.fetchall()] == [segundo]

    cur.execute("""select count(*) from public.admin_sessoes('CJ')
                    where data_sessao = date '2026-09-17'""")
    assert cur.fetchone()[0] == 2, 'a lista continua mostrando as duas pautas'


@teste
def processos_da_sessao_alcancam_a_sessao_sem_pauta(cur):
    """`is not distinct from`, e não `=`: com `=` a sessão sem número sumiria."""
    _, _, sem_numero = cenario_cj(cur, data_sessao='2026-09-24', pauta=None)
    _, _, com_numero = cenario_cj(cur, data_sessao='2026-09-24', pauta=42)
    cur.connection.commit()
    autenticar(cur, 'lucas')

    cur.execute("""select id from public.admin_processos_sessao('CJ', date '2026-09-24', null)""")
    assert [linha[0] for linha in cur.fetchall()] == [sem_numero]
    cur.execute("""select id from public.admin_processos_sessao('CJ', date '2026-09-24', 42)""")
    assert [linha[0] for linha in cur.fetchall()] == [com_numero]


@teste
def sorteios_incluem_o_que_o_historico_esconde(cur):
    """O histórico corta em origem='sorteio' e no marco. O painel não pode:
    é justamente o registro antigo ou importado que costuma precisar de conserto."""
    num = numero()
    como_dono(cur, """
        insert into public.acervo_cj (num_processo, relator, data_distribuicao, origem)
        values (%s, 'CJ2', date '2024-03-11', 'planilha')""", (num,))
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select origem, processos from public.admin_sorteios('CJ')
                    where data_distribuicao = date '2024-03-11'""")
    assert cur.fetchone() == ('planilha', 1)


@teste
def processos_do_acervo_trazem_id_para_edicao(cur):
    num, acervo_id, _ = cenario_cj(cur, data_dist='2026-05-07')
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select id, num_processo, destino from public.admin_processos_acervo(
                     'CJ', date '2026-05-07', timestamptz '2026-06-18 10:00-03', 'sorteio')
                    where id = %s""", (acervo_id,))
    assert cur.fetchone() == (acervo_id, num, 'CJ3')


@teste
def preview_de_impacto_lista_os_julgados_afetados(cur):
    num, acervo_id, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute('select id, num_processo from public.admin_julgados_do_acervo(%s, %s)',
                ('CJ', acervo_id))
    assert cur.fetchall() == [(julgado_id, num)]


# ── Regressões da segunda revisão ────────────────────────────────────────────
# Tudo abaixo nasceu de defeito encontrado em revisão, não de requisito novo.


@teste
def propagacao_conta_so_os_julgados_que_mudaram(cur):
    """`propagados` alimenta a frase "N julgados seguiram a correção".

    Um julgado que já carregava o valor corrigido não gera linha de auditoria, e
    contá-lo fazia a tela anunciar mais registros alterados do que o rastro
    guarda — em cima da mesma operação.
    """
    num, acervo_id, ja_certo = cenario_cj(cur, relator='CJ3')
    como_dono(cur, 'update public.julgados_cj set relator = %s where id = %s',
              ('CJ4', ja_certo))
    vai_mudar = como_dono(cur, """
        insert into public.julgados_cj (num_processo, data_sessao, pauta)
        values (%s, date '2026-07-16', 25) returning id""", (num,))
    cur.connection.commit()

    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_acervo_cj(
                     %s, '{"relator":"CJ4"}'::jsonb, null)""", (acervo_id,))
    retorno = cur.fetchone()[0]
    assert retorno['propagados'] == [vai_mudar], retorno['propagados']

    cur.execute('reset role')
    assert len(auditoria(cur, 'julgados_cj', ja_certo)) == 0, \
        'sem delta não há rastro — e sem rastro não pode haver contagem'
    assert len(auditoria(cur, 'julgados_cj', vai_mudar)) == 1


@teste
def propagacao_creg_conta_so_os_julgados_que_mudaram(cur):
    num, acervo_id, ja_certo = cenario_creg(cur, unidade='CREG2')
    como_dono(cur, 'update public.julgados_creg set unidade = %s where id = %s',
              ('CREG3', ja_certo))
    vai_mudar = como_dono(cur, """
        insert into public.julgados_creg (num_processo, data_sessao, pauta)
        values (%s, date '2026-07-17', 13) returning id""", (num,))
    cur.connection.commit()

    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_acervo_creg(
                     %s, '{"unidade":"CREG3"}'::jsonb, null)""", (acervo_id,))
    assert cur.fetchone()[0]['propagados'] == [vai_mudar]


@teste
def acervo_recusa_data_em_branco_com_a_mensagem_certa(cur):
    """A guarda testava `->> ... is null`, que não pega a string vazia.

    Um <input type="date"> limpo manda `""`: a validação passava direto e o
    ''::date estourava com erro cru do Postgres, em vez do 22023 escrito para a
    tela. As funções de julgado já usavam `nullif`, e é o idioma agora.
    """
    _, acervo_cj_id, _ = cenario_cj(cur)
    _, acervo_creg_id, _ = cenario_creg(cur)
    cur.connection.commit()

    for porta, registro in [('admin_corrigir_acervo_cj', acervo_cj_id),
                            ('admin_corrigir_acervo_creg', acervo_creg_id)]:
        autenticar(cur, 'lucas')
        erro = deve_falhar(cur,
                           f"""select public.{porta}(
                                 %s, '{{"data_distribuicao":""}}'::jsonb, null)""",
                           (registro,), codigo='22023')
        assert 'data de distribuicao nao pode ficar vazia' in str(erro), erro


@teste
def acervo_aceita_apagar_a_ordem_em_branco(cur):
    """Ordem vazia é apagar a ordem — a planilha importada nunca a teve.

    Antes o cast de '' estourava aqui também, com erro de sintaxe de inteiro.
    """
    _, acervo_id, _ = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_acervo_cj(
                     %s, '{"ordem":""}'::jsonb, 'ordem nao se aplica')""", (acervo_id,))
    assert cur.fetchone()[0]['alterados']['ordem']['depois'] is None

    cur.execute('reset role')
    assert julgado(cur, 'acervo_cj', acervo_id, 'ordem')[0] is None


@teste
def renumerar_so_os_julgados_reporta_o_vinculo_perdido(cur):
    """Sem renumerar o acervo, o gatilho não acha o número novo e o vínculo cai.

    É consequência correta, mas voltava só no rastro: `desvinculados` chegava
    vazio ao chamador e a tela não tinha o que avisar.
    """
    num, acervo_id, julgado_id = cenario_cj(cur)
    novo = numero()
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_processo_cj(%s, %s, 'julgados', null)",
                (num, novo))
    retorno = cur.fetchone()[0]
    assert retorno['julgados'] == [julgado_id]
    assert retorno['acervo'] == []
    assert retorno['desvinculados'] == [julgado_id], retorno['desvinculados']

    cur.execute('reset role')
    assert julgado(cur, 'julgados_cj', julgado_id, 'num_processo, acervo_id') == (novo, None)
    assert julgado(cur, 'acervo_cj', acervo_id, 'num_processo')[0] == num


@teste
def renumerar_tudo_nao_desvincula_ninguem(cur):
    """O acervo vem primeiro justamente para o vínculo se manter."""
    num, _, _ = cenario_cj(cur)
    novo = numero()
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_processo_cj(%s, %s, 'tudo', null)", (num, novo))
    assert cur.fetchone()[0]['desvinculados'] == []


@teste
def auditoria_diz_de_qual_processo_se_trata(cur):
    """Chave interna não identifica nada para quem opera o sistema: cruzar o
    rastro com um processo exigia SQL direto no banco."""
    num, _, julgado_id = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select public.admin_corrigir_julgado_cj(
                     %s, '{"voto":"Anular"}'::jsonb, null)""", (julgado_id,))
    cur.execute("""select registro_id, num_processo from public.admin_auditoria('CJ', 5, null)
                    where tabela = 'julgados_cj' and registro_id = %s""", (julgado_id,))
    assert cur.fetchone() == (julgado_id, num)


@teste
def registros_do_processo_listam_o_que_a_renumeracao_alcanca(cur):
    """O preview da correção de número: a operação alcança TODA distribuição e
    TODO julgado com aquele número, e o diálogo abria a partir de uma linha só."""
    num, acervo_id, julgado_id = cenario_cj(cur, data_dist='2026-04-08',
                                            data_sessao='2026-05-13', pauta=17)
    segunda = como_dono(cur, """
        insert into public.acervo_cj
          (num_processo, relator, data_distribuicao, defesa, assunto, origem)
        values (%s, 'CJ5', date '2026-06-24', true, 'Auto de Infração', 'planilha')
        returning id""", (num,))
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select origem_registro, registro_id, data_referencia, pauta, destino, vinculado
                     from public.admin_registros_do_processo('CJ', %s)""", (num,))
    linhas = cur.fetchall()

    assert sorted(l[1] for l in linhas if l[0] == 'acervo') == sorted([acervo_id, segunda])
    julgados = [l for l in linhas if l[0] == 'julgados']
    assert len(julgados) == 1
    assert julgados[0][1] == julgado_id
    assert julgados[0][3] == 17
    assert julgados[0][5] is True, 'o preview precisa dizer quem já está vinculado'


@teste
def registros_do_processo_nao_vazam_o_outro_colegiado(cur):
    num, _, _ = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("select count(*) from public.admin_registros_do_processo('CREG', %s)", (num,))
    assert cur.fetchone()[0] == 0


@teste
def processos_do_acervo_separam_a_defesa_do_texto_legado(cur):
    """`decisao` cai no texto legado de `recurso` quando a defesa é nula — está
    certo para a TABELA. Lido como "antes" do formulário, fazia a confirmação
    prometer uma mudança diferente da que a auditoria registra."""
    num = numero()
    acervo_id = como_dono(cur, """
        insert into public.acervo_cj
          (num_processo, relator, data_distribuicao, defesa, recurso, assunto, origem)
        values (%s, 'CJ2', date '2024-03-12', null, 'Sim', 'Auto de Infração', 'planilha')
        returning id""", (num,))
    cur.connection.commit()
    autenticar(cur, 'lucas')
    cur.execute("""select decisao, defesa from public.admin_processos_acervo(
                     'CJ', date '2024-03-12', null, 'planilha')
                    where id = %s""", (acervo_id,))
    assert cur.fetchone() == ('Sim', None), 'o legado sai em decisao; defesa é o que se edita'


@teste
def acervo_recusa_distribuicao_no_futuro(cur):
    _, acervo_id, _ = cenario_cj(cur)
    cur.connection.commit()
    autenticar(cur, 'lucas')
    erro = deve_falhar(cur,
                       """select public.admin_corrigir_acervo_cj(
                            %s, '{"data_distribuicao":"2099-01-01"}'::jsonb, null)""",
                       (acervo_id,), codigo='22023')
    assert 'distribuicao no futuro' in str(erro), erro


# ── Integridade ──────────────────────────────────────────────────────────────

@teste
def correcoes_nao_deixam_erro_na_verificacao(cur):
    """Nenhuma operação do painel pode criar um ERRO que verificacao_*.sql acuse."""
    _, acervo_cj_id, julgado_cj_id = cenario_cj(cur)
    _, acervo_creg_id, julgado_creg_id = cenario_creg(cur)
    cur.connection.commit()

    autenticar(cur, 'lucas')
    cur.execute("select public.admin_corrigir_acervo_cj(%s, '{\"relator\":\"CJ5\"}'::jsonb, null)",
                (acervo_cj_id,))
    cur.execute("select public.admin_corrigir_julgado_cj(%s, '{\"voto\":\"Vista\"}'::jsonb, null)",
                (julgado_cj_id,))
    cur.execute('select public.admin_religar_julgado_cj(%s, null)', (julgado_cj_id,))
    cur.execute("select public.admin_corrigir_acervo_creg(%s, '{\"unidade\":\"CREG4\"}'::jsonb, null)",
                (acervo_creg_id,))
    cur.execute('select public.admin_religar_julgado_creg(%s, null)', (julgado_creg_id,))
    cur.connection.commit()

    cur.execute('reset role')
    for arquivo in ['verificacao_cj.sql', 'verificacao_creg.sql']:
        cur.execute((RAIZ / 'sql' / arquivo).read_text(encoding='utf-8'))
        erros = [linha for linha in cur.fetchall() if linha[1] == 'ERRO']
        assert not erros, f'{arquivo}: {erros}'


@teste
def schema_pode_ser_reaplicado(cur):
    """O schema.sql é o estado final desejado: rodar de novo não pode quebrar."""
    cur.execute('reset role')
    cur.connection.commit()
    PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')
    cur.execute("""select count(*) from public.permissoes_usuario
                    where papel = 'admin'""")
    assert cur.fetchone()[0] == 4


def preparar_banco():
    PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')
    PG.executar("""
        insert into public.permissoes_usuario (user_id, orgao, papel) values
          ('00000000-0000-0000-0000-000000000011', 'CREG', 'operador'),
          ('00000000-0000-0000-0000-000000000012', 'CJ',   'operador'),
          ('00000000-0000-0000-0000-000000000013', 'CJ',   'admin'),
          ('00000000-0000-0000-0000-000000000013', 'CREG', 'admin'),
          ('00000000-0000-0000-0000-000000000014', 'CJ',   'admin'),
          ('00000000-0000-0000-0000-000000000014', 'CREG', 'admin')
        on conflict (user_id, orgao) do update set papel = excluded.papel;""")


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
