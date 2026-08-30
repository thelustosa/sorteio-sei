"""Cliente do site da AGR: lista as pautas publicadas e baixa os PDFs.

Só sabe falar com o portal do Estado de Goiás. Não recebe URL de fora: o
endereço da listagem é montado aqui a partir do ano, e todo link encontrado é
conferido contra a lista de hosts permitidos antes de qualquer download —
inclusive depois de um redirecionamento.
"""

import hashlib
import html
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date

# Única referência ao ano: trocar de 2026 para 2027 não exige mexer no código.
#
# Cada colegiado tem a sua página. A da Câmara de Julgamento reúne as reuniões
# de mais de uma comissão e por isso precisa do filtro por título; a do Conselho
# Regulador só publica sessões do próprio Conselho, e os títulos lá não trazem o
# nome do colegiado ("Pauta da 015ª Sessão Ordinária") — filtrar por ele
# devolveria zero.
LISTAGEM = 'https://goias.gov.br/agr/pautas-das-reunioes-{ano}/'
LISTAGEM_CREG = 'https://goias.gov.br/agr/pautas-das-sessoes-do-conselho-regulador-{ano}/'
HOSTS_PERMITIDOS = frozenset({'goias.gov.br', 'www.goias.gov.br'})
TIMEOUT = 30
AGENTE = 'sorteio-sei/1.0 (+https://github.com/thelustosa/sorteio-sei)'

# <a href="…Pauta-21a-RP-CJ-25.06.2026.pdf">Pauta da 021ª Reunião …</a> – 25/06/2026 às 09:00
ITEM = re.compile(
    r'<a[^>]+href="(?P<url>[^"]+\.pdf)"[^>]*>(?P<titulo>[^<]*)</a>'
    r'[^<]*?(?P<dia>\d{2})/(?P<mes>\d{2})/(?P<ano>\d{4})',
    re.IGNORECASE)
NUMERO = re.compile(r'(\d{1,3})\s*[ªa]\s', re.IGNORECASE)

# A AGR pendura o aviso no MESMO item da listagem, como link ao lado da pauta:
#
#   <a …>Pauta da 006ª Sessão…</a> – 19/03/2026 … <a …>AVISO (Reunião Cancelada)</a>
#   <a …>Pauta da 003ª Sessão…</a> – 05/02/2026 … <a …>aviso – sessão adiada
#                                                  para o dia 09/02/2026 …</a>
#
# Sem ler esses avisos, a sessão cancelada era baixada e gravada como se tivesse
# acontecido, e a adiada entrava com a data em que não houve sessão — as duas
# contaminando data_sessao, de onde saem dias_dt e meta_45. O aviso não vira
# pauta sozinho porque o ITEM exige uma data logo depois do link, e ele não tem.
LINK = re.compile(r'<a[^>]*>([^<]*)</a>', re.IGNORECASE)
CANCELADA = re.compile(r'cancelad', re.IGNORECASE)
ADIADA = re.compile(r'adiad', re.IGNORECASE)
DATA_BR = re.compile(r'(\d{2})/(\d{2})/(\d{4})')


@dataclass(frozen=True)
class Pauta:
    """Uma reunião anunciada na listagem da AGR."""
    url: str
    titulo: str
    numero: int
    data_sessao: date


class ErroAGR(Exception):
    """Falha ao falar com o site da AGR."""


def _sem_acento(texto):
    return ''.join(c for c in unicodedata.normalize('NFKD', texto.casefold())
                   if not unicodedata.combining(c))


def _conferir_origem(url):
    partes = urllib.parse.urlsplit(url)
    if partes.scheme != 'https' or partes.hostname not in HOSTS_PERMITIDOS:
        raise ErroAGR(f'endereço fora da fonte oficial: {url}')
    return url


class _RedirecionamentoConferido(urllib.request.HTTPRedirectHandler):
    """Um redirect não pode tirar o download do portal do Estado de Goiás."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _conferir_origem(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_abridor = urllib.request.build_opener(_RedirecionamentoConferido)


def _baixar(url):
    _conferir_origem(url)
    pedido = urllib.request.Request(url, headers={'User-Agent': AGENTE})
    try:
        with _abridor.open(pedido, timeout=TIMEOUT) as resposta:
            return resposta.read()
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise ErroAGR(f'não foi possível baixar {url}: {e}') from e


def listar_pautas(ano, comissao='Câmara de Julgamento', listagem=LISTAGEM):
    """Pautas da comissão publicadas na página do ano, da mais recente para trás.

    A data vem da própria listagem (`– 25/06/2026 às 09:00 horas`), que é a
    fonte mais direta. O PDF traz a mesma data num campo `Data:` e o
    sincronizador confere as duas antes de gravar.

    `comissao=None` aceita todo item da página. É o caso do Conselho Regulador,
    que tem página própria: lá o filtro não separa nada e os títulos sequer
    nomeiam o colegiado.

    Sessão cancelada não é devolvida, e sessão adiada vem com a data nova — as
    duas lidas do aviso que a AGR publica no próprio item (ver LINK, acima).
    """
    pagina = _baixar(listagem.format(ano=ano)).decode('utf-8', 'replace')
    alvo = _sem_acento(comissao) if comissao else None

    itens = list(ITEM.finditer(pagina))
    pautas = []
    for i, m in enumerate(itens):
        titulo = html.unescape(m.group('titulo')).strip()
        if alvo is not None and alvo not in _sem_acento(titulo):
            continue

        numero = NUMERO.search(titulo)
        if not numero:
            continue  # sem número de reunião não dá para preencher a pauta

        data = date(int(m.group('ano')), int(m.group('mes')), int(m.group('dia')))

        # O aviso desta pauta é o que vem depois dela e antes da próxima.
        ate = itens[i + 1].start() if i + 1 < len(itens) else len(pagina)
        avisos = [html.unescape(a) for a in LINK.findall(pagina[m.end():ate])]

        if any(CANCELADA.search(a) for a in avisos):
            continue  # a sessão não aconteceu: não há julgado para importar

        adiada = next((a for a in avisos if ADIADA.search(a)), None)
        nova = DATA_BR.search(adiada) if adiada else None
        if nova:
            data = date(int(nova.group(3)), int(nova.group(2)), int(nova.group(1)))

        pautas.append(Pauta(
            url=html.unescape(m.group('url')),
            titulo=titulo,
            numero=int(numero.group(1)),
            data_sessao=data,
        ))

    if not pautas:
        raise ErroAGR(f'nenhuma pauta de {comissao or "colegiado"} encontrada em '
                      f'{ano} — o HTML da AGR pode ter mudado')
    return pautas


def baixar_pdf(pauta):
    """Bytes do PDF e o sha256 do que veio, para o registro de auditoria."""
    conteudo = _baixar(pauta.url)
    if not conteudo.startswith(b'%PDF'):
        raise ErroAGR(f'{pauta.url} não devolveu um PDF')
    return conteudo, hashlib.sha256(conteudo).hexdigest()
