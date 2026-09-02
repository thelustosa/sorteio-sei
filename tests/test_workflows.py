#!/usr/bin/env python3
"""Testes do workflow de sincronização das pautas da AGR.

    python tests/test_workflows.py

O que a sincronização faz está coberto em test_sincronizacao.py; o que está
aqui é o contrato do agendamento, que nenhum outro teste alcança: um único
workflow para os dois colegiados, rodando várias vezes por dia, com disparo
manual preservado e falha de um colegiado visível no log da Action.

Sem dependência externa: o arquivo é lido como texto. O YAML do GitHub tem
sintaxe própria (`on:` vira booleano em qualquer parser genérico) e o projeto
não carrega um parser só para isto.
"""

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
WORKFLOWS = RAIZ / '.github' / 'workflows'
SINCRONIZACAO = WORKFLOWS / 'sincronizar-julgados.yml'

testes = []


def teste(fn):
    testes.append(fn)
    return fn


def texto():
    return SINCRONIZACAO.read_text(encoding='utf-8')


# ── Frequência ───────────────────────────────────────────────────────────────

def _campo(expressao, minimo, maximo):
    """Quantos valores um campo do cron cobre na faixa dele."""
    valores = set()
    for parte in expressao.split(','):
        passo = 1
        if '/' in parte:
            parte, texto_passo = parte.split('/', 1)
            passo = int(texto_passo)
        if parte == '*':
            inicio, fim = minimo, maximo
        elif '-' in parte:
            inicio, fim = (int(n) for n in parte.split('-', 1))
        else:
            inicio = fim = int(parte)
        valores |= set(range(inicio, fim + 1, passo))
    return valores


def execucoes_por_semana(cron):
    """Estimativa de quantas vezes por semana um cron dispara.

    Só precisa distinguir "uma vez por semana" de "várias vezes por dia", então
    trata dia-do-mês e mês como o cron do GitHub costuma trazer: `*`.
    """
    minuto, hora, dia, mes, semana = cron.split()
    assert dia == '*' and mes == '*', f'cron com dia/mês fixo não previsto: {cron}'
    dias = len(_campo(semana, 0, 6))
    return len(_campo(minuto, 0, 59)) * len(_campo(hora, 0, 23)) * dias


def crons():
    return re.findall(r"^\s*-\s*cron:\s*'([^']+)'", texto(), re.MULTILINE)


@teste
def busca_varias_vezes_por_dia():
    agendamentos = crons()
    assert agendamentos, 'workflow sem agendamento automático'
    por_semana = sum(execucoes_por_semana(c) for c in agendamentos)
    # A rodada semanal antiga fazia 1; qualquer coisa abaixo de duas por dia
    # não é "buscar com mais frequência", é o mesmo atraso com outro horário.
    assert por_semana >= 14, f'apenas {por_semana} execuções por semana: {agendamentos}'


# ── Unificação ───────────────────────────────────────────────────────────────

@teste
def um_unico_workflow_sincroniza():
    donos = sorted(a.name for a in WORKFLOWS.glob('*.y*ml')
                   if 'sincronizacao/sincronizar.py' in a.read_text(encoding='utf-8'))
    assert donos == [SINCRONIZACAO.name], f'sincronização espalhada em {donos}'


@teste
def uma_execucao_cobre_os_dois_colegiados():
    conteudo = texto()
    # O laço com os dois colegiados é o que garante a passagem única; se um dia
    # virar matriz ou dois jobs, este teste pede a revisão do contrato.
    assert re.search(r"alvos='CJ CREG'", conteudo), 'padrão não cobre CJ e CREG'
    assert '--colegiado "$colegiado"' in conteudo, 'colegiado não chega ao script'


@teste
def disparo_manual_continua_disponivel():
    conteudo = texto()
    assert re.search(r'^\s*workflow_dispatch:', conteudo, re.MULTILINE), \
        'sem workflow_dispatch: a execução manual sumiu'
    for entrada in ('colegiado', 'simular', 'ano', 'desde'):
        assert re.search(rf'^\s+{entrada}:', conteudo, re.MULTILINE), \
            f'entrada manual "{entrada}" perdida'


# ── Falhas visíveis ──────────────────────────────────────────────────────────

@teste
def falha_de_um_colegiado_aparece_no_log():
    conteudo = texto()
    assert '::error' in conteudo, 'falha de colegiado não vira anotação de erro'
    # Sair com o código do laço é o que faz o job terminar vermelho; sem isto a
    # anotação existiria e a Action passaria mesmo assim.
    assert re.search(r'^\s*exit "?\$falhou"?', conteudo, re.MULTILINE), \
        'o job não propaga a falha do laço'


@teste
def um_colegiado_nao_derruba_o_outro():
    conteudo = texto()
    assert 'falhou=1' in conteudo, 'a falha de um colegiado interrompe o laço'


def main():
    falhas = 0
    for fn in testes:
        try:
            fn()
            print(f'ok    {fn.__name__}')
        except Exception as e:
            falhas += 1
            print(f'FALHA {fn.__name__}: {type(e).__name__}: {e}')
    print(f'\n{len(testes) - falhas}/{len(testes)} testes passaram.')
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
