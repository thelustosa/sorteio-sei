#!/usr/bin/env python3
"""Testes do Conselho Regulador contra um Postgres de verdade.

    python tests/test_creg.py

Sobe um container postgres descartável (é o mesmo motor do Supabase), aplica
schema.sql e confere que o banco reproduz as fórmulas da planilha do CREG:

    Assunto/DT DIST CR/Recurso  INDEX/MATCH em cascata nos quatro gabinetes
    Unidade CREG                1..4 conforme em qual arquivo o processo estava
    DIAS DIST SS/CR             =-Q+T   -> dias_dt
    META 45                     =SE(Z<=45;"DENTRO";"FORA")
    DIAS DIST CR/CJ             =-M+Q   -> dias_dist_cr_cj
    Per DT CR                   IF aninhado ano a ano
    Em relação à CJ             Voto CJ <> Voto CR, com a lista de exceções

Requisitos: docker e psycopg2.
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import psycopg2

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(RAIZ / 'sincronizacao'))
import banco           # noqa: E402
from banco import uma  # noqa: E402
import sincronizar     # noqa: E402

PG = banco.Postgres('sorteio_sei_creg_test')

testes = []

# Padrões usados por rotulos_da_pagina_batem_com_os_do_banco. Em constante, e
# não inline, porque são regex com aspas e barras que sujariam o teste.
FUNCAO_CREG = r'function public\.registrar_votos_creg\(itens jsonb\).*?\n\$\$;'
# julgados.js serve os dois colegiados: a lista do Conselho é a do bloco creg.
LISTA_VOTOS = r'\bcreg: \{.*?votos: \[([^\]]+)\]'
LISTA_STATUS = r'\bcreg: \{.*?status: \[([^\]]+)\]'
ACEITOS_VOTO = r"'voto', ''\)\s*not in\s*\(([^)]+)\)"
ACEITOS_STATUS = r"'status', ''\)\s*not in\s*\(([^)]+)\)"



def teste(fn):
    testes.append(fn)
    return fn


# ── Cenário ──────────────────────────────────────────────────────────────────

def limpar(cur):
    cur.execute('delete from julgados_creg; delete from acervo_creg;'
                ' delete from diligencias_creg')


def distribuir(cur, num, unidade, data, assunto='Auto de Infração',
               recurso='Sem recurso'):
    cur.execute("""insert into public.acervo_creg
                   (num_processo, unidade, data_distribuicao, assunto, recurso, origem)
                   values (%s, %s, %s, %s, %s, 'planilha') returning id""",
                (num, unidade, data, assunto, recurso))
    return cur.fetchone()[0]


def diligenciar(cur, num, data, linha=1, julgados='', retorno='NÃO'):
    """Uma linha da planilha de diligências.

    `retorno` é o que decide o recorte: 'NÃO' é diligência aberta (o processo
    está fora), 'SIM' é processo que voltou. O padrão é 'NÃO' porque quase todo
    teste daqui quer um processo EM diligência.
    """
    cur.execute("""insert into public.diligencias_creg
                   (num_processo, data_diligencia, descricao, retorno, julgados, linha)
                   values (%s, %s, 'Diligência para a CGST', %s, %s, %s)""",
                (num, data, retorno, julgados, linha))


def julgar(cur, num, sessao, **campos):
    colunas = ['num_processo', 'data_sessao'] + list(campos)
    valores = [num, sessao] + list(campos.values())
    lugares = ', '.join(['%s'] * len(colunas))
    cur.execute(f"""insert into public.julgados_creg ({', '.join(colunas)})
                    values ({lugares}) returning id""", valores)
    return cur.fetchone()[0]


def campos(cur, jid, *nomes):
    cur.execute(f"select {', '.join(nomes)} from public.julgados_creg where id = %s",
                (jid,))
    return cur.fetchone()


def retornos(cur, jid):
    cur.execute("""select id, unidade, data_distribuicao, origem
                     from public.acervo_creg where retorno_julgado_id = %s""", (jid,))
    return cur.fetchall()


def registrar(cur, itens):
    cur.execute('select public.registrar_votos_creg(%s::jsonb)',
                (json.dumps(itens),))
    return cur.fetchone()[0]


def como(cur, papel, sql, args=None):
    """Executa sob outro papel do Postgres, para medir o que a RLS deixa passar."""
    cur.execute(f'set local role {papel}')
    try:
        cur.execute(sql, args)
        return cur.fetchall()
    finally:
        cur.execute('reset role')


# ── Acervo → julgados ────────────────────────────────────────────────────────

@teste
def gatilho_traz_do_acervo_o_que_a_planilha_buscava(cur):
    """Assunto, recurso, unidade e data de distribuição saem do acervo."""
    limpar(cur)
    aid = distribuir(cur, '202400029000001', 'CREG2', date(2026, 3, 2),
                     assunto='Requerimento', recurso='Não se aplica')
    jid = julgar(cur, '202400029000001', date(2026, 4, 1), pauta=7)

    assert campos(cur, jid, 'acervo_id', 'unidade', 'assunto', 'recurso',
                  'data_distribuicao') == (aid, 'CREG2', 'Requerimento',
                                           'Não se aplica', date(2026, 3, 2))


@teste
def valor_informado_vence_o_derivado(cur):
    """A planilha tem colunas digitadas à mão; importar não pode sobrescrevê-las."""
    limpar(cur)
    distribuir(cur, '202400029000002', 'CREG1', date(2026, 3, 2))
    jid = julgar(cur, '202400029000002', date(2026, 4, 1),
                 unidade='CREG4', assunto='Outros')

    assert campos(cur, jid, 'unidade', 'assunto') == ('CREG4', 'Outros')


@teste
def gravar_null_forca_a_rederivacao(cur):
    limpar(cur)
    distribuir(cur, '202400029000003', 'CREG1', date(2026, 3, 2))
    jid = julgar(cur, '202400029000003', date(2026, 4, 1), unidade='CREG4')

    cur.execute('update public.julgados_creg set unidade = null where id = %s', (jid,))
    assert campos(cur, jid, 'unidade')[0] == 'CREG1'


@teste
def redistribuicao_posterior_nao_contamina_o_julgado(cur):
    """A regra que a planilha só acertava por acidente.

    O INDEX/MATCH pegava a primeira ocorrência do processo na ordem dos
    arquivos. Aqui vale a última distribuição ocorrida ATÉ a sessão: quem de
    fato levou o processo à mesa naquele dia.
    """
    limpar(cur)
    distribuir(cur, '202400029000004', 'CREG1', date(2026, 1, 10))
    distribuir(cur, '202400029000004', 'CREG3', date(2026, 2, 20))
    distribuir(cur, '202400029000004', 'CREG4', date(2026, 6, 30))  # depois da sessão

    jid = julgar(cur, '202400029000004', date(2026, 4, 1))
    assert campos(cur, jid, 'unidade', 'data_distribuicao') == ('CREG3', date(2026, 2, 20))


@teste
def distribuicao_toda_posterior_a_sessao_cai_na_mais_antiga(cur):
    """Equivale ao INDEX/MATCH da planilha quando não há candidata anterior."""
    limpar(cur)
    distribuir(cur, '202400029000005', 'CREG2', date(2026, 9, 1))
    distribuir(cur, '202400029000005', 'CREG3', date(2026, 10, 1))

    jid = julgar(cur, '202400029000005', date(2026, 4, 1))
    assert campos(cur, jid, 'unidade')[0] == 'CREG2'


@teste
def empate_de_unidade_nao_troca_de_vinculo_na_rederivacao(cur):
    """A mesma distribuição em duas unidades é legal, e o vínculo tem de ficar parado.

    Caso real do banco: 202500029003459, distribuído em 19/09/2025 para o CREG3
    e para o CREG4. Os dois ramos do gatilho desempatavam em direções opostas,
    então bastava mexer no julgado para o vínculo migrar para a linha da outra
    unidade — com `unidade` mantida pelo coalesce, virando a divergência que o
    verificacao_creg.sql acusa. Quem desempata é a unidade que o julgado traz.
    """
    limpar(cur)
    creg3 = distribuir(cur, '202500029003459', 'CREG3', date(2025, 9, 19))
    creg4 = distribuir(cur, '202500029003459', 'CREG4', date(2025, 9, 19))
    assert creg3 < creg4, 'o teste depende de o CREG3 ter entrado primeiro'

    # Como a planilha traz: unidade e data informadas -> primeiro ramo.
    jid = julgar(cur, '202500029003459', date(2026, 3, 12),
                 unidade='CREG3', data_distribuicao=date(2025, 9, 19))
    assert campos(cur, jid, 'acervo_id', 'unidade') == (creg3, 'CREG3')

    # É o que sql/rederivar_creg.sql faz: gravar o campo derivado nele mesmo.
    cur.execute('update public.julgados_creg set data_distribuicao = data_distribuicao'
                ' where id = %s', (jid,))
    assert campos(cur, jid, 'acervo_id', 'unidade') == (creg3, 'CREG3'), (
        'a rederivação moveu o vínculo para a linha da outra unidade')

    # O julgado do CREG4 na mesma data ancora na linha dele, não na primeira.
    outro = julgar(cur, '202500029003459', date(2026, 4, 23),
                   unidade='CREG4', data_distribuicao=date(2025, 9, 19))
    assert campos(cur, outro, 'acervo_id', 'unidade') == (creg4, 'CREG4')

    # E quem chega sem unidade — o sincronizador — também fica estável: o
    # segundo ramo escolhe, o coalesce grava a unidade, e o primeiro confirma.
    limpar(cur)
    distribuir(cur, '202500029003459', 'CREG3', date(2025, 9, 19))
    distribuir(cur, '202500029003459', 'CREG4', date(2025, 9, 19))
    sync = julgar(cur, '202500029003459', date(2026, 3, 12))
    antes = campos(cur, sync, 'acervo_id', 'unidade')
    cur.execute('update public.julgados_creg set data_distribuicao = data_distribuicao'
                ' where id = %s', (sync,))
    assert campos(cur, sync, 'acervo_id', 'unidade') == antes


@teste
def processo_fora_do_acervo_entra_sem_vinculo(cur):
    """1.397 julgados do histórico são anteriores às planilhas de gabinete.

    Sem acervo, `acervo_id` fica nulo — e SÓ ele. O que a importação trouxe da
    própria aba Página continua no lugar, e é por isso que esses registros
    seguem entrando nos indicadores de prazo: em produção, 1.437 dos 1.444 sem
    vínculo têm unidade, e todos têm dias_dt e meta_45.
    """
    limpar(cur)

    # Como o histórico realmente entra: unidade e data vêm da planilha.
    completo = julgar(cur, '202300029009999', date(2023, 5, 4), voto='Manter',
                      status='Julgado', unidade='CREG2',
                      data_distribuicao=date(2023, 4, 4))
    assert campos(cur, completo, 'acervo_id') == (None,)
    assert campos(cur, completo, 'unidade', 'dias_dt', 'meta_45') ==         ('CREG2', 30, True)

    # E o caso em que nem a planilha tinha o dado: aí sim tudo fica nulo.
    vazio = julgar(cur, '202300029009998', date(2023, 5, 4))
    assert campos(cur, vazio, 'acervo_id', 'unidade', 'dias_dt') == (None, None, None)


# ── As colunas que a planilha calculava ──────────────────────────────────────

@teste
def dias_e_meta_45_reproduzem_as_formulas(cur):
    limpar(cur)
    distribuir(cur, '202400029000010', 'CREG1', date(2026, 3, 1))
    dentro = julgar(cur, '202400029000010', date(2026, 4, 15))  # 45 dias exatos
    distribuir(cur, '202400029000011', 'CREG1', date(2026, 3, 1))
    fora = julgar(cur, '202400029000011', date(2026, 4, 16))    # 46

    assert campos(cur, dentro, 'dias_dt', 'meta_45') == (45, True)
    assert campos(cur, fora, 'dias_dt', 'meta_45') == (46, False)


@teste
def dias_entre_a_camara_e_o_conselho(cur):
    """"DIAS DIST CR/CJ" = data de distribuição no CREG menos a da CJ."""
    limpar(cur)
    distribuir(cur, '202400029000012', 'CREG1', date(2026, 3, 11))
    jid = julgar(cur, '202400029000012', date(2026, 4, 1),
                 data_dist_cj=date(2026, 1, 10))

    assert campos(cur, jid, 'dias_dist_cr_cj')[0] == 60


@teste
def periodo_dt_e_o_trimestre_da_sessao(cur):
    limpar(cur)
    esperado = [(date(2022, 12, 20), '<22'), (date(2023, 3, 31), '1T23'),
                (date(2024, 7, 1), '3T24'), (date(2026, 10, 5), '4T26'),
                (date(2027, 1, 5), '1T27')]
    for i, (sessao, periodo) in enumerate(esperado):
        jid = julgar(cur, f'20240002900002{i}', sessao)
        assert campos(cur, jid, 'periodo_dt')[0] == periodo, sessao


@teste
def em_relacao_a_cj_marca_a_divergencia(cur):
    """Anular na CJ e não anular no CREG tem nome próprio na planilha."""
    limpar(cur)
    a = julgar(cur, '202400029000030', date(2026, 4, 1),
               voto='Manter', status='Julgado', voto_cj='Anular')
    b = julgar(cur, '202400029000031', date(2026, 4, 1),
               voto='Anular', status='Julgado', voto_cj='Manter')
    c = julgar(cur, '202400029000032', date(2026, 4, 1),
               voto='Manter', status='Julgado', voto_cj='Manter')

    assert campos(cur, a, 'em_relacao_cj')[0] == 'Divergente-Não Revel'
    assert campos(cur, b, 'em_relacao_cj')[0] == 'Divergente'
    assert campos(cur, c, 'em_relacao_cj')[0] is None


@teste
def em_relacao_a_cj_fica_vazio_onde_a_formula_excluia(cur):
    """Retirado e decisões que não são sobre o mérito do auto não comparam."""
    limpar(cur)
    casos = [
        dict(voto='Retirado', status='Retirado', voto_cj='Manter'),
        dict(voto='Manter',   status='Retirado', voto_cj='Anular'),
        dict(voto='Aprovação', status='Julgado', voto_cj='Manter'),
        dict(voto='Indeferimento', status='Julgado', voto_cj='Manter'),
        dict(voto='Manter',   status='Julgado', voto_cj=None),
        dict(voto=None,       status='Julgado', voto_cj='Anular'),
    ]
    for i, caso in enumerate(casos):
        jid = julgar(cur, f'20240002900004{i}', date(2026, 4, 1), **caso)
        assert campos(cur, jid, 'em_relacao_cj')[0] is None, caso


# ── Painel ───────────────────────────────────────────────────────────────────

def autenticado(cur):
    """Faz auth.uid() devolver alguém: as RPCs do painel exigem sessão."""
    cur.execute("""select set_config('request.jwt.claims',
                     '{"sub":"00000000-0000-0000-0000-000000000001",
                       "email":"secretaria@agr.go.gov.br"}', true)""")


