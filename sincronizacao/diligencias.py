#!/usr/bin/env python3
"""Sincroniza as diligências do Conselho Regulador com a planilha da AGR.

    python sincronizacao/diligencias.py --dsn "postgresql://…"
    python sincronizacao/diligencias.py --simular          # não grava nada

O DSN também pode vir da variável de ambiente SUPABASE_DB_URL.

O endereço da planilha vem SEMPRE da variável DILIGENCIAS_CSV_URL, nunca do
código: o link de publicação do Google é uma credencial de leitura, e este
repositório é público (ver VARIAVEL, abaixo).

A fonte é uma planilha que a equipe da AGR mantém à mão e publica na web. Não
há API: o que existe é a publicação, e dela se pede a versão CSV — o `pubhtml`
é uma casca de JavaScript, sem uma linha de dado no HTML.

Fluxo:

    planilha publicada (CSV) → confere o cabeçalho → uma Diligencia por linha
      → apaga e regrava public.diligencias_creg numa transação só

Por que substituir a tabela inteira em vez de comparar: a planilha é a fonte, e
uma linha que sai dela deixou de existir. São 44 linhas — lógica de diferença
custaria mais do que a tabela toda.

Quem usa o que entra aqui é o recorte "Em diligência" do painel do acervo, em
resumo_acervo_creg e processos_acervo_creg. Quem decide o recorte é a coluna
RETORNO — `NÃO` é diligência aberta, `SIM` é processo que voltou. Este módulo
não interpreta nada: grava as colunas como vieram e deixa a regra no banco, num
lugar só (ver sql/schema.sql).
"""

import argparse
import csv
import io
import json
import logging
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date

import psycopg2
import psycopg2.extras

log = logging.getLogger('diligencias')

# A URL vem de fora, pela variável de ambiente, e NÃO mora no código.
#
# O link de publicação do Google é uma credencial: quem o tem lê a planilha,
# sem login. A planilha não é pública — está publicada na web para que este job
# a leia — e este repositório é. Escrever o id aqui entregaria a leitura da
# planilha a qualquer pessoa que clonasse o projeto, que é o mesmo motivo de
# SUPABASE_DB_URL e de dados/*.sql estarem fora do Git.
#
# No Actions, cadastre em Settings → Secrets and variables → Actions o segredo
# DILIGENCIAS_CSV_URL com o endereço `…/pub?gid=…&single=true&output=csv` da
# publicação (não o `pubhtml`, que é uma casca de JavaScript).
VARIAVEL = 'DILIGENCIAS_CSV_URL'

# O `pub` responde 307 para um host de download que MUDA a cada pedido
# (doc-0o-9k-sheets.googleusercontent.com hoje, outro amanhã). Por isso a
# allowlist tem um sufixo, e não a lista fechada que agr.py pode se dar ao luxo
# de ter — lá o destino é sempre goias.gov.br.
HOSTS_PERMITIDOS = frozenset({'docs.google.com'})
SUFIXO_PERMITIDO = '.googleusercontent.com'
TIMEOUT = 30
AGENTE = 'sorteio-sei/1.0 (+https://github.com/thelustosa/sorteio-sei)'

# O cabeçalho é o contrato. Se a planilha for reestruturada, é aqui que a
# rodada para — em vez de gravar colunas trocadas ou esvaziar a tabela em
# silêncio, que é o que faria o filtro do painel devolver zero sem erro nenhum.
CABECALHO = ['INTERESSADO', 'PROCESSO', 'ASSUNTO', 'DATA DA DILIGÊNCIA',
             'RETORNO', 'JULGADOS']

# INTERESSADO fica de fora da tabela, pela mesma razão que acervo_creg não
# recebe interessado por importação. Nas linhas recentes a coluna nem traz
# interessado: traz a unidade ('CREG3').
#
# RETORNO entra inteiro e sem normalização: é ele quem decide o recorte do
# painel, e normalizar em dois lugares é como as duas pontas divergem. Quem
# trata 'NÃO'/'NAO'/'não' é o SQL, uma vez.


@dataclass(frozen=True)
class Diligencia:
    """Uma linha da planilha."""
    num_processo: str
    data_diligencia: date
    descricao: str
    retorno: str
    julgados: str
    linha: int


class ErroPlanilha(Exception):
    """A planilha não está onde ou como deveria."""


def _conferir_origem(url):
    partes = urllib.parse.urlsplit(url)
    hospedeiro = partes.hostname or ''
    permitido = (hospedeiro in HOSTS_PERMITIDOS
                 or hospedeiro.endswith(SUFIXO_PERMITIDO))
    if partes.scheme != 'https' or not permitido:
        # O caminho e a query carregam o id de publicação da planilha. Mesmo
        # numa configuração inválida eles continuam sendo credencial e não
        # podem ir parar no log público do Actions. Esquema e host bastam para
        # diagnosticar a origem recusada.
        origem = f'{partes.scheme or "sem-esquema"}://{hospedeiro or "sem-host"}'
        raise ErroPlanilha(f'endereço fora da fonte oficial ({origem})')
    return url


