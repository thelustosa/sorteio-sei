#!/usr/bin/env python3
"""Testes da sincronização de julgados_cj com as pautas da AGR.

    python tests/test_sincronizacao.py [--online]

Roda contra fixtures reais (HTML da listagem, texto e PDF de pautas de datas
diferentes) e contra um Postgres descartável no Docker. Nada aqui depende do
site da AGR estar no ar — exceto o teste marcado --online, que existe só para
avisar quando o formato do portal mudar.

Requisitos: docker, psycopg2 e pypdf.
"""

import sys
from datetime import date
from pathlib import Path

import psycopg2

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(RAIZ / 'sincronizacao'))
import banco                              # noqa: E402
from banco import uma                     # noqa: E402
import agr                                # noqa: E402
import pauta                              # noqa: E402
import sincronizar                        # noqa: E402

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
PG = banco.Postgres('sorteio_sei_sinc_test', 55434)

# A 23ª reunião, conferida à mão no PDF: 4 itens de pauta e o rodapé.
PAUTA_023 = (FIXTURES / 'pauta-023-02.07.2026.txt').read_text(encoding='utf-8')
PROCESSOS_023 = ['202600029001301', '202600029001484',
                 '202600029001477', '202600029001443']
REFERENCIA_023 = '202600029000051'

PAUTA_021 = (FIXTURES / 'pauta-021-25.06.2026.txt').read_text(encoding='utf-8')

# A 22ª reunião fica entre as duas das fixtures reais; sem ela a janela de
# sincronização teria um buraco. Texto sintético, no formato do documento.
PROCESSOS_022 = ['202600029000801', '202600029000802']
PAUTA_022 = ('PAUTA DE REUNIÃO - 22\n'
             'Data: 30/06/2026\n'
             '2.1. Processo nº 202600029000801 - Interessado: X - Auto de Infração nº 46.001\n'
             '2.2. Processo nº 202600029000802 - Interessado: Y - Auto de Infração nº 46.002\n'
             'Referência: Processo nº 202600029000051 SEI 92300000')
PDF_024 = (FIXTURES / 'pauta-024-09.07.2026.pdf').read_bytes()
LISTAGEM_HTML = (FIXTURES / 'pautas-2026.html').read_bytes()

testes = []
online = False


def teste(fn):
    testes.append(fn)
    return fn


def exige_rede(fn):
    fn.precisa_rede = True
    return fn


# ── Fonte falsa: serve as fixtures no lugar do site ──────────────────────────

class AGRFalsa:
    """Substitui só a camada de rede — o parser do HTML e do PDF é o de verdade."""

    def __init__(self, pdfs=None, falhas=()):
        self.pdfs = pdfs or {}
        self.falhas = set(falhas)
        self.baixados = []

    def __enter__(self):
        self._original = agr._baixar
        agr._baixar = self._servir
        return self

    def __exit__(self, *e):
        agr._baixar = self._original

    def _servir(self, url):
        self.baixados.append(url)
        if url in self.falhas:
            raise agr.ErroAGR(f'simulando indisponibilidade de {url}')
        if url.endswith('.pdf'):
            if url not in self.pdfs:
                raise agr.ErroAGR(f'404 em {url}')
            return self.pdfs[url]
        return LISTAGEM_HTML


def url_da(numero):
    """A URL real da enésima reunião, tirada da fixture da listagem."""
    for p in _pautas_da_fixture():
        if p.numero == numero:
            return p.url
    raise KeyError(numero)


def _pautas_da_fixture():
    with AGRFalsa():
        return agr.listar_pautas(2026)