@teste
def painel_conta_so_o_que_nunca_foi_julgado(cur):
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000050', 'CREG1', date.today())            # pendente
    distribuir(cur, '202400029000051', 'CREG1', date.today())            # julgado
    julgar(cur, '202400029000051', date.today())

    cur.execute("select processos from resumo_acervo_creg()"
                " where ordem = 1 and unidade = 'CREG1'")
    assert cur.fetchone()[0] == 1


@teste
def redistribuido_conta_uma_vez_na_unidade_atual(cur):
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000052', 'CREG1', date.today())
    distribuir(cur, '202400029000052', 'CREG3', date.today())

    cur.execute('select unidade, processos from resumo_acervo_creg()'
                ' where ordem = 1 and processos > 0')
    assert cur.fetchall() == [('CREG3', 1)]


@teste
def redistribuicao_depois_do_julgado_volta_ao_painel(cur):
    """Julgado antigo não pode esconder a distribuição que veio depois dele.

    julgados_creg tem julgado desde 2023, e "não julgado" era "não aparece na
    tabela", sem correlação de data nenhuma: processo julgado em 2024 e sorteado
    de novo em 2026 sumia do painel — distribuído e invisível, que é justamente
    o caso que o painel existe para mostrar.
    """
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000070', 'CREG1', date(2024, 3, 12))
    julgar(cur, '202400029000070', date(2024, 6, 20),
           voto='Manter', status='Julgado')
    distribuir(cur, '202400029000070', 'CREG2', date.today())

    cur.execute('select unidade, processos from resumo_acervo_creg()'
                ' where processos > 0')
    assert cur.fetchall() == [('CREG2', 1)], 'a redistribuição tem de aparecer'

    cur.execute("select num_processo, unidade from processos_acervo_creg()")
    assert cur.fetchall() == [('202400029000070', 'CREG2')]


@teste
def julgado_da_propria_distribuicao_continua_tirando_do_painel(cur):
    """A correlação de data não pode devolver ao painel quem já foi julgado.

    Inclusive quem foi à mesa e voltou sem decisão: Vista e Retirado têm fila
    própria, que é a tela de registro.
    """
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000071', 'CREG1', date(2026, 6, 1))
    julgar(cur, '202400029000071', date(2026, 6, 1))          # mesma data
    distribuir(cur, '202400029000072', 'CREG1', date(2026, 6, 1))
    julgar(cur, '202400029000072', date(2026, 6, 17), status='Vista')

    cur.execute('select coalesce(sum(processos), 0) from resumo_acervo_creg()')
    assert cur.fetchone()[0] == 0


@teste
def detalhe_confere_celula_a_celula_com_o_painel(cur):
    """O card abre exatamente o número que o bloco mostrava."""
    limpar(cur)
    autenticado(cur)
    for i, (unidade, dias) in enumerate([('CREG1', 3), ('CREG1', 40),
                                         ('CREG2', 200), ('CREG4', 800)]):
        distribuir(cur, f'20240002900006{i}', unidade,
                   date.fromordinal(date.today().toordinal() - dias))

    cur.execute('select ordem, unidade, processos from resumo_acervo_creg()')
    for ordem, unidade, processos in cur.fetchall():
        cur.execute('select count(*) from processos_acervo_creg(%s, %s)',
                    (ordem, unidade))
        assert cur.fetchone()[0] == processos, (ordem, unidade)

    cur.execute('select count(*) from processos_acervo_creg()')
    assert cur.fetchone()[0] == 4


@teste
def o_painel_do_creg_nao_expoe_nome_de_pessoa(cur):
    """Os responsáveis por CREG1..4 pediram para não ter os nomes vinculados.

    Não existe de-para de unidades no Conselho, e as duas RPCs do painel não
    têm coluna para um: o painel devolve a unidade e nada além dela. Este teste
    é a trava — reintroduzir a coluna exige autorização das unidades, não só
    uma migração.
    """
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000070', 'CREG1', date.today())

    assert uma(cur, "select to_regclass('public.cadeiras_creg')") is None

    for rpc in ['resumo_acervo_creg()', 'processos_acervo_creg()']:
        cur.execute(f'select * from {rpc} limit 1')
        colunas = [d.name for d in cur.description]
        assert 'conselheiro' not in colunas, rpc

    cur.execute("select unidade from resumo_acervo_creg()"
                " where ordem = 1 and processos > 0")
    assert cur.fetchall() == [('CREG1',)]


# ── Painel · recorte por diligência ──────────────────────────────────────────
# Um processo em diligência está parado por decisão do colegiado, não por
# atraso de quem o relata. Sem o recorte, os dois casos somam na mesma célula.


