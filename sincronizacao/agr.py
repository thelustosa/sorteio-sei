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
LISTAGEM = 'https://goias.gov.br/agr/pautas-das-reunioes-{ano}/'
HOSTS_PERMITIDOS = frozenset({'goias.gov.br', 'www.goias.gov.br'})
TIMEOUT = 30
AGENTE = 'sorteio-sei/1.0 (+https://github.com/thelustosa/sorteio-sei)'

# <a href="…Pauta-21a-RP-CJ-25.06.2026.pdf">Pauta da 021ª Reunião …</a> – 25/06/2026 às 09:00
ITEM = re.compile(
    r'<a[^>]+href="(?P<url>[^"]+\.pdf)"[^>]*>(?P<titulo>[^<]*)</a>'
    r'[^<]*?(?P<dia>\d{2})/(?P<mes>\d{2})/(?P<ano>\d{4})',
    re.IGNORECASE)
NUMERO = re.compile(r'(\d{1,3})\s*[ªa]\s', re.IGNORECASE)


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


def listar_pautas(ano, comissao='Câmara de Julgamento'):
    """Pautas da comissão publicadas na página do ano, da mais recente para trás.

    A data vem da própria listagem (`– 25/06/2026 às 09:00 horas`), que é a
    fonte mais direta. O PDF traz a mesma data num campo `Data:` e o
    sincronizador confere as duas antes de gravar.
    """
    pagina = _baixar(LISTAGEM.format(ano=ano)).decode('utf-8', 'replace')
    alvo = _sem_acento(comissao)

    pautas = []
    for m in ITEM.finditer(pagina):
        titulo = html.unescape(m.group('titulo')).strip()
        if alvo not in _sem_acento(titulo):
            continue

        numero = NUMERO.search(titulo)
        if not numero:
            continue  # sem número de reunião não dá para preencher a pauta

        pautas.append(Pauta(
            url=html.unescape(m.group('url')),
            titulo=titulo,
            numero=int(numero.group(1)),
            data_sessao=date(int(m.group('ano')), int(m.group('mes')), int(m.group('dia'))),
        ))

    if not pautas:
        raise ErroAGR(f'nenhuma pauta de {comissao} encontrada em {ano} — '
                      'o HTML da AGR pode ter mudado')
    return pautas


def baixar_pdf(pauta):
    """Bytes do PDF e o sha256 do que veio, para o registro de auditoria."""
    conteudo = _baixar(pauta.url)
    if not conteudo.startswith(b'%PDF'):
        raise ErroAGR(f'{pauta.url} não devolveu um PDF')
    return conteudo, hashlib.sha256(conteudo).hexdigest()