def pdf_falso(texto):
    """Um PDF de verdade (gerado na hora) com o texto informado.

    Evita depender de mais uma biblioteca: o PDF mínimo é montado à mão, e é o
    pypdf de produção que vai lê-lo.
    """
    conteudo = '\n'.join(f'({l.replace(chr(92), "").replace("(", "").replace(")", "")}) Tj 0 -14 Td'
                         for l in texto.splitlines())
    fluxo = f'BT /F1 10 Tf 40 780 Td\n{conteudo}\nET'.encode('latin-1', 'replace')

    objetos = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
        b'/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        b'<< /Length %d >>\nstream\n%s\nendstream' % (len(fluxo), fluxo),
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    pdf, deslocamentos = bytearray(b'%PDF-1.4\n'), []
    for i, obj in enumerate(objetos, 1):
        deslocamentos.append(len(pdf))
        pdf += b'%d 0 obj\n%s\nendobj\n' % (i, obj)

    inicio_xref = len(pdf)
    pdf += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objetos) + 1)
    for d in deslocamentos:
        pdf += b'%010d 00000 n \n' % d
    pdf += (b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF'
            % (len(objetos) + 1, inicio_xref))
    return bytes(pdf)


# ── Testes: parser dos processos ─────────────────────────────────────────────

@teste
def processo_normal():
    assert pauta.extrair_processos('2.1. Processo nº 202600029123456 – Interessado: X') \
        == ['202600029123456']


@teste
def referencia_do_rodape_nunca_entra():
    """A regra crítica, em todas as variações que o PDF pode produzir."""
    variacoes = [
        'Referência: Processo nº 202600029000051',
        'Referência: Processo n° 202600029000051',
        'REFERÊNCIA: PROCESSO Nº 202600029000051',
        'Referencia: Processo no 202600029000051',
        'Referência:   Processo   nº   202600029000051 SEI 92118842',
        'Referência: Processo nº\n202600029000051',
        'referência: processo n. 202600029000051',
    ]
    for texto in variacoes:
        assert pauta.extrair_processos(texto) == [], texto


@teste
def referencia_nao_esconde_o_processo_de_cima():
    """Apagar o trecho da Referência não pode levar junto a linha anterior."""
    texto = ('2.1. Processo nº 202600029123456 - Interessado: X\n'
             'Referência: Processo nº 202600029000051 SEI 92118842')
    assert pauta.extrair_processos(texto) == ['202600029123456']


@teste
def sem_blacklist_de_numero():
    """O número do rodapé é um processo comum quando aparece na pauta."""
    texto = f'3.1. Processo nº {REFERENCIA_023} - Interessado: X'
    assert pauta.extrair_processos(texto) == [REFERENCIA_023]


@teste
def duplicados_viram_um():
    texto = 'Processo nº 202600029123456\nProcesso nº 202600029123456'
    assert pauta.extrair_processos(texto) == ['202600029123456']


@teste
def espacos_e_quebras_de_linha():
    assert pauta.extrair_processos('Processo nº   202600029123456') == ['202600029123456']
    assert pauta.extrair_processos('Processo nº\n202600029123456') == ['202600029123456']
    assert pauta.extrair_processos('Processo n°202600029123456') == ['202600029123456']
    assert pauta.extrair_processos('PROCESSO Nº 202600029123456') == ['202600029123456']


@teste
def nao_captura_numero_que_nao_e_processo():
    """Auto de infração, código verificador, CEP, lei e data ficam de fora."""
    texto = ('Auto de Infração nº 46.368 - Art. 6º, Inciso II, da Lei nº 18.673/2014, '
             'Resolução Normativa nº 105/2017-CR, CEP 74005-010, em 22/06/2026, '
             'código verificador 92118842 e o código CRC 2A5A0933. '
             'https://sei.go.gov.br/sei/controlador.php?acao=procedimento_trabalhar')
    assert pauta.extrair_processos(texto) == []


@teste
def numero_de_16_digitos_nao_e_processo():
    assert pauta.extrair_processos('Processo nº 2026000291234567') == []


@teste
def ordem_do_documento_e_preservada():
    texto = ('4.1. Processo nº 202600029000300\n'
             '2.1. Processo nº 202600029000100\n'
             '3.1. Processo nº 202600029000200')
    assert pauta.extrair_processos(texto) == \
        ['202600029000300', '202600029000100', '202600029000200']


# ── Testes: fixtures reais ───────────────────────────────────────────────────