@teste
def recorte_separa_quem_esta_em_diligencia(cur):
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000080', 'CREG1', date.today())
    distribuir(cur, '202400029000081', 'CREG1', date.today())
    diligenciar(cur, '202400029000081', date.today())

    def soma(recorte):
        cur.execute('select coalesce(sum(processos), 0) from resumo_acervo_creg(%s)',
                    (recorte,))
        return cur.fetchone()[0]

    assert (soma(None), soma(True), soma(False)) == (2, 1, 1)

    cur.execute('select num_processo from processos_acervo_creg(null, null, true)')
    assert cur.fetchall() == [('202400029000081',)]
    cur.execute('select num_processo from processos_acervo_creg(null, null, false)')
    assert cur.fetchall() == [('202400029000080',)]


@teste
def diligencia_anterior_a_redistribuicao_nao_conta(cur):
    """A guarda de data: redistribuído depois da diligência não está em diligência.

    O processo foi a diligência, voltou, foi julgado e foi sorteado de novo. A
    distribuição nova nada tem a ver com aquela diligência — sem comparar as
    datas, ele ficaria marcado em diligência para sempre.
    """
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000082', 'CREG1', date(2026, 1, 10))
    diligenciar(cur, '202400029000082', date(2026, 2, 10))
    julgar(cur, '202400029000082', date(2026, 3, 10),
           voto='Manter', status='Julgado')
    distribuir(cur, '202400029000082', 'CREG2', date.today())

    cur.execute('select coalesce(sum(processos), 0) from resumo_acervo_creg(true)')
    assert cur.fetchone()[0] == 0, 'a diligência antiga não segue a redistribuição'

    # E ele continua no painel sem filtro, na unidade nova.
    cur.execute('select unidade, processos from resumo_acervo_creg()'
                ' where processos > 0')
    assert cur.fetchall() == [('CREG2', 1)]


@teste
def recorte_escolhe_depois_de_achar_a_distribuicao_atual(cur):
    """O filtro não pode ressuscitar uma distribuição que já foi substituída.

    Aplicado antes do `distinct on`, o recorte deixaria a distribuição ANTIGA
    (que casa com a diligência) vencer a atual (que não casa), e o processo
    entraria na matriz com a unidade e o tempo errados.
    """
    limpar(cur)
    autenticado(cur)
    antiga = date.fromordinal(date.today().toordinal() - 400)
    distribuir(cur, '202400029000083', 'CREG1', antiga)
    diligenciar(cur, '202400029000083', antiga)
    distribuir(cur, '202400029000083', 'CREG2', date.today())

    cur.execute('select unidade, ordem, processos from resumo_acervo_creg()'
                ' where processos > 0')
    assert cur.fetchall() == [('CREG2', 1, 1)], 'vale a distribuição mais recente'

    cur.execute('select coalesce(sum(processos), 0) from resumo_acervo_creg(true)')
    assert cur.fetchone()[0] == 0, 'a distribuição antiga não pode voltar pelo filtro'


@teste
def quem_decide_o_recorte_e_o_retorno(cur):
    """RETORNO = NÃO é diligência aberta; SIM é processo que voltou.

    Voltar da diligência e ainda não ter sido julgado é AGUARDAR PAUTA, não
    estar em diligência. A primeira versão deste recorte não fazia essa
    distinção e mostrava 6 falsos positivos em produção — todos processos que
    já tinham retornado.
    """
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000084', 'CREG1', date.today())
    distribuir(cur, '202400029000085', 'CREG1', date.today())
    diligenciar(cur, '202400029000084', date.today(), retorno='NÃO')
    diligenciar(cur, '202400029000085', date.today(), retorno='SIM')

    cur.execute('select num_processo from processos_acervo_creg(null, null, true)')
    assert cur.fetchall() == [('202400029000084',)], 'só a diligência aberta entra'

    cur.execute('select num_processo from processos_acervo_creg(null, null, false)')
    assert cur.fetchall() == [('202400029000085',)], 'quem voltou fica fora do recorte'


@teste
def julgados_e_a_digitacao_do_retorno_nao_atrapalham(cur):
    """JULGADOS é campo de observação e não decide nada; NÃO/NAO/não são iguais.

    A planilha é preenchida à mão. Conferido em 22/09/2026: das 44 linhas,
    várias com JULGADOS vazio já tinham sessão — a coluna não é fechada com
    disciplina e não pode entrar na regra.
    """
    limpar(cur)
    autenticado(cur)
    for i, grafia in enumerate(['NÃO', 'NAO', 'não', 'Não', ' não ']):
        num = f'20240002900009{i}'
        distribuir(cur, num, 'CREG1', date.today())
        diligenciar(cur, num, date.today(), retorno=grafia,
                    julgados='Julgado em sessão.')

    cur.execute('select coalesce(sum(processos), 0) from resumo_acervo_creg(true)')
    assert cur.fetchone()[0] == 5, 'toda grafia de NÃO conta como aberta'

    # Vazio não é "aberta": a convenção é explícita, branco é linha não
    # preenchida — e o recorte prefere não mostrar a mostrar quem já voltou.
    limpar(cur)
    distribuir(cur, '202400029000099', 'CREG1', date.today())
    diligenciar(cur, '202400029000099', date.today(), retorno='')
    cur.execute('select coalesce(sum(processos), 0) from resumo_acervo_creg(true)')
    assert cur.fetchone()[0] == 0


@teste
def diligencia_desde_traz_a_mais_recente(cur):
    """Diligências sucessivas: vale a última, que é a que está aberta."""
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000085', 'CREG3', date(2026, 1, 5))
    diligenciar(cur, '202400029000085', date(2026, 2, 20), linha=1)
    diligenciar(cur, '202400029000085', date(2026, 6, 10), linha=2)

    cur.execute('select num_processo, diligencia_desde'
                ' from processos_acervo_creg(null, null, true)')
    assert cur.fetchall() == [('202400029000085', date(2026, 6, 10))]

    # Sem diligência a coluna vem vazia, e não some da lista.
    distribuir(cur, '202400029000086', 'CREG3', date(2026, 1, 5))
    cur.execute('select diligencia_desde from processos_acervo_creg()'
                " where num_processo = '202400029000086'")
    assert cur.fetchall() == [(None,)]


@teste
def recorte_combina_com_ordem_e_unidade(cur):
    """O filtro novo entra por `and`, sem precedência sobre os dois antigos."""
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    velha = date.fromordinal(hoje.toordinal() - 200)
    distribuir(cur, '202400029000087', 'CREG1', hoje)
    distribuir(cur, '202400029000088', 'CREG2', hoje)
    distribuir(cur, '202400029000089', 'CREG2', velha)
    for num in ['202400029000087', '202400029000088', '202400029000089']:
        diligenciar(cur, num, hoje if num != '202400029000089' else velha)

    cur.execute('select num_processo'
                " from processos_acervo_creg(1, 'CREG2', true)")
    assert cur.fetchall() == [('202400029000088',)]

    cur.execute("select count(*) from processos_acervo_creg(null, 'CREG2', true)")
    assert cur.fetchone()[0] == 2

    cur.execute('select count(*) from processos_acervo_creg(1, null, true)')
    assert cur.fetchone()[0] == 2


@teste
def detalhe_confere_celula_a_celula_em_cada_recorte(cur):
    """O card abre o número que o bloco mostrava — com o filtro ligado também.

    O recorte precisa chegar às duas funções igual. Se divergirem, a célula
    conta um acervo e o card abre outro.
    """
    limpar(cur)
    autenticado(cur)
    hoje = date.today().toordinal()
    for i, (unidade, dias, diligencia) in enumerate(
            [('CREG1', 3, True), ('CREG1', 40, False),
             ('CREG2', 200, True), ('CREG4', 800, False)]):
        num = f'20240002900009{i}'
        data = date.fromordinal(hoje - dias)
        distribuir(cur, num, unidade, data)
        if diligencia:
            diligenciar(cur, num, data)

    for recorte, esperado in [(None, 4), (True, 2), (False, 2)]:
        cur.execute('select ordem, unidade, processos from resumo_acervo_creg(%s)',
                    (recorte,))
        for ordem, unidade, processos in cur.fetchall():
            cur.execute('select count(*) from processos_acervo_creg(%s, %s, %s)',
                        (ordem, unidade, recorte))
            assert cur.fetchone()[0] == processos, (recorte, ordem, unidade)

        cur.execute('select count(*) from processos_acervo_creg(null, null, %s)',
                    (recorte,))
        assert cur.fetchone()[0] == esperado, recorte


@teste
def a_matriz_mantem_as_colunas_sob_o_filtro(cur):
    """Filtrar não pode fazer coluna sumir: a tabela mudaria de forma no clique.

    Uma unidade inteira de travessões diz algo — ela não tem processo em
    diligência.
    """
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202400029000100', 'CREG1', date.today())
    distribuir(cur, '202400029000101', 'CREG4', date.today())
    diligenciar(cur, '202400029000101', date.today())

    def unidades(recorte):
        cur.execute('select distinct unidade from resumo_acervo_creg(%s) order by 1',
                    (recorte,))
        return [u for (u,) in cur.fetchall()]

    assert unidades(None) == unidades(True) == unidades(False) == ['CREG1', 'CREG4']


