#!/usr/bin/env python3
"""Sincroniza julgados_cj com as pautas publicadas pela AGR.

    python sincronizacao/sincronizar.py --dsn "postgresql://…"
    python sincronizacao/sincronizar.py --simular          # não grava nada

O DSN também pode vir da variável de ambiente SUPABASE_DB_URL.

Fluxo:

    listagem da AGR → pautas ainda não processadas → baixa o PDF
      → extrai o texto → descarta o rodapé `Referência: Processo nº …`
      → extrai e normaliza os processos → insere em julgados_cj
      → o gatilho do banco busca cada processo em acervo_cj e preenche
        relator, defesa e data de distribuição
      → registra o documento em pautas_cj

Quais pautas entram: as da comissão certa, com sessão já realizada, ainda não
registradas em pautas_cj e posteriores à última sessão que o banco conhece. As
duas últimas condições se cobrem — uma barra o mesmo documento, a outra barra o
período que veio da planilha.

Nada aqui reimplementa a regra Acervo → Julgados: quem preenche os campos
derivados é o gatilho julgados_cj_derivar_do_acervo, em schema.sql.
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


# ── Banco ────────────────────────────────────────────────────────────────────

def ultima_sessao(cur):
    """A sessão mais recente que o banco já conhece, por qualquer caminho."""
    cur.execute("""
        select greatest(
                 coalesce((select max(data_sessao) from public.julgados_cj), date '1900-01-01'),
                 coalesce((select max(data_sessao) from public.pautas_cj),   date '1900-01-01'))
    """)
    return cur.fetchone()[0]


def urls_processadas(cur):
    cur.execute('select url from public.pautas_cj')
    return {u for (u,) in cur.fetchall()}


def gravar_julgados(cur, p, processos):
    """Insere os processos da pauta e devolve (importados, sem_acervo).

    Um único INSERT para o documento inteiro: o gatilho resolve o acervo linha a
    linha usando o índice de acervo_cj, sem consulta extra da aplicação. O
    RETURNING só traz as linhas realmente inseridas, então o que faltar são os
    processos que já estavam gravados naquela sessão.
    """
    inseridos = psycopg2.extras.execute_values(
        cur,
        """insert into public.julgados_cj (num_processo, data_sessao, pauta) values %s
           on conflict on constraint julgados_cj_sessao_unica do nothing
           returning num_processo, acervo_id""",
        [(n, p.data_sessao, p.numero) for n in processos],
        fetch=True)

    sem_acervo = sorted(num for num, acervo_id in inseridos if acervo_id is None)
    return len(inseridos), sem_acervo


def registrar_pauta(cur, p, sha256, encontrados, importados, sem_acervo):
    cur.execute("""
        insert into public.pautas_cj
          (url, titulo, numero, data_sessao, sha256,
           processos_encontrados, processos_importados, processos_sem_acervo)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (url) do nothing
    """, (p.url, p.titulo, p.numero, p.data_sessao, sha256,
          encontrados, importados, sem_acervo))


# ── Orquestração ─────────────────────────────────────────────────────────────

def pautas_pendentes(cur, ano, desde=None, hoje=None):
    """(todas as pautas do ano, as que faltam processar, a data de corte)."""
    hoje = hoje or date.today()
    corte = desde or ultima_sessao(cur)
    ja_vistas = urls_processadas(cur)

    todas = agr.listar_pautas(ano)
    pendentes = [p for p in todas
                 if p.url not in ja_vistas and corte < p.data_sessao <= hoje]
    return todas, sorted(pendentes, key=lambda p: (p.data_sessao, p.numero)), corte


def processar_pauta(cur, p):
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

    processos = pauta.extrair_processos(texto)
    if not processos:
        raise pauta.ErroPauta('nenhum processo encontrado no documento')

    importados, sem_acervo = gravar_julgados(cur, p, processos)
    registrar_pauta(cur, p, sha256, len(processos), importados, sem_acervo)

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


def sincronizar(conn, ano=None, desde=None, hoje=None, simular=False):
    """Roda a sincronização inteira e devolve o resumo da operação."""
    ano = ano or (hoje or date.today()).year
    resumo = {
        'ano': ano,
        'fonte': agr.LISTAGEM.format(ano=ano),
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
        todas, pendentes, corte = pautas_pendentes(cur, ano, desde, hoje)
        resumo['ultima_sessao_conhecida'] = corte.isoformat()
        resumo['documentos_encontrados'] = len(todas)
        resumo['documentos_novos'] = len(pendentes)

    for p in pendentes:
        # Cada documento tem a sua transação: um PDF com problema não desfaz o
        # que já entrou nem impede o processamento dos outros.
        try:
            with conn.cursor() as cur:
                doc = processar_pauta(cur, p)
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
    resumo['processos_sem_acervo'] = sorted(set(resumo['processos_sem_acervo']))
    return resumo


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--dsn', default=os.environ.get('SUPABASE_DB_URL'),
                   help='conexão do Postgres (padrão: variável SUPABASE_DB_URL)')
    p.add_argument('--ano', type=int, help='ano da listagem (padrão: ano corrente)')
    p.add_argument('--desde', type=lambda s: datetime.strptime(s, '%Y-%m-%d').date(),
                   help='reprocessa sessões depois desta data (AAAA-MM-DD), '
                        'ignorando a última sessão do banco')
    p.add_argument('--simular', action='store_true',
                   help='faz tudo e desfaz no fim: nada é gravado')
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')

    if not args.dsn:
        p.error('informe --dsn ou defina SUPABASE_DB_URL')

    with psycopg2.connect(args.dsn) as conn:
        resumo = sincronizar(conn, ano=args.ano, desde=args.desde, simular=args.simular)

    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    return 1 if resumo['erros'] else 0


if __name__ == '__main__':
    sys.exit(main())
