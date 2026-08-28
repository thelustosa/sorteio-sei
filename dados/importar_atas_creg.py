#!/usr/bin/env python3
"""Converte as atas de sorteio do Conselho Regulador em SQL de importação.

    python dados/importar_atas_creg.py ~/Downloads/SEI_*_Ata_*.pdf
    python dados/importar_atas_creg.py "C:/pasta/com/as/atas"

Gera dados/acervo_creg_atas.sql, para rodar no SQL Editor do Supabase depois de
acervo_creg.sql. É idempotente (ON CONFLICT DO NOTHING): distribuição que a
planilha de gabinete já trouxe não entra de novo, e rodar duas vezes não duplica.

Para que serve: a ata publicada no SEI é o registro oficial do sorteio, e chega
antes de a planilha de gabinete ser atualizada. Enquanto o Conselho sortear fora
do sistema, é por aqui que o acervo fica em dia — sem ela, um processo aparece
na pauta da AGR e o julgado entra sem saber de quem é.

O que a ata tem e a planilha não: nada. O que a planilha tem e a ata não:
ASSUNTO e RECURSO, que a ata não registra. As duas colunas ficam nulas, e o
gatilho de julgados_creg não as inventa.

O interessado não é importado. É nome de pessoa física ou jurídica num registro
que ninguém consulta, e o repositório é público — mesma decisão de 20/08/2026
que tirou a coluna das outras tabelas.
"""

import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'sincronizacao'))
from importar_creg import gerar_sql  # noqa: E402
import pauta  # noqa: E402

# O corpo da ata é a tabela `Ordem | Nº Processo | Interessado | Unidade`, e o
# pypdf entrega uma célula por linha. Daí a leitura ser uma máquina de estados de
# duas regras, e não um regex de proximidade entre o processo e o CREGn:
#
#     linha que é EXATAMENTE 15 dígitos  -> guarda o processo
#     linha que é EXATAMENTE CREGn       -> fecha o par com o processo guardado
#
# Isso descarta sozinho tudo o que polui o texto — `SEI 202600029000084 / pg. 1`,
# o rodapé `Referência: Processo nº …`, o código verificador de 8 dígitos, os
# blocos de assinatura que o SEI intercala no meio da tabela — porque em nenhum
# deles o número aparece sozinho numa linha. E processo sem unidade logo a
# seguir vira aviso, em vez de ser colado à unidade errada.
ORDEM = re.compile(r'^(\d{1,3})$')
PROCESSO = re.compile(r'^(\d{15})$')
UNIDADE = re.compile(r'^(CREG[1-9][0-9]*)$')

NUMERO_ATA = re.compile(r'ATA\s*N?[º°ᵒo]?\s*(\d{1,3})\s*/', re.IGNORECASE)
DATA = re.compile(r'Aos?\s+(\d{1,2})\s+dias?\s+do\s+m[êe]s\s+de\s+(\w+)\s+de\s+(\d{4})',
                  re.IGNORECASE)
MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
         'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']


class ErroAta(Exception):
    """Ata fora do formato esperado, ou de outro colegiado."""


def ler_ata(caminho):
    """(número, data, distribuições, processos sem unidade) de um PDF de ata."""
    return distribuicoes(pauta.extrair_texto(Path(caminho).read_bytes()))


def distribuicoes(texto):
    """O mesmo, a partir do texto já extraído — é aqui que os testes entram."""
    # A Câmara de Julgamento publica atas com layout quase igual, e o sorteio
    # dela vai para outra tabela. Recusar é melhor do que importar no lugar
    # errado.
    if 'CONSELHO REGULADOR' not in texto.upper():
        raise ErroAta('não é ata do Conselho Regulador')

    m = DATA.search(texto)
    if not m:
        raise ErroAta('data da distribuição não encontrada')
    mes = m.group(2).lower()
    if mes not in MESES:
        raise ErroAta(f'mês desconhecido: {mes!r}')
    quando = date(int(m.group(3)), MESES.index(mes) + 1, int(m.group(1)))

    numero = NUMERO_ATA.search(texto)
    numero = int(numero.group(1)) if numero else None

    linhas, ordem, pendente, orfaos = [], None, None, []
    for bruta in texto.splitlines():
        s = bruta.strip()
        if PROCESSO.match(s):
            if pendente:
                orfaos.append(pendente)
            pendente = s
        elif UNIDADE.match(s) and pendente:
            linhas.append({
                'num_processo': pendente,
                'unidade': s,
                'data_distribuicao': quando,
                'assunto': None,
                'recurso': None,
                'ordem': ordem,
                'origem': 'ata',
            })
            pendente, ordem = None, None
        elif ORDEM.match(s):
            # A ordem vem imediatamente antes do processo, na mesma linha da
            # tabela. Guardada aqui, consumida quando o par fecha.
            ordem = int(s)
    if pendente:
        orfaos.append(pendente)

    if not linhas:
        raise ErroAta('nenhuma distribuição encontrada')
    return numero, quando, linhas, orfaos


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2

    alvos = [Path(a) for a in argv[1:]]
    if len(alvos) == 1 and alvos[0].is_dir():
        alvos = sorted(alvos[0].glob('*.pdf'))
    if not alvos:
        print('Nenhuma ata encontrada.')
        return 1

    todas, problemas = [], 0
    for caminho in alvos:
        try:
            numero, quando, linhas, orfaos = ler_ata(caminho)
        except (ErroAta, pauta.ErroPauta) as e:
            print(f'PULA  {caminho.name}: {e}')
            problemas += 1
            continue
        aviso = f'  ATENÇÃO: {len(orfaos)} processo(s) sem unidade: {orfaos}' if orfaos else ''
        print(f'Ata {numero!s:>4}  {quando}  {len(linhas):3d} distribuições{aviso}')
        todas += linhas
        problemas += bool(orfaos)

    # A mesma distribuição pode constar de duas atas (retificação); o índice
    # único do banco já barraria, mas descartar aqui deixa a contagem honesta.
    vistas, unicas = set(), []
    for l in todas:
        k = (l['num_processo'], l['data_distribuicao'], l['unidade'])
        if k not in vistas:
            vistas.add(k)
            unicas.append(l)

    saida = Path(__file__).resolve().parent / 'acervo_creg_atas.sql'
    saida.write_text(gerar_sql(
        'acervo_creg',
        ['num_processo', 'unidade', 'data_distribuicao', 'assunto', 'recurso',
         'ordem', 'origem'],
        unicas, 'acervo_creg_distribuicao_unica',
        f'Acervo do Conselho Regulador — {len(unicas)} distribuições '
        f'de {len(alvos) - problemas} ata(s) de sorteio.',
    ), encoding='utf-8')

    print(f'\n{saida.name}  {len(unicas)} linhas '
          f'({len(todas) - len(unicas)} repetidas entre atas)')
    print('Rode depois de acervo_creg.sql. Distribuição que a planilha já trouxe '
          'não entra de novo.')
    return 1 if problemas else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