class _RedirecionamentoConferido(urllib.request.HTTPRedirectHandler):
    """Um redirect não pode tirar o download do Google."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _conferir_origem(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_abridor = urllib.request.build_opener(_RedirecionamentoConferido)


def fonte():
    """O endereço da planilha, do ambiente. Sem ele não há o que sincronizar."""
    url = (os.environ.get(VARIAVEL) or '').strip()
    if not url:
        raise ErroPlanilha(
            f'{VARIAVEL} não definida: sem ela não há endereço de planilha. '
            f'No Actions é um segredo; localmente, exporte a variável.')
    return url


def baixar(url=None):
    """O CSV publicado, como texto."""
    url = url or fonte()
    _conferir_origem(url)
    pedido = urllib.request.Request(url, headers={'User-Agent': AGENTE})
    try:
        with _abridor.open(pedido, timeout=TIMEOUT) as resposta:
            return resposta.read().decode('utf-8', 'replace')
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        # `url` é segredo, e a própria exceção de urllib também pode
        # reproduzi-la. O tipo preserva informação operacional sem publicar a
        # credencial no JSON, no log ou no resumo do job.
        raise ErroPlanilha(
            f'não foi possível baixar a planilha ({type(e).__name__})') from None


def _data(texto):
    """dd/mm/aaaa, com ou sem zero à esquerda — a planilha tem `23/9/2025`.

    strptime('%d/%m/%Y') aceita o dia sem zero, mas não perdoa espaço em volta
    nem separador diferente; e o que interessa recusar aqui é a data impossível,
    não a digitação folgada. Por isso a conversão é feita à mão, com o date()
    fazendo a validação do calendário.
    """
    partes = texto.strip().split('/')
    if len(partes) != 3:
        raise ValueError(f'data fora do formato dd/mm/aaaa: {texto!r}')
    dia, mes, ano = (int(p) for p in partes)
    return date(ano, mes, dia)


def analisar(texto):
    """As linhas válidas da planilha, na ordem em que aparecem nela.

    Linha com processo fora do formato ou data impossível é descartada com um
    aviso: uma digitação errada não pode derrubar a rodada inteira. Cabeçalho
    diferente do esperado, sim — aí a planilha mudou de forma e nada do que se
    leia dela é confiável.
    """
    leitor = csv.reader(io.StringIO(texto))
    try:
        cabecalho = [c.strip() for c in next(leitor)]
    except StopIteration:
        raise ErroPlanilha('a planilha veio vazia') from None

    if cabecalho != CABECALHO:
        raise ErroPlanilha(
            f'cabeçalho inesperado: {cabecalho} — esperado {CABECALHO}')

    diligencias = []
    for numero, linha in enumerate(leitor, start=1):
        if not any(c.strip() for c in linha):
            continue  # linha em branco no fim da planilha
        linha += [''] * (len(CABECALHO) - len(linha))
        processo = linha[1].strip()

        if not (len(processo) == 15 and processo.isdigit()):
            log.warning('linha %d descartada: processo %r', numero, processo)
            continue
        try:
            quando = _data(linha[3])
        except ValueError as e:
            log.warning('linha %d descartada: %s', numero, e)
            continue

        diligencias.append(Diligencia(
            num_processo=processo,
            data_diligencia=quando,
            descricao=linha[2].strip(),
            retorno=linha[4].strip(),
            julgados=linha[5].strip(),
            linha=numero,
        ))

    if not diligencias:
        raise ErroPlanilha('a planilha não tem nenhuma linha válida')
    return diligencias


def gravar(cur, diligencias):
    """Substitui a tabela inteira. Devolve quantas linhas entraram."""
    cur.execute('delete from public.diligencias_creg')
    psycopg2.extras.execute_values(
        cur,
        """insert into public.diligencias_creg
           (num_processo, data_diligencia, descricao, retorno, julgados, linha)
           values %s""",
        [(d.num_processo, d.data_diligencia, d.descricao, d.retorno,
          d.julgados, d.linha) for d in diligencias])
    return len(diligencias)


def sincronizar(conn, texto=None, simular=False):
    """Roda a sincronização inteira e devolve o resumo da operação."""
    resumo = {
        # Sem a URL: este JSON vai para o log do Actions e para o resumo do
        # job, os dois legíveis por qualquer pessoa no repositório público.
        'simulacao': simular,
        'linhas_lidas': 0,
        'processos_distintos': 0,
        'gravadas': 0,
        'erros': [],
    }

    try:
        diligencias = analisar(texto if texto is not None else baixar())
    except ErroPlanilha as e:
        # Nada é apagado: o `delete` só acontece depois de a planilha ter sido
        # lida inteira e com sucesso. Uma planilha fora do ar deixa a tabela
        # como estava, envelhecendo — que é melhor do que vazia.
        log.error('%s: %s', type(e).__name__, e)
        resumo['erros'].append(f'{type(e).__name__}: {e}')
        return resumo

    resumo['linhas_lidas'] = len(diligencias)
    resumo['processos_distintos'] = len({d.num_processo for d in diligencias})

    try:
        with conn.cursor() as cur:
            resumo['gravadas'] = gravar(cur, diligencias)
        conn.rollback() if simular else conn.commit()
    except Exception as e:
        conn.rollback()
        log.error('%s: %s', type(e).__name__, e)
        resumo['gravadas'] = 0
        resumo['erros'].append(f'{type(e).__name__}: {e}')

    return resumo


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--dsn', default=os.environ.get('SUPABASE_DB_URL'),
                   help='conexão do Postgres (padrão: variável SUPABASE_DB_URL)')
    p.add_argument('--simular', action='store_true',
                   help='faz tudo e desfaz no fim: nada é gravado')
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')

    if not args.dsn:
        p.error('informe --dsn ou defina SUPABASE_DB_URL')

    with psycopg2.connect(args.dsn) as conn:
        resumo = sincronizar(conn, simular=args.simular)

    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    return 1 if resumo['erros'] else 0


if __name__ == '__main__':
    sys.exit(main())
