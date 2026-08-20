"""Leitura do PDF da pauta: texto, data da sessão e processos julgados.

A regra que manda aqui: o número que aparece em `Referência: Processo nº …`, no
rodapé, é o processo do próprio documento no SEI — nunca um processo julgado.
A exclusão é por contexto, não por valor: o número muda a cada ano.

A extração é em duas etapas, de propósito, para ficar legível e testável:

    texto → apaga os trechos de Referência → procura os processos

em vez de um regex único com lookbehind tentando dar conta de tudo.
"""

import io
import re
from datetime import date

import pypdf

# Processo SEI da AGR: 15 dígitos (ano + órgão + sequencial), sempre precedido
# de "Processo nº". Conferido em 10 pautas de datas diferentes: 190 números de
# 15 dígitos, 190 com o rótulo, nenhum outro número do documento chega a 15
# dígitos (auto de infração tem 5, código verificador do SEI tem 8).
# O rótulo tolera nº, n°, no, n. ou nada, e espaço/quebra de linha no meio.
ROTULO = r'processo\s*n?[º°ᵒo]?\.?\s*'
PROCESSO = re.compile(ROTULO + r'(\d{15})(?!\d)', re.IGNORECASE)
REFERENCIA = re.compile(r'refer[êe]ncia\s*:?\s*' + ROTULO + r'\d{15}(?!\d)', re.IGNORECASE)
QUINZE_DIGITOS = re.compile(r'(?<!\d)\d{15}(?!\d)')

DATA_SESSAO = re.compile(r'^[ \t]*Data:[ \t]*(\d{2})/(\d{2})/(\d{4})', re.IGNORECASE | re.MULTILINE)


class ErroPauta(Exception):
    """PDF ilegível, sem texto ou fora do formato esperado."""


def extrair_texto(pdf_bytes):
    try:
        leitor = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        texto = '\n'.join(pagina.extract_text() or '' for pagina in leitor.pages)
    except Exception as e:  # pypdf levanta uma família grande de exceções
        raise ErroPauta(f'PDF inválido: {e}') from e

    if not texto.strip():
        raise ErroPauta('PDF sem texto extraível (provavelmente digitalizado)')
    return texto


def sem_referencias(texto):
    """O texto sem os trechos `Referência: Processo nº …`."""
    return REFERENCIA.sub(' ', texto)


def extrair_processos(texto):
    """Processos julgados na pauta, na ordem do documento, sem repetição.

    O número sai do regex já normalizado — só dígitos, sem espaço, quebra de
    linha ou pontuação, que é a forma usada em acervo_cj e julgados_cj.
    """
    achados = (m.group(1) for m in PROCESSO.finditer(sem_referencias(texto)))
    return list(dict.fromkeys(achados))


def numeros_sem_rotulo(texto):
    """Números de 15 dígitos que o parser deixou passar.

    Nas pautas analisadas isso é sempre vazio. Deixar de ser vazio é o sinal de
    que a AGR mudou o formato e o parser precisa de revisão — por isso a
    sincronização registra o aviso em vez de descobrir tarde demais.
    """
    limpo = sem_referencias(texto)
    com_rotulo = {m.group(1) for m in PROCESSO.finditer(limpo)}
    return sorted(set(QUINZE_DIGITOS.findall(limpo)) - com_rotulo)


def data_no_pdf(texto):
    """A data da sessão declarada no corpo do PDF (`Data: 25/06/2026`)."""
    m = DATA_SESSAO.search(texto)
    if not m:
        return None
    return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
