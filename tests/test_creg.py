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

import sys
from datetime import date
from pathlib import Path

import psycopg2

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco           # noqa: E402
from banco import uma  # noqa: E402

PG = banco.Postgres('sorteio_sei_creg_test', 55435)

testes = []


def teste(fn):
    testes.append(fn)
    return fn


# ── Cenário ──────────────────────────────────────────────────────────────────

def limpar(cur):
    cur.execute('delete from julgados_creg; delete from acervo_creg')


def distribuir(cur, num, unidade, data, assunto='Auto de Infração',
               recurso='Sem recurso'):
    cur.execute("""insert into public.acervo_creg
                   (num_processo, unidade, data_distribuicao, assunto, recurso, origem)
                   values (%s, %s, %s, %s, %s, 'planilha') returning id""",
                (num, unidade, data, assunto, recurso))
    return cur.fetchone()[0]


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
def registrar_votos_recusa_rotulo_fora_da_lista(cur):
    limpar(cur)
    jid = julgar(cur, '202400029000082', date(2026, 4, 1))
    # O julgado precisa sobreviver aos rollbacks do laço, e a sessão falsa é
    # local à transação: cada tentativa recomeça com ela.
    cur.connection.commit()

    for voto, status in [('Aprovado', 'Julgado'),      # grafia antiga
                         ('Manter', 'Sobrestada'),     # status inexistente
                         ('Manter', None)]:
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


def main(argv):
    PG.subir()
    try:
        PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')

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
