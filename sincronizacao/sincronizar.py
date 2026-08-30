#!/usr/bin/env python3
"""Sincroniza os julgados de um colegiado com as pautas publicadas pela AGR.

    python sincronizacao/sincronizar.py --dsn "postgresql://…"
    python sincronizacao/sincronizar.py --colegiado CREG
    python sincronizacao/sincronizar.py --simular          # não grava nada

O DSN também pode vir da variável de ambiente SUPABASE_DB_URL.

São dois colegiados, com o MESMO fluxo e as mesmas regras, mudando só a página
da AGR e o par de tabelas (ver COLEGIADOS, abaixo). A Câmara de Julgamento é o
padrão porque foi a primeira.

Fluxo:

    listagem da AGR → pautas ainda não processadas → baixa o PDF
      → extrai o texto → descarta o rodapé `Referência: Processo nº …`
      → extrai e normaliza os processos → insere na tabela de julgados
      → o gatilho do banco busca cada processo no acervo do colegiado e
        preenche os campos derivados
      → registra o documento na tabela de pautas

Quais pautas entram: as da comissão certa, com sessão já realizada, URL ainda
não registrada na tabela de pautas e posteriores ao marco de início da série. O marco
é fixo: uma pauta que falhar continua elegível mesmo que uma sessão posterior
seja processada ou o ano vire, e uma republicação com URL nova também entra. Na
execução automática são consultadas as listagens de todos os anos desde o marco;
`--ano` limita a uma listagem quando a operação manual precisar disso.

Nada aqui reimplementa a regra Acervo → Julgados: quem preenche os campos
derivados é o gatilho julgados_<colegiado>_derivar_do_acervo, em schema.sql.
"""

import argparse
import json
import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agr      # noqa: E402
import pauta    # noqa: E402

log = logging.getLogger('sincronizar')

# Onde cada colegiado publica e onde cada um guarda. Os nomes de tabela saem
# daqui e de nenhum outro lugar — nunca da linha de comando —, e é por isso que
# entram nas consultas por interpolação de texto.
COLEGIADOS = {
    'CJ': {
        'julgados': 'julgados_cj',
        'pautas': 'pautas_cj',
        'listagem': agr.LISTAGEM,
        'comissao': 'Câmara de Julgamento',
    },
    'CREG': {
        'julgados': 'julgados_creg',
        'pautas': 'pautas_creg',
        # A página do Conselho só publica sessões dele: filtrar por título
        # devolveria zero, porque os títulos não nomeiam o colegiado. Sem esse
        # filtro, o que separa sessão cancelada e adiada das demais é a leitura
        # dos avisos da própria listagem, em agr.listar_pautas.
        'listagem': agr.LISTAGEM_CREG,
        'comissao': None,
    },
}


# ── Banco ────────────────────────────────────────────────────────────────────

def ultima_sessao(cur, col):
    """A sessão mais recente que o banco já conhece, por qualquer caminho."""
    cur.execute(f"""
        select greatest(
                 coalesce((select max(data_sessao) from public.{col['julgados']}),
                          date '1900-01-01'),
                 coalesce((select max(data_sessao) from public.{col['pautas']}),
                          date '1900-01-01'))
    """)
    return cur.fetchone()[0]


def urls_processadas(cur, col):
    cur.execute(f"select url from public.{col['pautas']}")
    return {u for (u,) in cur.fetchall()}


def inicio_da_serie(cur, col):
    """Devolve o marco fixo do histórico, quando configurado."""
    cur.execute(f"""select max(data_sessao) from public.{col['pautas']}
                     where url = 'marco:inicio-da-serie'""")
    return cur.fetchone()[0]


def gravar_julgados(cur, col, p, processos):
    """Insere os processos da pauta e devolve (importados, sem_acervo).

    Um único INSERT para o documento inteiro: o gatilho resolve o acervo linha a
    linha usando o índice do acervo, sem consulta extra da aplicação. O
    RETURNING só traz as linhas realmente inseridas, então o que faltar são os
    processos que já estavam gravados naquela sessão.
    """
    inseridos = psycopg2.extras.execute_values(
        cur,
        f"""insert into public.{col['julgados']} (num_processo, data_sessao, pauta)
            values %s
            on conflict on constraint {col['julgados']}_sessao_unica do nothing
            returning num_processo, acervo_id""",
        [(n, p.data_sessao, p.numero) for n in processos],
        fetch=True)

    sem_acervo = sorted(num for num, acervo_id in inseridos if acervo_id is None)
    return len(inseridos), sem_acervo