@teste
def a_camara_nao_ganhou_o_recorte(cur):
    """Só o Conselho tem registro de diligências; a CJ fica como estava.

    A trava é a assinatura: se alguém acrescentar o parâmetro às funções da
    Câmara sem ter a fonte de dados dela, este teste cai.
    """
    cur.execute("""select p.proname, pg_get_function_identity_arguments(p.oid)
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public'
                      and p.proname in ('resumo_acervo_cj', 'processos_acervo_cj',
                                        'resumo_acervo_creg', 'processos_acervo_creg')
                    order by 1""")
    assert cur.fetchall() == [
        ('processos_acervo_cj',   'p_ordem integer, p_relator text'),
        ('processos_acervo_creg', 'p_ordem integer, p_unidade text, p_diligencia boolean'),
        ('resumo_acervo_cj',      ''),
        ('resumo_acervo_creg',    'p_diligencia boolean'),
    ]

    assert uma(cur, "select to_regclass('public.diligencias_cj')") is None


@teste
def navegador_nao_le_as_diligencias(cur):
    """A tabela é fechada como o acervo: quem lê são as funções do painel."""
    limpar(cur)
    distribuir(cur, '202400029000102', 'CREG1', date.today())
    diligenciar(cur, '202400029000102', date.today())

    for papel in ['anon', 'authenticated']:
        try:
            como(cur, papel, 'select * from public.diligencias_creg')
        except psycopg2.Error:
            cur.connection.rollback()
            continue
        raise AssertionError(f'{papel} leu diligencias_creg')


# ── Registro do voto ─────────────────────────────────────────────────────────

@teste
def registrar_votos_grava_so_o_que_esta_pendente(cur):
    limpar(cur)
    autenticado(cur)
    pendente = julgar(cur, '202400029000080', date(2026, 4, 1))
    historico = julgar(cur, '202400029000081', date(2026, 4, 1),
                       voto='Manter', status='Julgado')

    cur.execute("""select registrar_votos_creg(
                     jsonb_build_array(
                       jsonb_build_object('id', %s::text, 'voto', 'Anular',
                                          'status', 'Julgado'),
                       jsonb_build_object('id', %s::text, 'voto', 'Aprovação',
                                          'status', 'Julgado')))""",
                (pendente, historico))
    assert cur.fetchone()[0] == 1

    assert campos(cur, pendente, 'voto', 'atualizado_por') == \
        ('Anular', 'secretaria@agr.go.gov.br')
    assert campos(cur, historico, 'voto')[0] == 'Manter'


@teste
def voto_vista_exige_destino_valido_e_grava_na_mesma_transacao(cur):
    limpar(cur)
    autenticado(cur)
    distribuir(cur, '202600029000601', 'CREG1', date(2026, 9, 20))
    distribuir(cur, '202600029000602', 'CREG2', date(2026, 9, 20))
    primeiro = julgar(cur, '202600029000601', date(2026, 9, 23))
    segundo = julgar(cur, '202600029000602', date(2026, 9, 23))

    for destino in [None, '', 'CREG5']:
        cur.execute('savepoint tentar_vista')
        try:
            cur.execute("""select registrar_votos_creg(jsonb_build_array(
                             jsonb_build_object('id', %s::text, 'voto', 'Manter',
                                                'status', 'Julgado'),
                             jsonb_build_object('id', %s::text, 'voto', 'Vista',
                                                'status', 'Vista',
                                                'unidade_vista', %s)))""",
                        (primeiro, segundo, destino))
        except psycopg2.Error:
            cur.execute('rollback to savepoint tentar_vista')
            cur.execute('release savepoint tentar_vista')
        else:
            raise AssertionError(f'aceitou destino de vista inválido: {destino!r}')
        assert campos(cur, primeiro, 'voto', 'status') == (None, None)
        assert campos(cur, segundo, 'voto', 'status', 'unidade_vista') == (None, None, None)

    cur.execute("""select registrar_votos_creg(jsonb_build_array(
                     jsonb_build_object('id', %s::text, 'voto', 'Vista',
                                        'status', 'Vista', 'unidade_vista', 'CREG4')))""",
                (segundo,))
    assert cur.fetchone()[0] == 1
    assert campos(cur, segundo, 'voto', 'status', 'unidade_vista') == \
        ('Vista', 'Vista', 'CREG4')

    # Outra pessoa mudou o destino enquanto esta tela continuava aberta.
    cur.execute('update public.julgados_creg set unidade_vista = %s where id = %s',
                ('CREG1', segundo))
    cur.execute('savepoint destino_obsoleto')
    try:
        cur.execute("""select registrar_votos_creg(jsonb_build_array(
                         jsonb_build_object('id', %s::text, 'voto', 'Retirado',
                                            'status', 'Retirado',
                                            'anterior', jsonb_build_object(
                                              'voto', 'Vista', 'status', 'Vista',
                                              'unidade_vista', 'CREG4'),
                                            'unidade_vista', null)))""", (segundo,))
    except psycopg2.Error as exc:
        assert exc.pgcode == '40001'
        cur.execute('rollback to savepoint destino_obsoleto')
        cur.execute('release savepoint destino_obsoleto')
    else:
        raise AssertionError('aceitou apagar destino alterado por outra pessoa')
    assert campos(cur, segundo, 'voto', 'status', 'unidade_vista') == \
        ('Vista', 'Vista', 'CREG1')

    cur.execute("""select registrar_votos_creg(jsonb_build_array(
                     jsonb_build_object('id', %s::text, 'voto', 'Retirado',
                                        'status', 'Retirado',
                                        'anterior', jsonb_build_object(
                                          'voto', 'Vista', 'status', 'Vista',
                                          'unidade_vista', 'CREG1'),
                                        'unidade_vista', null)))""", (segundo,))
    assert campos(cur, segundo, 'voto', 'status', 'unidade_vista') == \
        ('Retirado', 'Retirado', None)