@teste
def pauta_real_023_confere_com_a_leitura_manual():
    """4 itens conferidos à mão no PDF da 23ª reunião, e nada do rodapé."""
    achados = pauta.extrair_processos(PAUTA_023)
    assert achados == PROCESSOS_023
    assert REFERENCIA_023 not in achados
    assert REFERENCIA_023 in PAUTA_023, 'a fixture precisa conter o rodapé'


@teste
def pauta_real_021_nao_traz_o_rodape():
    achados = pauta.extrair_processos(PAUTA_021)
    assert len(achados) == 15
    assert REFERENCIA_023 not in achados
    assert len(set(achados)) == len(achados)
    assert all(len(n) == 15 and n.isdigit() for n in achados)


@teste
def nenhum_numero_de_15_digitos_escapa_do_parser():
    """Sinal de mudança de formato: nas pautas reais isso é sempre vazio."""
    assert pauta.numeros_sem_rotulo(PAUTA_023) == []
    assert pauta.numeros_sem_rotulo(PAUTA_021) == []


@teste
def data_da_sessao_vem_do_pdf():
    assert pauta.data_no_pdf(PAUTA_023) == date(2026, 7, 2)
    assert pauta.data_no_pdf(PAUTA_021) == date(2026, 6, 25)
    assert pauta.data_no_pdf('documento sem campo Data') is None


@teste
def pdf_real_e_lido_de_ponta_a_ponta():
    """Dos bytes do PDF publicado até a lista de processos."""
    texto = pauta.extrair_texto(PDF_024)
    assert pauta.data_no_pdf(texto) == date(2026, 7, 9)
    achados = pauta.extrair_processos(texto)
    assert len(achados) == 23
    assert REFERENCIA_023 not in achados
    assert pauta.numeros_sem_rotulo(texto) == []


@teste
def pdf_invalido_e_pdf_sem_texto():
    for lixo in (b'nao sou um pdf', b'', b'%PDF-1.4 truncado'):
        try:
            pauta.extrair_texto(lixo)
        except pauta.ErroPauta:
            continue
        raise AssertionError(f'aceitou {lixo!r}')


# ── Testes: listagem da AGR ──────────────────────────────────────────────────

@teste
def listagem_encontra_todas_as_reunioes():
    pautas = _pautas_da_fixture()
    assert len(pautas) == 30
    assert pautas[0].numero == 30 and pautas[0].data_sessao == date(2026, 8, 20)
    assert pautas[-1].numero == 1 and pautas[-1].data_sessao == date(2026, 2, 5)
    assert all(p.url.startswith('https://goias.gov.br/') for p in pautas)
    assert all('Câmara de Julgamento' in p.titulo for p in pautas)
    assert len({p.url for p in pautas}) == 30


@teste
def listagem_ignora_outra_comissao():
    with AGRFalsa():
        try:
            agr.listar_pautas(2026, comissao='Conselho Regulador')
        except agr.ErroAGR:
            return
    raise AssertionError('deveria avisar que não achou pauta do Conselho Regulador')


@teste
def a_data_da_listagem_bate_com_a_do_pdf():
    """Duas fontes independentes para a data da sessão, e elas concordam."""
    assert url_da(23).endswith('Pauta-23a-RP-CJ-02.07.2026.pdf')
    for numero, texto in [(23, PAUTA_023), (21, PAUTA_021)]:
        listagem = next(p for p in _pautas_da_fixture() if p.numero == numero)
        assert listagem.data_sessao == pauta.data_no_pdf(texto), numero


@teste
def so_baixa_do_portal_do_estado():
    """Sem download arbitrário: host fora da lista é recusado."""
    for url in ['http://goias.gov.br/x.pdf',            # sem https
                'https://goias.gov.br.invalido.com/x.pdf',
                'https://outro.com/x.pdf',
                'file:///etc/passwd',
                'https://169.254.169.254/latest/meta-data/']:
        try:
            agr._conferir_origem(url)
        except agr.ErroAGR:
            continue
        raise AssertionError(f'aceitou {url}')
    assert agr._conferir_origem('https://goias.gov.br/agr/x.pdf')