def registrar_pauta(cur, col, p, sha256, encontrados, importados, sem_acervo):
    cur.execute(f"""
        insert into public.{col['pautas']}
          (url, titulo, numero, data_sessao, sha256,
           processos_encontrados, processos_importados, processos_sem_acervo)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (url) do nothing
    """, (p.url, p.titulo, p.numero, p.data_sessao, sha256,
          encontrados, importados, sem_acervo))


# ── Orquestração ─────────────────────────────────────────────────────────────

def pautas_pendentes(cur, col, ano=None, desde=None, hoje=None):
    """(pautas, pendentes, corte, anos consultados e listagens que falharam)."""
    hoje = hoje or date.today()
    marco = inicio_da_serie(cur, col)
    corte = desde or marco or ultima_sessao(cur, col)
    ja_vistas = urls_processadas(cur, col)

    if ano is not None:
        anos = [ano]
    elif desde is not None or marco is not None:
        anos = list(range(corte.year, hoje.year + 1))
    else:
        anos = [hoje.year]
    # Cada ano é consultado por conta própria. listar_pautas levanta ErroAGR
    # tanto no 404 quanto na página sem item, e a listagem do ano novo só passa
    # a existir depois da primeira sessão publicada — em 02/01 ela ainda não
    # está lá. Fora do try, esse erro abortava a rodada inteira e as pautas
    # pendentes do ano anterior nunca chegavam a ser processadas. A falha vira
    # erro do resumo: o job termina vermelho, mas depois de fazer o que dava.
    todas, falhas = [], []
    for a in anos:
        fonte = col['listagem'].format(ano=a)
        try:
            todas += agr.listar_pautas(a, col['comissao'], col['listagem'])
        except agr.ErroAGR as e:
            log.error('%s: %s', fonte, e)
            falhas.append({'url': fonte, 'ano': a, 'erro': f'{type(e).__name__}: {e}'})

    pendentes = [p for p in todas
                 if p.url not in ja_vistas and corte < p.data_sessao <= hoje]
    return (todas, sorted(pendentes, key=lambda p: (p.data_sessao, p.numero)),
            corte, anos, falhas)


def processar_pauta(cur, col, p):
    """Processa um documento. Devolve o resumo dele."""
    pdf, sha256 = agr.baixar_pdf(p)
    texto = pauta.extrair_texto(pdf)

    no_pdf = pauta.data_no_pdf(texto)
    if no_pdf and no_pdf != p.data_sessao:
        log.warning('%s: listagem diz %s e o PDF diz %s — vale a listagem',
                    p.url, p.data_sessao, no_pdf)

    ignorados = pauta.numeros_sem_rotulo(texto)
    if ignorados:
        log.warning('%s: %d número(s) de 15 dígitos sem o rótulo "Processo nº" '
                    '— confira se o formato da AGR mudou: %s', p.url, len(ignorados), ignorados)

    # Documento sem processo não é erro: o Conselho Regulador convoca sessão
    # especial, e a de 03/07/2026 não levou nenhum. Registrar com zero deixa a
    # sessão marcada como vista, em vez de rebaixá-la a falha em toda execução.
    # PDF quebrado continua caindo antes disto, em extrair_texto.
    #
    # O que separa a sessão vazia da AGR ter mudado o formato é numeros_sem_rotulo,
    # que já desconta o rodapé `Referência: Processo nº …`: sessão sem processo
    # não tem número de 15 dígitos nenhum. Zero processos COM números soltos é
    # parser quebrado, e registrar aí marcaria a URL como vista para sempre —
    # a sessão se perderia em silêncio, com o job terminando verde, e voltar
    # atrás depois exigiria apagar a linha de pautas_* à mão.
    processos = pauta.extrair_processos(texto)
    if not processos and ignorados:
        raise pauta.ErroPauta(
            f'nenhum processo extraído, mas {len(ignorados)} número(s) de 15 '
            f'dígitos no documento — o formato da AGR mudou: {ignorados}')
    if not processos:
        log.warning('%s: nenhum processo no documento — registrado como sessão '
                    'sem processos', p.url)

    importados, sem_acervo = (gravar_julgados(cur, col, p, processos)
                              if processos else (0, []))
    registrar_pauta(cur, col, p, sha256, len(processos), importados, sem_acervo)

    log.info('%sª reunião (%s): %d processos, %d importados, %d já gravados, %d fora do acervo',
             p.numero, p.data_sessao.strftime('%d/%m/%Y'), len(processos),
             importados, len(processos) - importados, len(sem_acervo))

    return {
        'url': p.url,
        'numero': p.numero,
        'data_sessao': p.data_sessao.isoformat(),
        'sha256': sha256,
        'processos_encontrados': len(processos),
        'processos_importados': importados,
        'processos_duplicados': len(processos) - importados,
        'processos_sem_acervo': sem_acervo,
        'numeros_sem_rotulo': ignorados,
    }