@teste
def vista_retorna_na_unidade_escolhida_no_mesmo_dia_sem_duplicar(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    numero = '202600029000621'
    original = distribuir(cur, numero, 'CREG2', hoje, assunto='Requerimento')
    jid = julgar(cur, numero, hoje)

    assert registrar(cur, [{'id': jid, 'voto': 'Vista', 'status': 'Vista',
                            'unidade_vista': 'CREG4'}]) == 1
    primeira = retornos(cur, jid)
    assert len(primeira) == 1
    assert primeira[0][1:] == ('CREG4', hoje, 'retorno')
    assert campos(cur, jid, 'acervo_id', 'unidade', 'unidade_vista') == \
        (original, 'CREG2', 'CREG4')
    cur.execute('select unidade, assunto from processos_acervo_creg() where num_processo=%s',
                (numero,))
    assert cur.fetchall() == [('CREG4', 'Requerimento')]
    cur.execute("select sum(processos) from resumo_acervo_creg() where unidade='CREG4'")
    assert cur.fetchone()[0] == 1

    # Reenvio e correção mudam a mesma distribuição de retorno, não criam outra.
    assert registrar(cur, [{'id': jid, 'voto': 'Vista', 'status': 'Vista',
                            'unidade_vista': 'CREG4'}]) == 1
    assert retornos(cur, jid) == primeira
    assert registrar(cur, [{'id': jid, 'unidade_vista': 'CREG1',
                            'anterior': {'unidade_vista': 'CREG4'}}]) == 1
    assert retornos(cur, jid) == [(primeira[0][0], 'CREG1', hoje, 'retorno')]
    cur.execute('select unidade from processos_acervo_creg() where num_processo=%s',
                (numero,))
    assert cur.fetchall() == [('CREG1',)]

    # Rederivar o julgamento não pode vinculá-lo ao retorno que ele mesmo criou.
    cur.execute('update public.julgados_creg set data_sessao=%s where id=%s',
                (hoje, jid))
    assert campos(cur, jid, 'acervo_id', 'unidade') == (original, 'CREG2')

    # Uma correção definitiva desfaz só o retorno, conservando a distribuição
    # original e o registro do julgamento.
    assert registrar(cur, [{'id': jid, 'voto': 'Manter', 'status': 'Julgado',
                            'unidade_vista': None,
                            'anterior': {'voto': 'Vista', 'status': 'Vista',
                                         'unidade_vista': 'CREG1'}}]) == 1
    assert retornos(cur, jid) == []
    cur.execute('select id from public.acervo_creg where num_processo=%s', (numero,))
    assert cur.fetchall() == [(original,)]
    cur.execute('select * from processos_acervo_creg() where num_processo=%s',
                (numero,))
    assert cur.fetchall() == []


@teste
def retirado_volta_a_mesma_unidade_e_redistribuicao_posterior_vence(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    ontem = hoje - timedelta(days=1)
    numero = '202600029000622'
    original = distribuir(cur, numero, 'CREG3', ontem)
    jid = julgar(cur, numero, ontem)

    # Voto sem status continua parcial e não retorna até a decisão combinar.
    assert registrar(cur, [{'id': jid, 'voto': 'Retirado'}]) == 1
    assert retornos(cur, jid) == []
    assert registrar(cur, [{'id': jid, 'status': 'Retirado'}]) == 1
    assert len(retornos(cur, jid)) == 1
    assert retornos(cur, jid)[0][1:] == ('CREG3', ontem, 'retorno')
    cur.execute('select id from public.acervo_creg where num_processo=%s order by id',
                (numero,))
    assert len(cur.fetchall()) == 2  # mesma data e unidade, eventos distintos
    cur.execute('select unidade from processos_acervo_creg() where num_processo=%s',
                (numero,))
    assert cur.fetchall() == [('CREG3',)]

    novo = distribuir(cur, numero, 'CREG4', hoje)
    cur.execute('select unidade from processos_acervo_creg() where num_processo=%s',
                (numero,))
    assert cur.fetchall() == [('CREG4',)]
    assert campos(cur, jid, 'acervo_id', 'unidade') == (original, 'CREG3')
    assert len(retornos(cur, jid)) == 1

    seguinte = julgar(cur, numero, hoje)
    assert campos(cur, seguinte, 'acervo_id', 'unidade') == (novo, 'CREG4')
    cur.execute('select * from processos_acervo_creg() where num_processo=%s',
                (numero,))
    assert cur.fetchall() == []


@teste
def nova_pauta_usa_retorno_sem_passar_por_sorteio(cur):
    ontem = date.today() - timedelta(days=1)
    hoje = date.today()
    for i, (voto, destino) in enumerate([('Vista', 'CREG4'),
                                         ('Retirado', 'CREG2')]):
        limpar(cur)
        autenticado(cur)
        numero = f'20260002900063{i}'
        distribuir(cur, numero, 'CREG2', ontem)
        primeiro = julgar(cur, numero, ontem)
        item = {'id': primeiro, 'voto': voto, 'status': voto}
        if voto == 'Vista':
            item['unidade_vista'] = destino
        assert registrar(cur, [item]) == 1
        retorno = retornos(cur, primeiro)[0][0]

        # A sincronizacao da nova pauta apenas insere outro julgado. Nenhum
        # sorteio ou nova distribuicao manual acontece entre as sessoes.
        importados, sem_acervo = sincronizar.gravar_julgados(
            cur, sincronizar.COLEGIADOS['CREG'],
            SimpleNamespace(data_sessao=hoje, numero=18), [numero])
        assert (importados, sem_acervo) == (1, [])
        cur.execute('select id from public.julgados_creg'
                    ' where num_processo=%s and data_sessao=%s', (numero, hoje))
        segundo = cur.fetchone()[0]
        assert campos(cur, segundo, 'acervo_id', 'unidade') == (retorno, destino)
        cur.execute('select id from public.acervo_creg where num_processo=%s',
                    (numero,))
        assert len(cur.fetchall()) == 2  # original + retorno, sem sorteio novo
        assert registrar(cur, [{'id': segundo, 'voto': 'Manter',
                                'status': 'Julgado'}]) == 1
        cur.execute('select * from processos_acervo_creg() where num_processo=%s',
                    (numero,))
        assert cur.fetchall() == []


@teste
def retorno_inconsistente_recusa_lote_inteiro(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    numeros = ['202600029000623', '202600029000624']
    for numero in numeros:
        distribuir(cur, numero, 'CREG2', hoje)
    primeiro, segundo = [julgar(cur, numero, hoje) for numero in numeros]

    for voto, status in [('Vista', 'Julgado'), ('Retirado', 'Julgado')]:
        cur.execute('savepoint lote_invalido')
        try:
            registrar(cur, [
                {'id': primeiro, 'voto': 'Manter', 'status': 'Julgado'},
                {'id': segundo, 'voto': voto, 'status': status,
                 'unidade_vista': 'CREG4' if voto == 'Vista' else None}
            ])
        except psycopg2.Error as exc:
            assert exc.pgcode == '22023'
            cur.execute('rollback to savepoint lote_invalido')
            cur.execute('release savepoint lote_invalido')
        else:
            raise AssertionError(f'aceitou {voto} com status {status}')
        assert campos(cur, primeiro, 'voto', 'status') == (None, None)
        assert campos(cur, segundo, 'voto', 'status') == (None, None)
        assert retornos(cur, primeiro) == retornos(cur, segundo) == []


@teste
def historico_nao_cria_retorno_em_correcao_de_metadados(cur):
    limpar(cur)
    hoje = date.today()
    numero = '202600029000625'
    distribuir(cur, numero, 'CREG2', hoje)
    jid = julgar(cur, numero, hoje, voto='Retirado', status='Retirado')
    assert retornos(cur, jid) == []

    # Importacoes antigas nao criam distribuições novas ao corrigir assunto.
    cur.execute("update public.julgados_creg set assunto='Requerimento',"
                " atualizado_em=now() where id=%s", (jid,))
    assert retornos(cur, jid) == []


@teste
def usuario_nao_pode_fabricar_retorno_no_acervo(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    numero = '202600029000626'
    distribuir(cur, numero, 'CREG2', hoje)
    jid = julgar(cur, numero, hoje)

    cur.execute('savepoint retorno_fabricado')
    cur.execute('set local role authenticated')
    try:
        cur.execute("""insert into public.acervo_creg
                       (num_processo, unidade, data_distribuicao, origem,
                        retorno_julgado_id)
                       values (%s, 'CREG4', %s, 'retorno', %s)""",
                    (numero, hoje, jid))
    except psycopg2.Error as exc:
        assert exc.pgcode == '42501'
        cur.execute('rollback to savepoint retorno_fabricado')
        cur.execute('release savepoint retorno_fabricado')
    else:
        raise AssertionError('aceitou retorno fabricado pelo usuario')
    assert retornos(cur, jid) == []


def recusa(cur, itens, trecho):
    """registrar_votos_creg recusa o lote com 22023 e diz qual processo falhou."""
    cur.execute('savepoint recusa')
    try:
        registrar(cur, itens)
    except psycopg2.Error as exc:
        assert exc.pgcode == '22023', exc
        assert trecho in str(exc), exc
        cur.execute('rollback to savepoint recusa')
        cur.execute('release savepoint recusa')
    else:
        raise AssertionError(f'aceitou {itens}')


@teste
def vista_e_retirado_valem_pelo_status_e_o_erro_nomeia_o_processo(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    numero, sem_acervo = '202600029000641', '202600029000642'
    distribuir(cur, numero, 'CREG2', hoje)
    jid = julgar(cur, numero, hoje)
    orfao = julgar(cur, sem_acervo, hoje)

    recusa(cur, [{'id': jid, 'voto': 'Manter', 'status': 'Retirado'}], numero)
    recusa(cur, [{'id': jid, 'voto': 'Manter', 'status': 'Vista'}], numero)
    recusa(cur, [{'id': jid, 'voto': 'Manter', 'status': 'Julgado'},
                 {'id': orfao, 'voto': 'Retirado', 'status': 'Retirado'}], sem_acervo)
    assert campos(cur, jid, 'voto', 'status') == (None, None)

    # Um campo em branco é decisão pela metade: grava e só retorna ao completar.
    assert registrar(cur, [{'id': jid, 'status': 'Retirado'}]) == 1
    assert retornos(cur, jid) == []
    assert registrar(cur, [{'id': jid, 'voto': 'Retirado'}]) == 1
    assert len(retornos(cur, jid)) == 1


@teste
def retirado_antes_da_sessao_volta_ao_painel_com_data_de_hoje(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    numero = '202600029000643'
    distribuir(cur, numero, 'CREG3', hoje - timedelta(days=10))
    jid = julgar(cur, numero, hoje + timedelta(days=3))

    assert registrar(cur, [{'id': jid, 'voto': 'Retirado', 'status': 'Retirado'}]) == 1
    assert retornos(cur, jid)[0][1:] == ('CREG3', hoje, 'retorno')
    cur.execute('select unidade, dias from processos_acervo_creg() where num_processo=%s',
                (numero,))
    assert cur.fetchall() == [('CREG3', 0)]


@teste
def desfazer_ou_excluir_vista_nao_trava_na_pauta_seguinte(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    ontem = hoje - timedelta(days=1)
    numero = '202600029000644'
    distribuir(cur, numero, 'CREG2', ontem)
    primeiro = julgar(cur, numero, ontem)
    vista = {'id': primeiro, 'voto': 'Vista', 'status': 'Vista', 'unidade_vista': 'CREG4'}
    assert registrar(cur, [vista]) == 1
    seguinte = julgar(cur, numero, hoje)
    assert campos(cur, seguinte, 'acervo_id') == (retornos(cur, primeiro)[0][0],)

    # A pauta seguinte aponta para o retorno; desfazê-lo não pode falhar na FK.
    assert registrar(cur, [{'id': primeiro, 'voto': 'Manter', 'status': 'Julgado',
                            'unidade_vista': None,
                            'anterior': {'voto': 'Vista', 'status': 'Vista',
                                         'unidade_vista': 'CREG4'}}]) == 1
    assert retornos(cur, primeiro) == []
    assert campos(cur, seguinte, 'acervo_id') == (None,)

    assert registrar(cur, [{**vista, 'anterior': {'voto': 'Manter', 'status': 'Julgado',
                                                   'unidade_vista': None}}]) == 1
    cur.execute('update public.julgados_creg set acervo_id=%s where id=%s',
                (retornos(cur, primeiro)[0][0], seguinte))
    cur.execute('delete from public.julgados_creg where id=%s', (primeiro,))
    assert campos(cur, seguinte, 'acervo_id') == (None,)


@teste
def migracao_devolve_ao_acervo_retirados_gravados_antes_do_gatilho(cur):
    limpar(cur)
    hoje = date.today()
    pendente, ja_voltou = '202600029000645', '202600029000646'
    for numero in (pendente, ja_voltou):
        distribuir(cur, numero, 'CREG1', hoje - timedelta(days=20))
    cur.execute('alter table public.julgados_creg disable trigger julgados_creg_retorno')
    antigo = julgar(cur, pendente, hoje - timedelta(days=5), voto='Retirado',
                    status='Retirado', atualizado_em=hoje)
    voltou = julgar(cur, ja_voltou, hoje - timedelta(days=5), voto='Retirado',
                    status='Retirado', atualizado_em=hoje)
    julgar(cur, ja_voltou, hoje)
    planilha = julgar(cur, '202600029000647', hoje, voto='Retirado', status='Retirado')
    cur.execute('alter table public.julgados_creg enable trigger julgados_creg_retorno')

    migracao = RAIZ / 'supabase' / 'migrations' /         '20260925115048_revisao_retorno_vista_retirado_creg.sql'
    for _ in range(2):  # reaplicar não duplica
        cur.execute(migracao.read_text(encoding='utf-8'))
    assert retornos(cur, antigo)[0][1:] == ('CREG1', hoje - timedelta(days=5), 'retorno')
    assert retornos(cur, voltou) == []
    assert retornos(cur, planilha) == []


@teste
def retornos_de_vista_listam_so_a_vista_com_a_unidade_anterior(cur):
    limpar(cur)
    autenticado(cur)
    hoje = date.today()
    vista, retirado = '202600029000651', '202600029000652'
    for numero in (vista, retirado):
        distribuir(cur, numero, 'CREG2', hoje - timedelta(days=5))
    jv = julgar(cur, vista, hoje)
    jr = julgar(cur, retirado, hoje)
    assert registrar(cur, [{'id': jv, 'voto': 'Vista', 'status': 'Vista', 'unidade_vista': 'CREG4'},
                           {'id': jr, 'voto': 'Retirado', 'status': 'Retirado'}]) == 2

    cur.execute("select * from public.retornos_de_vista('CREG')")
    assert cur.fetchall() == [(vista, hoje, 'CREG2', None)]


@teste
def registrar_votos_nao_apaga_decisao_com_campo_em_branco(cur):
    """Branco quer dizer "ainda não decidi", nunca "apague o que está lá".

    A fila de pendentes inclui de propósito a linha que tem voto e não tem
    status — é assim que a planilha trouxe 13 votos com rótulo antigo. Gravando
    a sessão inteira, a função escrevia os dois campos e o voto ia junto; pela
    API, um POST de {"voto":"","status":""} zerava as duas colunas de qualquer
    linha que a tela já tivesse encostado.
    """
    limpar(cur)
    autenticado(cur)
    parcial = julgar(cur, '202400029000085', date(2026, 4, 1), voto='Manter')

    cur.execute("""select registrar_votos_creg(jsonb_build_array(
                     jsonb_build_object('id', %s::text, 'voto', '',
                                        'status', 'Julgado')))""", (parcial,))
    assert cur.fetchone()[0] == 1
    assert campos(cur, parcial, 'voto', 'status') == ('Manter', 'Julgado')

    # E agora que a linha é editável por esta porta (atualizado_em preenchido),
    # o branco continua sem apagar.
    cur.execute("""select registrar_votos_creg(jsonb_build_array(
                     jsonb_build_object('id', %s::text, 'voto', '',
                                        'status', '')))""", (parcial,))
    assert campos(cur, parcial, 'voto', 'status') == ('Manter', 'Julgado')

    # Trocar um rótulo por outro continua funcionando: o que sumiu foi só apagar.
    cur.execute("""select registrar_votos_creg(jsonb_build_array(
                     jsonb_build_object('id', %s::text, 'voto', 'Anular',
                                        'anterior', jsonb_build_object('voto', 'Manter'),
                                        'status', 'Julgado')))""", (parcial,))
    assert campos(cur, parcial, 'voto')[0] == 'Anular'


@teste
def registrar_votos_recusa_rotulo_fora_da_lista(cur):
    limpar(cur)
    jid = julgar(cur, '202400029000082', date(2026, 4, 1))
    # O julgado precisa sobreviver aos rollbacks do laço, e a sessão falsa é
    # local à transação: cada tentativa recomeça com ela.
    cur.connection.commit()

    # Só rótulo PREENCHIDO e fora da lista. Campo ausente é legítimo e tem
    # teste próprio (registrar_votos_aceita_preenchimento_parcial).
    for voto, status in [('Aprovado', 'Julgado'),      # grafia antiga
                         ('Manter', 'Sobrestada'),     # status inexistente
                         ('Retornou', 'Julgado')]:     # voto que é da Câmara
        autenticado(cur)
        try:
            cur.execute("""select registrar_votos_creg(
                             jsonb_build_array(jsonb_build_object(
                               'id', %s::text, 'voto', %s, 'status', %s)))""",
                        (jid, voto, status))
        except psycopg2.errors.RaiseException:
            cur.connection.rollback()
            continue
        raise AssertionError(f'aceitou {voto!r}/{status!r}')


@teste
def registrar_votos_exige_sessao(cur):
    cur.execute("select set_config('request.jwt.claims', '', true)")
    try:
        cur.execute("select registrar_votos_creg('[]'::jsonb)")
    except psycopg2.errors.InvalidAuthorizationSpecification:
        cur.connection.rollback()
        return
    raise AssertionError('deixou gravar sem autenticação')


# ── Segurança ────────────────────────────────────────────────────────────────

@teste
def navegador_nao_le_o_acervo_nem_altera_julgados(cur):
    """acervo_creg só recebe INSERT; julgados_creg só SELECT."""
    limpar(cur)
    distribuir(cur, '202400029000090', 'CREG1', date(2026, 3, 1))
    cur.connection.commit()

    for sql in ['select * from public.acervo_creg',
                "update public.julgados_creg set voto = 'Manter'",
                'delete from public.acervo_creg']:
        try:
            como(cur, 'authenticated', sql)
        except psycopg2.Error:
            cur.connection.rollback()
            continue
        raise AssertionError(f'authenticated conseguiu: {sql}')

    assert como(cur, 'authenticated', 'select count(*) from public.julgados_creg')


@teste
def num_processo_exige_15_digitos(cur):
    limpar(cur)
    for ruim in ['2024000290000', '20240002900009a', '2024000290000901']:
        try:
            distribuir(cur, ruim, 'CREG1', date(2026, 3, 1))
        except psycopg2.errors.CheckViolation:
            cur.connection.rollback()
            continue
        raise AssertionError(f'aceitou {ruim!r}')


@teste
def unidade_fora_do_padrao_e_recusada(cur):
    limpar(cur)
    for ruim in ['CREG', 'CJ1', 'creg1', 'CREG0']:
        try:
            distribuir(cur, '202400029000091', ruim, date(2026, 3, 1))
        except psycopg2.errors.CheckViolation:
            cur.connection.rollback()
            continue
        raise AssertionError(f'aceitou {ruim!r}')


@teste
def mesma_distribuicao_nao_duplica(cur):
    limpar(cur)
    distribuir(cur, '202400029000092', 'CREG1', date(2026, 3, 1))
    try:
        distribuir(cur, '202400029000092', 'CREG1', date(2026, 3, 1))
    except psycopg2.errors.UniqueViolation:
        cur.connection.rollback()
        return
    raise AssertionError('duplicou a distribuição')


@teste
def mesmo_processo_nao_e_julgado_duas_vezes_na_sessao(cur):
    limpar(cur)
    julgar(cur, '202400029000093', date(2026, 4, 1))
    try:
        julgar(cur, '202400029000093', date(2026, 4, 1))
    except psycopg2.errors.UniqueViolation:
        cur.connection.rollback()
        return
    raise AssertionError('duplicou o julgado')


# ── Importação da planilha ───────────────────────────────────────────────────

@teste
def normalizacao_do_voto_corrige_grafia_sem_reescrever_decisao(cur):
    """As 23 grafias do histórico viram os rótulos do Conselho — só as grafias."""
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_creg as imp

    assert imp.rotulo('Aprovado', imp.VOTOS) == 'Aprovação'
    assert imp.rotulo('APOVAÇÃO', imp.VOTOS) == 'Aprovação'
    assert imp.rotulo('Indeferir', imp.VOTOS) == 'Indeferimento'
    assert imp.rotulo('Extinto', imp.VOTOS) == 'Extinção'
    assert imp.rotulo('n/a', imp.VOTOS) is None

    assert imp.assunto('AUTO DE INFRAÇÃO') == 'Auto de Infração'
    # "VISTA"/"PC (VISTA)" na coluna da unidade viram vazio, e o gatilho deriva.
    assert imp.unidade('3') == 'CREG3' and imp.unidade('PC (VISTA)') is None


@teste
def rotulo_fora_da_lista_nao_e_reescrito(cur):
    """Title case unificaria a caixa e destruiria as siglas.

    "MINUTA RN" viraria "Minuta Rn", "Duplicidade AI" viraria "Duplicidade Ai",
    "(BPe)" viraria "(Bpe)" — e o rótulo deixaria de ser o nome da coisa. Quem
    não bate com a lista do Conselho passa exatamente como a planilha escreveu.
    """
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_creg as imp

    for original in ['MINUTA RN', 'POP', 'Duplicidade AI', 'Reajuste TRCF',
                     'Bilhetes de Passagens Eletrônicas (BPe)',
                     'Revisão de Metodologia']:
        assert imp.assunto(original) == original, original
    assert imp.rotulo('Parcialmente Deferido', imp.VOTOS) == 'Parcialmente Deferido'


@teste
def unificar_escolhe_uma_grafia_por_rotulo(cur):
    """A caixa ainda tem de ser resolvida — só que sem inventar texto novo.

    Vale a grafia mais usada; empatou, vale a que tem menos caixa alta. Assim
    "DUPLICIDADE AI" (1 vez) cede para "Duplicidade AI" (20) sem que nenhuma
    das duas vire "Duplicidade Ai".
    """
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_creg as imp

    linhas = ([{'assunto': 'Duplicidade AI'}] * 20
              + [{'assunto': 'DUPLICIDADE AI'}]
              + [{'assunto': 'PLANEJAMENTO ESTRATÉGICO'}, {'assunto': 'Planejamento Estratégico'}]
              + [{'assunto': None}])
    imp.unificar(linhas, 'assunto')

    escolhidas = {l['assunto'] for l in linhas if l['assunto']}
    assert escolhidas == {'Duplicidade AI', 'Planejamento Estratégico'}, escolhidas


# ── Atas de sorteio ────────────────────────────────────────────────

# O texto de uma ata como o pypdf a entrega: uma célula por linha, os grupos de
# unidade fora de ordem, e o bloco de assinatura do SEI cortando a tabela ao
# meio. Sintético de propósito — a ata de verdade traz nome de interessado, e
# este repositório é público.
ATA_SINTETICA = """ESTADO DE GOIÁS
AGÊNCIA GOIANA DE REGULAÇÃO, CONTROLE E FISCALIZAÇÃO DE SERVIÇOS PÚBLICOS
CONSELHO REGULADOR

 ATA Nº 20/2026/AGR/CREG-10682

Aos 17 dias do mês de junho de 2026 na sede da Agência Goiana de
Regulação, Controle e Fiscalização de Serviços Públicos, realizou-se a distribuição de
processos por sorteio eletrônico.
Ordem
Nº Processo
Interessado
Unidade
Conselho
Regulador
8
202600029000368
EMPRESA A LTDA
CREG1
9
202500029005601
EMPRESA B LTDA
CREG1
4
202600029000796
EMPRESA C LTDA-EM
RECUPERACAO JUDICIAL
25.629.544/0001-48
CREG3
Ata 20 (91988721)         SEI 202600029000084 / pg. 1
Documento assinado eletronicamente por FULANO DE TAL, Secretário
(a) Executivo (a), em 18/06/2026, às 09:10, conforme art. 2º, § 2º, III, "b", da Lei
17.039/2010 e art. 3ºB, I, do Decreto nº 8.808/2016.
 informando o código
verificador 91988721 e o código CRC D9FDA462.
Referência: Processo nº 202600029000084
SEI 91988721
1
202600029001557
EMPRESA D LTDA
CREG4

CONSELHO REGULADOR
AVENIDA GOIÁS , ED. VISCONDE DE MAUÁ 305 - Bairro CENTRO - GOIANIA - GO -
CEP 74005-010 - .

Ata 20 (91988721)         SEI 202600029000084 / pg. 2
"""


@teste
def ata_le_processo_unidade_data_e_ordem(cur):
    """A ata de sorteio é o registro oficial da distribuição, e chega antes da
    planilha de gabinete ser atualizada."""
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    numero, quando, linhas, orfaos = imp.distribuicoes(ATA_SINTETICA)

    assert numero == 20 and quando == date(2026, 6, 17)
    assert orfaos == []
    assert [(l['num_processo'], l['unidade'], l['ordem']) for l in linhas] == [
        ('202600029000368', 'CREG1', 8),
        ('202500029005601', 'CREG1', 9),
        ('202600029000796', 'CREG3', 4),
        ('202600029001557', 'CREG4', 1),
    ]
    assert all(l['origem'] == 'ata' for l in linhas)
    # A ata não registra assunto nem recurso, e a importação não os inventa.
    assert all(l['assunto'] is None and l['recurso'] is None for l in linhas)


@teste
def ata_ignora_o_numero_do_proprio_documento(cur):
    """202600029000084 aparece três vezes no texto e nunca é uma distribuição.

    Duas no rodapé de página (`SEI … / pg. 1`) e uma na `Referência`. Nenhuma
    entra, porque em nenhuma delas o número está sozinho numa linha — a
    exclusão é por contexto, nunca por lista de números proibidos.
    """
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    assert '202600029000084' in ATA_SINTETICA
    _, _, linhas, _ = imp.distribuicoes(ATA_SINTETICA)
    assert '202600029000084' not in {l['num_processo'] for l in linhas}


@teste
def ata_da_camara_e_recusada(cur):
    """A CJ publica ata de layout quase igual, e o sorteio dela vai para outra
    tabela."""
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    da_cj = ATA_SINTETICA.replace('CONSELHO REGULADOR', 'CÂMARA DE JULGAMENTO')
    try:
        imp.distribuicoes(da_cj)
    except imp.ErroAta:
        return
    raise AssertionError('importou ata da Câmara como se fosse do Conselho')


@teste
def ata_avisa_processo_sem_unidade(cur):
    """Processo sem CREGn logo a seguir não pode ser colado à unidade errada."""
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    quebrada = ATA_SINTETICA.replace('202500029005601\nEMPRESA B LTDA\nCREG1',
                                     '202500029005601\nEMPRESA B LTDA')
    _, _, linhas, orfaos = imp.distribuicoes(quebrada)
    assert orfaos == ['202500029005601']
    assert '202500029005601' not in {l['num_processo'] for l in linhas}


@teste
def numero_solto_depois_do_processo_nao_vira_ordem(cur):
    """A ordem vem ANTES do processo; o que vem depois dele não é ordem.

    O pypdf quebra célula de Interessado que deu wrap, e um CNPJ vira três
    linhas — `25.629.544`, `0001`, `48`. Sem a guarda, a última casava com
    `^(1,3 dígitos)$` e entrava como ordem da distribuição, sem erro nenhum.
    """
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    quebrada = ATA_SINTETICA.replace('25.629.544/0001-48',
                                     '25.629.544' + chr(10) + '0001' + chr(10) + '48')
    _, _, linhas, orfaos = imp.distribuicoes(quebrada)

    assert orfaos == []
    assert [(l['num_processo'], l['ordem']) for l in linhas] == [
        ('202600029000368', 8),
        ('202500029005601', 9),
        ('202600029000796', 4),      # e não 48
        ('202600029001557', 1),
    ]


@teste
def processo_orfao_nao_empresta_a_ordem_ao_seguinte(cur):
    """Processo sem unidade leva a própria ordem embora."""
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    # O 202500029005601 fica sem unidade: some o CREG1 que vinha depois dele.
    sem_unidade = ATA_SINTETICA.replace(
        '202500029005601' + chr(10) + 'EMPRESA B LTDA' + chr(10) + 'CREG1',
        '202500029005601' + chr(10) + 'EMPRESA B LTDA')
    _, _, linhas, orfaos = imp.distribuicoes(sem_unidade)

    assert orfaos == ['202500029005601']
    assert [(l['num_processo'], l['ordem']) for l in linhas] == [
        ('202600029000368', 8),
        ('202600029000796', 4),      # e não 9, herdada do órfão
        ('202600029001557', 1),
    ]


@teste
def dia_impossivel_na_ata_e_recusado_sem_derrubar_o_lote(cur):
    """"Aos 31 dias do mês de junho" é erro de digitação, não fim de rodada.

    Como ErroAta cai no PULA do main e as outras atas continuam; solto, o
    ValueError abortava tudo e o SQL das atas já lidas nem era escrito.
    """
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    torta = ATA_SINTETICA.replace('Aos 17 dias', 'Aos 31 dias')
    try:
        imp.distribuicoes(torta)
    except imp.ErroAta as e:
        assert 'data inválida' in str(e), e
        return
    raise AssertionError('dia fora do calendário passou')


@teste
def rodada_sem_nenhuma_ata_nao_apaga_o_sql_anterior(cur):
    """gerar_sql sem linha devolve só o cabeçalho; gravá-lo trunca o arquivo bom."""
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_atas_creg as imp

    saida = RAIZ / 'dados' / 'acervo_creg_atas.sql'
    antes = saida.read_bytes() if saida.exists() else None
    marca = '-- rodada anterior, com dado bom' + chr(10)
    saida.write_text(marca, encoding='utf-8')

    def recusa(caminho):
        raise imp.ErroAta('não é ata do Conselho Regulador')

    original = imp.ler_ata
    imp.ler_ata = recusa
    try:
        codigo = imp.main(['importar_atas_creg.py', 'uma.pdf', 'outra.pdf'])
        assert codigo == 1
        assert saida.read_text(encoding='utf-8') == marca, 'o SQL bom foi truncado'
    finally:
        imp.ler_ata = original
        if antes is None:
            saida.unlink()
        else:
            saida.write_bytes(antes)


@teste
def acervo_aceita_a_origem_ata(cur):
    limpar(cur)
    cur.execute("""insert into acervo_creg
                   (num_processo, unidade, data_distribuicao, origem)
                   values ('202600029000368', 'CREG1', date '2026-06-17', 'ata')
                   returning origem""")
    assert cur.fetchone()[0] == 'ata'
    try:
        cur.execute("""insert into acervo_creg
                       (num_processo, unidade, data_distribuicao, origem)
                       values ('202600029000369', 'CREG1', date '2026-06-17', 'chute')""")
    except psycopg2.errors.CheckViolation:
        cur.connection.rollback()
        return
    raise AssertionError('aceitou origem desconhecida')


@teste
def sorteio_grava_o_interessado_no_acervo(cur):
    """O interessado voltou para o Conselho em 27/08/2026, digitado na tela.

    Saiu da Câmara em 20/08 porque lá ninguém o consultava; aqui a secretaria o
    usa para reconhecer o processo na ata. Só o sorteio o preenche — a
    importação das planilhas e das atas deixa nulo, porque no histórico é nome
    de pessoa física em volume e o repositório é público.
    """
    limpar(cur)
    cur.execute("""insert into acervo_creg
                   (num_processo, unidade, data_distribuicao, assunto, recurso,
                    interessado, ordem, sorteado_em, origem)
                   values ('202600029003001', 'CREG2', current_date,
                           'Quadro de Horários', 'Não se aplica',
                           'EMPRESA X LTDA', 3, now(), 'sorteio')
                   returning interessado, assunto""")
    assert cur.fetchone() == ('EMPRESA X LTDA', 'Quadro de Horários')

    # E continua opcional: ata e planilha não o trazem.
    distribuir(cur, '202600029003002', 'CREG2', date.today())
    assert uma(cur, """select interessado from acervo_creg
                        where num_processo = '202600029003002'""") is None


@teste
def assuntos_do_sorteio_e_da_importacao_sao_a_mesma_lista(cur):
    """Se divergirem, o mesmo assunto vira duas categorias no relatório.

    A secretaria escolhe o rótulo em assuntosCreg (index.js); a importação
    reconhece o dela em ASSUNTOS (importar_creg.py) e deixa passar como veio
    tudo que não bate. Um item só existente de um lado passaria despercebido
    até alguém agrupar por assunto e ver a categoria repetida.
    """
    sys.path.insert(0, str(RAIZ / 'dados'))
    import importar_creg as imp
    import re

    fonte = (RAIZ / 'assets' / 'js' / 'index.js').read_text(encoding='utf-8')
    achado = re.search(r'const assuntosCreg = \[([^\]]+)\]', fonte)
    assert achado, 'assuntosCreg não encontrado em index.js'
    do_front = re.findall(r"'([^']+)'", achado.group(1))

    assert do_front == imp.ASSUNTOS, (
        f'só no front: {sorted(set(do_front) - set(imp.ASSUNTOS))}; '
        f'só na importação: {sorted(set(imp.ASSUNTOS) - set(do_front))}')


@teste
def rotulos_da_pagina_batem_com_os_do_banco(cur):
    """julgados.js (bloco creg) e registrar_votos_creg têm de aceitar a mesma lista.

    Se divergirem, a secretaria escolhe um rótulo no seletor e o banco recusa na
    hora de salvar — falha que só apareceria em produção, depois de uma sessão
    inteira preenchida.
    """
    import re
    pagina = (RAIZ / 'assets' / 'js' / 'julgados.js').read_text(encoding='utf-8')
    schema = (RAIZ / 'sql' / 'schema.sql').read_text(encoding='utf-8')

    corpo = re.search(FUNCAO_CREG, schema, re.S)
    assert corpo, 'registrar_votos_creg não encontrada no schema'
    corpo = corpo.group(0)

    def rotulos(fonte, padrao):
        achado = re.search(padrao, fonte, re.S)
        assert achado, padrao
        return re.findall(r"'([^']+)'", achado.group(1))

    assert rotulos(pagina, LISTA_VOTOS) == rotulos(corpo, ACEITOS_VOTO)
    assert rotulos(pagina, LISTA_STATUS) == rotulos(corpo, ACEITOS_STATUS)


@teste
def a_pagina_do_creg_le_a_tabela_do_creg(cur):
    """Cada colegiado tem a sua tela, e elas não podem trocar de fonte.

    As duas usam julgados.js; o que separa as fontes é o bloco de cada
    colegiado em COLEGIADOS, escolhido pelo data-colegiado da página.
    """
    import re
    js = (RAIZ / 'assets' / 'js' / 'julgados.js').read_text(encoding='utf-8')
    bloco = {}
    for sigla in ('cj', 'creg'):
        achado = re.search(rf'\b{sigla}: \{{(.*?)\n  \}}', js, re.S)
        assert achado, f'bloco {sigla} não encontrado em COLEGIADOS'
        bloco[sigla] = achado.group(1)

    assert "tabela: 'julgados_creg'" in bloco['creg']
    assert "rpc: 'rpc/registrar_votos_creg'" in bloco['creg']
    assert "tabela: 'julgados_cj'" in bloco['cj'] and 'creg' not in bloco['cj']

    # A coluna do Conselho é a unidade, e sem de-para de nomes: o hover com o
    # conselheiro é só da Câmara.
    assert "destino: 'unidade'" in bloco['creg']
    assert 'mostraConselheiro: false' in bloco['creg']
    assert 'data-colegiado="creg"' in (RAIZ / 'julgados-creg.html').read_text(encoding='utf-8')
    assert 'data-colegiado="cj"' in (RAIZ / 'julgados-cj.html').read_text(encoding='utf-8')

    # E o bootstrap carrega o mesmo script para as duas páginas.
    boot = (RAIZ / 'assets' / 'js' / 'bootstrap.js').read_text(encoding='utf-8')
    assert re.search(r"'julgados-creg':[^}]*arquivo: 'julgados\.min\.js'[^}]*"
                     r"iniciar: 'inicializarJulgados'", boot)
    assert 'function inicializarJulgados' in js

    # O index oferece as duas telas.
    index = (RAIZ / 'index.html').read_text(encoding='utf-8')
    assert './julgados-creg.html' in index and './julgados-cj.html' in index
    assert (RAIZ / 'julgados-creg.html').is_file()
    assert (RAIZ / 'julgados-cj.html').is_file()


@teste
def schema_remove_assinaturas_antigas_do_painel(cur):
    """Reaplicar schema.sql numa base antiga não deixa RPCs concorrentes."""
    schema = (RAIZ / 'sql' / 'schema.sql').read_text(encoding='utf-8')
    assert 'drop function if exists public.resumo_acervo_creg();' in schema
    assert ('drop function if exists '
            'public.processos_acervo_creg(int, text);') in schema


@teste
def o_painel_serve_os_dois_colegiados_pelo_mesmo_script(cur):
    """acervo.js atende CJ e CREG; quem escolhe é o data-colegiado do <body>.

    Duplicar o arquivo custaria 39 KB de exportação de Excel e PDF mantidos em
    dobro. O risco da parametrização é o oposto: uma página apontar para o par
    de funções do outro colegiado e ninguém notar até o painel abrir vazio.
    """
    painel = (RAIZ / 'assets' / 'js' / 'acervo.js').read_text(encoding='utf-8')

    # As duas configurações existem e cada uma usa o seu par de funções.
    for rpc in ['resumo_acervo_cj', 'processos_acervo_cj',
                'resumo_acervo_creg', 'processos_acervo_creg']:
        assert rpc in painel, rpc
    # E nenhuma delas ficou fixa no código fora da tabela de colegiados.
    corpo = painel[painel.index('const COL ='):]
    for rpc in ['rpc/resumo_acervo_cj', 'rpc/processos_acervo_cj',
                'rpc/resumo_acervo_creg', 'rpc/processos_acervo_creg']:
        assert rpc not in corpo, f'{rpc} fixo fora de COLEGIADOS'

    # O parâmetro da função muda de nome entre os dois, e é o que o banco espera.
    assert "parametro: 'p_relator'" in painel
    assert "parametro: 'p_unidade'" in painel

    # Cada página declara o seu colegiado.
    cj = (RAIZ / 'acervo-cj.html').read_text(encoding='utf-8')
    creg = (RAIZ / 'acervo-creg.html').read_text(encoding='utf-8')
    assert 'data-colegiado="cj"' in cj
    assert 'data-colegiado="creg"' in creg
    assert 'data-page="acervo-cj"' in cj
    assert 'data-page="acervo-creg"' in creg

    # E o bootstrap conhece as duas, carregando o mesmo script.
    boot = (RAIZ / 'assets' / 'js' / 'bootstrap.js').read_text(encoding='utf-8')
    assert "'acervo-creg':" in boot and "'acervo-cj':" in boot and "'acervo.min.js'" in boot

    # O índice abre as duas: o botão do Conselho deixou de ser inerte.
    index = (RAIZ / 'index.html').read_text(encoding='utf-8')
    assert './acervo-creg.html' in index and './acervo-cj.html' in index
    assert 'btnAcervoCreg' in index and 'aria-disabled="true">Conselho' not in index


@teste
def o_painel_do_creg_nao_tem_onde_mostrar_nome(cur):
    """A RPC do Conselho não devolve conselheiro, e a página não inventa um.

    resumo_acervo_creg tem quatro colunas — ordem, faixa, unidade, processos.
    Se alguém reintroduzir o de-para, este teste e o do painel caem juntos.
    """
    autenticado(cur)
    cur.execute('select * from resumo_acervo_creg() limit 1')
    assert 'conselheiro' not in [d.name for d in cur.description]

    cur.execute('select * from processos_acervo_creg() limit 1')
    colunas = [d.name for d in cur.description]
    assert 'conselheiro' not in colunas
    # E devolve o assunto, que é o que o Conselho mostra no lugar.
    assert 'assunto' in colunas


@teste
def registrar_votos_aceita_preenchimento_parcial(cur):
    """Processo retirado de pauta tem status e não tem voto.

    A tela promete "preencha o voto OU o status", e campo vazio é ausência de
    decisão — não rótulo inválido. Recusá-lo derrubaria a lista inteira e
    deixaria a secretaria sem como registrar o que de fato aconteceu na sessão.
    """
    limpar(cur)
    autenticado(cur)
    so_status = julgar(cur, '202600029000501', date(2026, 8, 19))
    so_voto = julgar(cur, '202600029000502', date(2026, 8, 19))

    cur.execute("""select registrar_votos_creg(jsonb_build_array(
                     jsonb_build_object('id', %s::text, 'voto', '', 'status', 'Retirado'),
                     jsonb_build_object('id', %s::text, 'voto', 'Manter', 'status', '')))""",
                (so_status, so_voto))
    assert cur.fetchone()[0] == 2

    assert campos(cur, so_status, 'voto', 'status') == (None, 'Retirado')
    assert campos(cur, so_voto, 'voto', 'status') == ('Manter', None)

    # E o rótulo PREENCHIDO fora da lista continua recusado.
    try:
        cur.execute("""select registrar_votos_creg(jsonb_build_array(
                         jsonb_build_object('id', %s::text, 'voto', 'Aprovado',
                                            'status', 'Julgado')))""", (so_voto,))
    except psycopg2.errors.RaiseException:
        cur.connection.rollback()
        return
    raise AssertionError('aceitou a grafia antiga "Aprovado"')


def main(argv):
    PG.subir()
    try:
        PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')
        PG.executar("""insert into public.permissoes_usuario (user_id, orgao) values
          ('00000000-0000-0000-0000-000000000001', 'CJ'),
          ('00000000-0000-0000-0000-000000000001', 'CREG')
        on conflict (user_id, orgao) do nothing""")

        falhas = executados = 0
        with PG.conectar() as conn:
            for fn in testes:
                executados += 1
                with conn.cursor() as cur:
                    try:
                        fn(cur)
                        conn.commit()
                        print(f'ok    {fn.__name__}')
                    except Exception as e:
                        conn.rollback()
                        falhas += 1
                        print(f'FALHA {fn.__name__}: {type(e).__name__}: {e}')

        print(f'\n{executados - falhas}/{executados} testes passaram.')
        return 1 if falhas else 0
    finally:
        PG.derrubar()


if __name__ == '__main__':
    sys.exit(main(sys.argv))