@teste
def pdf_que_nao_e_pdf_e_recusado():
    p = _pautas_da_fixture()[0]
    with AGRFalsa(pdfs={p.url: b'<html>pagina de erro</html>'}):
        try:
            agr.baixar_pdf(p)
        except agr.ErroAGR:
            return
    raise AssertionError('aceitou HTML no lugar do PDF')


# ── Testes: sincronização com o banco ────────────────────────────────────────

def preparar(cur, acervo=None, sessao=date(2026, 6, 18)):
    acervo = PROCESSOS_023 + PROCESSOS_022 if acervo is None else acervo
    """Zera o banco e monta o cenário: acervo com os processos e uma sessão anterior."""
    cur.execute('delete from julgados_cj; delete from pautas_cj; delete from acervo_cj')
    for i, num in enumerate(acervo):
        cur.execute("""insert into acervo_cj
                       (num_processo, relator, data_distribuicao, defesa, origem)
                       values (%s, %s, date '2026-03-10', %s, 'planilha')""",
                    (num, f'CJ{i + 1}', i % 2 == 0))
    cur.execute("""insert into acervo_cj (num_processo, relator, data_distribuicao, origem)
                   values ('202600029999999', 'CJ1', date '2026-01-05', 'planilha')""")
    cur.execute("""insert into julgados_cj (num_processo, data_sessao, pauta)
                   values ('202600029999999', %s, 20)""", (sessao,))
    cur.connection.commit()


def fonte_com(numeros, falhas=()):
    """AGRFalsa servindo PDFs de verdade para as reuniões pedidas."""
    textos = {21: PAUTA_021, 22: PAUTA_022, 23: PAUTA_023}
    return AGRFalsa(pdfs={url_da(n): pdf_falso(textos[n]) for n in numeros},
                    falhas=[url_da(n) for n in falhas])


@teste
def sincroniza_apenas_o_que_e_novo(cur):
    """Só entram sessões posteriores à última do banco e já realizadas."""
    preparar(cur)
    with fonte_com([21, 22, 23]):
        r = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    assert r['ultima_sessao_conhecida'] == '2026-06-18'
    assert r['documentos_encontrados'] == 30
    assert r['documentos_novos'] == 3, r['documentos_novos']
    assert r['documentos_processados'] == 3 and not r['erros']
    assert r['processos_encontrados'] == 21          # 15 da 21ª + 2 da 22ª + 4 da 23ª
    assert r['processos_importados'] == 21

    assert uma(cur, 'select count(*) from julgados_cj') == 22   # 21 + a sessão anterior
    assert uma(cur, """select count(*) from julgados_cj
                        where data_sessao = date '2026-07-02' and pauta = 23""") == 4
    assert uma(cur, """select num_processo from julgados_cj
                        where data_sessao = date '2026-07-02' order by num_processo limit 1""") \
        == min(PROCESSOS_023)
    assert uma(cur, """select count(*) from julgados_cj
                        where num_processo = %s""", (REFERENCIA_023,)) == 0, \
        'o processo do rodapé entrou no banco'


@teste
def campos_derivados_saem_do_acervo(cur):
    """A regra Acervo → Julgados é a do gatilho: a sincronização não a repete."""
    preparar(cur, sessao=date(2026, 6, 30))
    with fonte_com([23]):
        sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    cur.execute("""select j.relator, j.defesa, j.data_distribuicao, j.dias_dt, j.periodo_dt,
                          a.num_processo
                     from julgados_cj j join acervo_cj a on a.id = j.acervo_id
                    where j.num_processo = %s""", (PROCESSOS_023[0],))
    relator, defesa, dist, dias, periodo, acervo = cur.fetchone()
    assert (relator, defesa, dist) == ('CJ1', True, date(2026, 3, 10))
    assert (dias, periodo) == (114, '3T26')
    assert acervo == PROCESSOS_023[0]