def sincronizar(conn, colegiado='CJ', ano=None, desde=None, hoje=None, simular=False):
    """Roda a sincronização inteira e devolve o resumo da operação."""
    col = COLEGIADOS[colegiado]
    hoje = hoje or date.today()
    ano_resumo = ano or hoje.year
    resumo = {
        'colegiado': colegiado,
        'ano': ano_resumo,
        'fonte': col['listagem'].format(ano=ano_resumo),
        'anos_consultados': [],
        'fontes': [],
        'simulacao': simular,
        'documentos_encontrados': 0,
        'documentos_novos': 0,
        'documentos_processados': 0,
        'processos_encontrados': 0,
        'processos_importados': 0,
        'processos_duplicados': 0,
        'processos_sem_acervo': [],
        'documentos': [],
        'erros': [],
    }

    with conn.cursor() as cur:
        ultima = ultima_sessao(cur, col)
        todas, pendentes, corte, anos, falhas = pautas_pendentes(
            cur, col, ano, desde, hoje)
        resumo['ultima_sessao_conhecida'] = ultima.isoformat()
        resumo['data_de_corte'] = corte.isoformat()
        resumo['anos_consultados'] = anos
        resumo['fontes'] = [col['listagem'].format(ano=a) for a in anos]
        resumo['documentos_encontrados'] = len(todas)
        resumo['documentos_novos'] = len(pendentes)

    for p in pendentes:
        # Cada documento tem a sua transação: um PDF com problema não desfaz o
        # que já entrou nem impede o processamento dos outros.
        try:
            with conn.cursor() as cur:
                doc = processar_pauta(cur, col, p)
            conn.rollback() if simular else conn.commit()
            resumo['documentos'].append(doc)
            resumo['documentos_processados'] += 1
            resumo['processos_encontrados'] += doc['processos_encontrados']
            resumo['processos_importados'] += doc['processos_importados']
            resumo['processos_duplicados'] += doc['processos_duplicados']
            resumo['processos_sem_acervo'] += doc['processos_sem_acervo']
        except Exception as e:
            conn.rollback()
            log.error('%s: %s: %s', p.url, type(e).__name__, e)
            resumo['erros'].append({
                'url': p.url,
                'numero': p.numero,
                'data_sessao': p.data_sessao.isoformat(),
                'erro': f'{type(e).__name__}: {e}',
            })

    resumo['documentos_com_erro'] = len(resumo['erros'])
    # Listagem que não abriu entra depois da contagem: ela não é documento, mas
    # é erro — e é o que faz o job terminar vermelho em vez de fingir que o ano
    # não tinha pauta nenhuma.
    resumo['erros'] += falhas
    resumo['processos_sem_acervo'] = sorted(set(resumo['processos_sem_acervo']))
    return resumo


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--dsn', default=os.environ.get('SUPABASE_DB_URL'),
                   help='conexão do Postgres (padrão: variável SUPABASE_DB_URL)')
    p.add_argument('--colegiado', choices=sorted(COLEGIADOS), default='CJ',
                   help='qual colegiado sincronizar (padrão: CJ)')
    p.add_argument('--ano', type=int,
                   help='limita a consulta a um ano (padrão: do marco ao ano corrente)')
    p.add_argument('--desde', type=lambda s: datetime.strptime(s, '%Y-%m-%d').date(),
                   help='reprocessa sessões depois desta data (AAAA-MM-DD), '
                        'no lugar do marco automático')
    p.add_argument('--simular', action='store_true',
                   help='faz tudo e desfaz no fim: nada é gravado')
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')

    if not args.dsn:
        p.error('informe --dsn ou defina SUPABASE_DB_URL')

    with psycopg2.connect(args.dsn) as conn:
        resumo = sincronizar(conn, colegiado=args.colegiado, ano=args.ano,
                             desde=args.desde, simular=args.simular)

    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    return 1 if resumo['erros'] else 0


if __name__ == '__main__':
    sys.exit(main())