@teste
def julgado_sincronizado_nasce_sem_voto_e_sem_status(cur):
    """A pauta é convocação: voto e status só existem depois da sessão, e são
    preenchidos à mão na página julgados.html."""
    preparar(cur, sessao=date(2026, 6, 30))
    with fonte_com([23]):
        sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    assert uma(cur, """select count(*) from julgados_cj
                        where data_sessao = date '2026-07-02'
                          and voto is null and status is null
                          and atualizado_em is null""") == 4


@teste
def executar_de_novo_nao_duplica(cur):
    """Idempotência: a segunda rodada não encontra nada para fazer."""
    preparar(cur)
    with fonte_com([21, 22, 23]):
        primeira = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))
        antes = uma(cur, 'select count(*) from julgados_cj')
        segunda = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    assert primeira['documentos_processados'] == 3
    assert segunda['documentos_novos'] == 0 and segunda['documentos_processados'] == 0
    assert uma(cur, 'select count(*) from julgados_cj') == antes
    assert uma(cur, 'select count(*) from pautas_cj') == 3


@teste
def mesmo_documento_reprocessado_nao_duplica_julgados(cur):
    """Mesmo forçando com --desde, a chave natural de julgados_cj segura."""
    preparar(cur, sessao=date(2026, 6, 30))
    with fonte_com([23]):
        sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))
        antes = uma(cur, 'select count(*) from julgados_cj')
        cur.execute('delete from pautas_cj')          # simula perder o registro
        cur.connection.commit()
        r = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5),
                                    desde=date(2026, 6, 30))

    assert r['documentos_processados'] == 1
    assert r['processos_importados'] == 0 and r['processos_duplicados'] == 4
    assert uma(cur, 'select count(*) from julgados_cj') == antes


@teste
def processo_fora_do_acervo_entra_e_e_reportado(cur):
    """Não inventa dado, não interrompe os outros, e deixa o caso registrado."""
    preparar(cur, acervo=PROCESSOS_023[:2], sessao=date(2026, 6, 30))
    with fonte_com([23]):
        r = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    ausentes = sorted(PROCESSOS_023[2:])
    assert r['processos_importados'] == 4
    assert r['processos_sem_acervo'] == ausentes
    assert uma(cur, 'select processos_sem_acervo from pautas_cj') == ausentes

    cur.execute("""select relator, defesa, data_distribuicao, dias_dt
                     from julgados_cj where num_processo = %s""", (ausentes[0],))
    assert cur.fetchone() == (None, None, None, None), 'não pode inventar dado do acervo'
    assert uma(cur, """select count(*) from julgados_cj
                        where acervo_id is null and data_sessao = date '2026-07-02'""") == 2


@teste
def um_pdf_com_problema_nao_para_os_demais(cur):
    preparar(cur)
    with fonte_com([21, 22, 23], falhas=[21]):
        r = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    assert r['documentos_processados'] == 2
    assert r['documentos_com_erro'] == 1
    assert r['erros'][0]['numero'] == 21 and 'ErroAGR' in r['erros'][0]['erro']
    assert uma(cur, """select count(*) from julgados_cj
                        where data_sessao = date '2026-07-02'""") == 4
    assert uma(cur, 'select count(*) from pautas_cj') == 2, \
        'documento que falhou não pode ficar marcado como processado'


@teste
def documento_sem_processo_vira_erro_e_nao_e_marcado(cur):
    preparar(cur, sessao=date(2026, 6, 30))
    vazio = pdf_falso('PAUTA DE REUNIAO - 23\nData: 02/07/2026\n'
                      'Referencia: Processo no 202600029000051')
    with AGRFalsa(pdfs={url_da(23): vazio}):
        r = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    assert r['documentos_processados'] == 0 and r['documentos_com_erro'] == 1
    assert 'ErroPauta' in r['erros'][0]['erro']
    assert uma(cur, 'select count(*) from pautas_cj') == 0


@teste
def sessao_que_ainda_nao_aconteceu_fica_de_fora(cur):
    """Pauta é convocação: só entra depois que a sessão acontece."""
    preparar(cur)
    with fonte_com([21]):
        r = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 6, 24))
    assert r['documentos_novos'] == 0
    assert uma(cur, 'select count(*) from pautas_cj') == 0


@teste
def simulacao_nao_grava_nada(cur):
    preparar(cur)
    antes = uma(cur, 'select count(*) from julgados_cj')
    with fonte_com([21, 22, 23]):
        r = sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5),
                                    simular=True)

    assert r['simulacao'] is True
    assert r['documentos_processados'] == 3 and r['processos_importados'] == 21
    assert uma(cur, 'select count(*) from julgados_cj') == antes
    assert uma(cur, 'select count(*) from pautas_cj') == 0


@teste
def a_data_do_julgado_e_a_da_reuniao(cur):
    """Nunca a data em que a sincronização rodou."""
    preparar(cur)
    with fonte_com([21, 22, 23]):
        sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 8, 19))

    cur.execute('select distinct data_sessao, pauta from julgados_cj order by data_sessao')
    assert cur.fetchall() == [(date(2026, 6, 18), 20),
                              (date(2026, 6, 25), 21),
                              (date(2026, 6, 30), 22),
                              (date(2026, 7, 2), 23)]


@teste
def pautas_cj_guarda_o_rastro(cur):
    preparar(cur, sessao=date(2026, 6, 30))
    with fonte_com([23]):
        sincronizar.sincronizar(cur.connection, ano=2026, hoje=date(2026, 7, 5))

    cur.execute("""select url, numero, data_sessao, length(sha256),
                          processos_encontrados, processos_importados
                     from pautas_cj""")
    url, numero, sessao, tam_sha, encontrados, importados = cur.fetchone()
    assert url == url_da(23) and numero == 23 and sessao == date(2026, 7, 2)
    assert tam_sha == 64
    assert (encontrados, importados) == (4, 4)


@teste
def pautas_cj_fechada_para_o_navegador(cur):
    assert uma(cur, "select relrowsecurity from pg_class where oid = 'public.pautas_cj'::regclass") is True
    assert uma(cur, "select count(*) from pg_policies where tablename = 'pautas_cj'") == 0


@teste
@exige_rede
def o_site_da_agr_continua_no_formato_esperado():
    """Único teste que sai para a internet: avisa se o portal mudar."""
    pautas = agr.listar_pautas(2026)
    assert len(pautas) >= 30
    recente = max(pautas, key=lambda p: p.data_sessao)
    _, sha = agr.baixar_pdf(recente)
    assert len(sha) == 64

    texto = pauta.extrair_texto(agr._baixar(recente.url))
    assert pauta.extrair_processos(texto), 'nenhum processo na pauta mais recente'
    assert pauta.numeros_sem_rotulo(texto) == [], 'formato dos números mudou'
    assert pauta.data_no_pdf(texto) == recente.data_sessao


# ── Runner ───────────────────────────────────────────────────────────────────

def main(argv):
    global online
    online = '--online' in argv

    PG.subir()
    try:
        PG.rodar_arquivo(RAIZ / 'sql' / 'schema.sql')

        falhas = 0
        with PG.conectar() as conn:
            for fn in testes:
                if getattr(fn, 'precisa_rede', False) and not online:
                    print(f'PULA  {fn.__name__} (use --online)')
                    continue
                precisa_cur = fn.__code__.co_argcount == 1
                cur = conn.cursor() if precisa_cur else None
                try:
                    fn(cur) if precisa_cur else fn()
                    conn.commit()
                    print(f'ok    {fn.__name__}')
                except Exception as e:
                    conn.rollback()
                    falhas += 1
                    print(f'FALHA {fn.__name__}: {type(e).__name__}: {e}')
                finally:
                    if cur:
                        cur.close()

        print(f'\n{len(testes) - falhas}/{len(testes)} testes passaram.')
        return 1 if falhas else 0
    finally:
        PG.derrubar()


if __name__ == '__main__':
    sys.exit(main(sys.argv))
