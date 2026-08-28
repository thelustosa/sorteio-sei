# Conselho Regulador — fluxo completo

O CREG tem hoje o mesmo desenho da Câmara de Julgamento: sorteio grava no
acervo, pauta da AGR vira julgado, gatilho preenche o que a planilha resolvia
com fórmula, secretaria registra voto e status.

Este documento cobre **o que é do CREG**. Tudo que é igual nos dois colegiados —
por que a pauta é convocação e não decisão, como um processo é identificado no
PDF, a regra do rodapé `Referência: Processo nº …`, idempotência, tratamento de
falhas — está em **[FLUXO-CJ.md](FLUXO-CJ.md)** e não se repete aqui.

---

## 1. O que muda em relação à Câmara

| | Câmara de Julgamento | Conselho Regulador |
|---|---|---|
| tabelas | `acervo_cj` · `julgados_cj` · `pautas_cj` | `acervo_creg` · `julgados_creg` · `pautas_creg` |
| de-para de nomes | `cadeiras_cj` traduz CJ1..CJ5 | **não existe**, por decisão das unidades |
| quem recebe | `relator`, cadeira `CJ1`..`CJ5` | `unidade`, gabinete `CREG1`..`CREG4` |
| coluna de decisão | `defesa` (booleana: houve defesa?) | `recurso` (texto: Com recurso, Sem recurso, Não se aplica, Ad Referendum, Reexame Necessário) |
| interessado | saiu em 20/08/2026 | **voltou em 27/08/2026**, digitado na tela do sorteio |
| assunto | só Auto de Infração | 12 tipos (Requerimento, Chamamento Público, Gratuidade, Quadro de Horários…) |
| votos | Manter, Anular, Vista | Manter, Anular, Aprovação, Indeferimento, Extinção, Retirado, Vista |
| status | Julgado, Retornou, Retirado, Vista | Julgado, Retirado, Vista, Sobrestado, Prejudicado |
| página da AGR | `pautas-das-reunioes-{ano}` | `pautas-das-sessoes-do-conselho-regulador-{ano}` |
| colunas calculadas | `dias_dt`, `periodo_dt` | `dias_dt`, `periodo_dt`, **`meta_45`**, **`dias_dist_cr_cj`**, **`em_relacao_cj`** |

As três últimas são o que o Conselho acompanha e a Câmara não: se o processo
chegou à mesa dentro de 45 dias, quanto tempo levou entre sair da CJ e ser
distribuído no CREG, e se o Conselho decidiu diferente da Câmara.

---

## 2. De onde vieram os dados

Seis planilhas, com dois papéis.

**O acervo** eram quatro arquivos, um por gabinete:

```text
CREG1.xlsx │ Gabinete · Nº Processo · Interessado · Assunto · Data Distribuição · Recurso · Status
CREG2.xlsx │
CREG3.xlsx │  3.161 linhas → 3.064 distribuições únicas → 3.024 processos
CREG4.xlsx │  (com as atas de sorteio: 3.100 e 3.059)
```

**Os julgados** eram abas "Página" de duas pastas de trabalho:

```text
Conselho Regulador.xlsx         Página 2023   05/01/2023 → 28/12/2023    668
                                Página 2024   04/01/2024 → 27/12/2024  1.384
                                Página 2025   09/01/2025 → 29/05/2025    620
Conselho Regulador 2025.2.xlsx  Página 2025.2 04/06/2025 → 17/07/2026  1.953
                                                             total    4.564
```

As mesmas pastas guardavam cópias das abas `Acervo` e `Julgados` da **Câmara**,
que só existiam para alimentar `VLOOKUP` — não são fonte de nada aqui.

E uma terceira fonte, que não é planilha: as **atas de sorteio** publicadas no
SEI. São o registro oficial da distribuição e chegam antes de a planilha de
gabinete ser atualizada. `dados/importar_atas_creg.py` lê o PDF; a coluna
`origem` distingue as três procedências (`planilha`, `ata`, `sorteio`).

O que a ata tem e a planilha não: nada. O que a planilha tem e a ata não:
**assunto e recurso**, que a ata não registra — ficam nulos, e o gatilho de
`julgados_creg` não os inventa.

### O que cada coluna era

As 29 colunas da aba Página se dividem em três naturezas.

**Digitado na sessão** (4): `Pauta`, `DT Sessão CR`, `Status`, `Voto CR`.

**Buscado no acervo** (4) — o `INDEX/MATCH` em cascata `[2]→[3]→[4]→[5]`, que
literalmente significava "procure o processo no CREG1, depois no CREG2…":

```excel
Assunto      =IFERROR(INDEX([2]Planilha1!D:D; MATCH(A2; [2]Planilha1!B:B; 0)); …)
DT DIST CR   =IFERROR(INDEX([2]Planilha1!E:E; MATCH(A2; [2]Planilha1!B:B; 0)); …)
Recurso      "Com recurso"→Sim, "Sem recurso"→Não, senão "n/a"
Unidade CREG =SE(achou em [2];1; SE(achou em [3];2; SE(achou em [4];3; 4)))
```

A unidade era descoberta **por acidente de arquivo**. No banco ela é dado: a
coluna `unidade` de `acervo_creg`.

**Buscado na planilha da Câmara** (4): `Defesa`, `DT DIST CJ`, `Relator CJ`,
`Voto CJ` — preenchidos em 3.398 das 4.624 linhas (73%).

**Calculado** (5):

| coluna | fórmula | virou |
|---|---|---|
| `DIAS DIST CR/CJ` | `=-M+Q` | `dias_dist_cr_cj` |
| `DIAS DIST SS/CR` | `=-Q+T` | `dias_dt` |
| `META 45` | `=SE(Z<=45;"DENTRO";"FORA")` | `meta_45` |
| `Per DT CR` | `IF` aninhado ano a ano | `periodo_dt` |
| `Em relação à CJ` | `SE(Voto CJ<>Voto CR; SE(Voto CJ="Anular";"Divergente-Não Revel";"Divergente");"")`, zerada em Retirado / n/a / Aprovação / Indeferir / Arquivamento | `em_relacao_cj` |

O `Per DT CR` merece nota: a fórmula era um `IF` que terminava em `"4T25"` e
precisou ser estendida à mão quando 2026 chegou. A coluna gerada calcula o
trimestre, e 2027 já funciona sozinha.

### O que a importação normaliza

`dados/importar_creg.py` lê os **valores** calculados, não as fórmulas, e mexe
no mínimo:

- **grafia do voto** — o histórico tinha 23 formas de escrever 7 decisões:
  `Aprovação`/`Aprovado`/`Apovação`, `Indeferir`/`Indeferimento`,
  `Extinto`/`Extinção`. As equivalentes viram a forma do Conselho. As 13 linhas
  cujo rótulo não tem equivalente (`Parcialmente Deferido`, `Suspender`,
  `Improvimento`…) **passam intactas**, só com a caixa arrumada — colapsá-las num
  vizinho seria reescrever a decisão;
- **caixa do assunto** — `AUTO DE INFRAÇÃO` e `Auto de Infração` eram duas
  categorias em qualquer relatório; viram uma. Assunto fora da lista canônica
  passa como veio;
- **`n/a` vira nulo** — era o que a fórmula escrevia quando não achava nada;
- **`VISTA` e `PC (VISTA)` na coluna da unidade** (15 linhas de 2024) viram
  nulo, e o gatilho deriva a unidade do acervo, que é onde o dado está;
- **duplicatas exatas** — 92 no acervo e 60 nos julgados, quase todas variando
  só a caixa do assunto ou o nome do interessado.

O **interessado não é importado**, embora a coluna exista. Ele voltou para o
Conselho em 27/08/2026 e é preenchido **só pelo sorteio**, digitado na tela: a
secretaria o usa para reconhecer o processo na ata. No histórico das planilhas
é nome de pessoa física em volume, e este repositório é público — importá-lo
seria trocar de decisão sem ninguém ter pedido.

Consequência: `interessado` fica nulo em tudo que veio de planilha ou de ata, e
preenchido apenas nos sorteios feitos pelo sistema.

---

## 3. Acervo → julgados

A regra é a da Câmara, e resolve um defeito da planilha. O `INDEX/MATCH` pegava
a **primeira** ocorrência do processo na ordem dos arquivos; quando o processo
fora redistribuído, isso podia apontar para o gabinete errado.

O gatilho `julgados_creg_derivar_do_acervo` resolve assim:

1. `data_distribuicao` informada → **somente** o registro exato; sem
   correspondência, o julgado fica sem vínculo em vez de apontar para outra data;
2. sem data informada → a **última distribuição ocorrida até a data da sessão** —
   quem de fato levou o processo à mesa;
3. ainda sem resultado → a distribuição mais antiga.

Dali saem `unidade`, `assunto`, `recurso` e `data_distribuicao`, como **cópia**:
uma redistribuição posterior muda o acervo e não reescreve um julgamento que já
aconteceu. Valor informado sempre vence o derivado; gravar `null` num campo pede
a rederivação.

**Processo fora do acervo não é erro.** São 1.397 no histórico — julgados entre
janeiro de 2023 e o momento em que as planilhas de gabinete passaram a existir
(a mais antiga começa em agosto de 2023).

Nesses, **só `acervo_id` fica nulo**. `unidade` e `data_distribuicao` vieram da
própria aba Página, que os calculava por conta própria, e por isso `dias_dt`,
`meta_45` e `periodo_dt` continuam preenchidos: 1.437 dos 1.444 sem vínculo
têm unidade, e todos entram nos indicadores de prazo. Quem os tratar como fora
do relatório de META 45 subestima o numerador em 329 registros.

Outros **47** ficam sem vínculo por um motivo diferente: o processo existe no
acervo, mas em outra data. A distribuição que a aba Página registrou não
sobreviveu nas planilhas de gabinete — o processo foi redistribuído depois e a
linha antiga sumiu. A regra 1 recusa apontá-los para a distribuição errada, e
`sql/rederivar_creg.sql` os religa se aquelas distribuições voltarem.

### A decisão da Câmara é cópia, não join

`defesa`, `data_dist_cj`, `relator_cj` e `voto_cj` são gravados na importação,
vindos das colunas da planilha — não lidos de `julgados_cj`.

O motivo: a produção da Câmara começa em **junho de 2026**, porque a série dela
foi reiniciada e o histórico anterior está no schema `backup_cj`. Um join
cobriria só os julgados recentes do CREG e deixaria 2023–2025 vazio, que é
justamente o período em que a planilha tinha o dado.

---

## 4. Sincronização com as pautas da AGR

O parser de `sincronizacao/pauta.py` roda no CREG **sem uma linha alterada**.
Conferido em 141 pautas de 2023 a 2026: todas com URL distinta, nenhum número de
15 dígitos sem o rótulo `Processo nº`, e a `Data:` do PDF batendo com a da
listagem. Três diferenças exigiram ajuste em `agr.py` e `sincronizar.py`:

**A página é outra.** `pautas-das-sessoes-do-conselho-regulador-{ano}` em vez de
`pautas-das-reunioes-{ano}`. O endereço sai de `COLEGIADOS`, em
`sincronizacao/sincronizar.py`, e nunca da linha de comando.

**Não há filtro por comissão.** Os títulos do Conselho são `Pauta da 015ª Sessão
Ordinária` — sem o nome do colegiado. Como a página inteira já é dele,
`comissao=None` aceita todo item; filtrar devolveria zero.

**Sessão sem processo existe.** A 1ª Sessão Especial de 03/07/2026 não levou
nenhum. Antes isso virava `ErroPauta` e a pauta voltava à fila em toda execução;
agora é registrada com zero. PDF quebrado continua caindo antes disso, em
`extrair_texto`, e mudança de formato continua sendo sinalizada por
`numeros_sem_rotulo`.

### O número da pauta não é chave — e aqui é pior

Na Câmara, a numeração interna diverge da numeração da AGR até 2025. No
Conselho, **121 das 132 sessões conferidas têm número diferente** entre a
planilha e o site: a planilha conta pautas emitidas, a AGR conta sessões
realizadas, e a distância cresce ao longo do ano (em 07/06/2023 a planilha já
dizia 18 e o site dizia 12).

Para agrupar sessões, use `data_sessao`. `pauta` é referência interna, e muda de
significado conforme a origem da linha.

### O marco

`pautas_creg` nasce com uma linha que não é documento — `url =
'marco:inicio-da-serie'`, data **30/06/2026** — e ela diz à sincronização a
partir de quando começar. Relatórios que contam documentos devem filtrar por
`url like 'https://%'`.

30/06 é o corte porque o histórico das planilhas termina em 17/07/2026 e a AGR
publicou três sessões que ele não alcança: a 1ª Especial (03/07, sem processos),
a 14ª (05/08) e a 15ª (19/08). Voltar até 30/06 cobre as três e ainda reconcilia
a de 17/07 — reprocessar sessão já importada não duplica nada, e a passagem
grava em `pautas_creg` o número que a AGR usa.

### Como rodar

O job do GitHub Actions sincroniza os **dois** colegiados na mesma rodada, um de
cada vez. A Câmara reúne às quintas; o Conselho não tem dia fixo (em 2026 houve
sessão em quarta, quinta e sexta), então a rodada semanal de sexta cobre a
semana inteira dos dois.

```bash
python sincronizacao/sincronizar.py --colegiado CREG --simular --dsn "postgresql://…"
```

---

## 5. Painel e registro do voto

O painel é **[acervo-creg.html](acervo-creg.html)**, e não é um arquivo novo de
JavaScript: `assets/js/acervo.js` serve os dois colegiados, e quem escolhe o par
de funções do banco é o `data-colegiado` do `<body>`. Duplicá-lo custaria 39 KB
de exportação de Excel e PDF mantidos em dobro.

O Conselho troca duas coisas na tela: a coluna do detalhe mostra a **unidade**
sem hover de nome, e no lugar do conselheiro entra o **assunto** — que nele
distingue de verdade, com 12 tipos contra o auto de infração único da Câmara.

`resumo_acervo_creg()` e `processos_acervo_creg(ordem, unidade)` são o espelho
das funções da Câmara, com as **mesmas oito faixas de tempo** — quem lê os dois
painéis compara sem traduzir — e a mesma definição de pendente: processo do
acervo que não aparece em `julgados_creg`, contado uma vez só, na unidade e na
data da distribuição mais recente.

**Não há de-para de unidades no Conselho.** A Câmara tem `cadeiras_cj`, que
traduz CJ1..CJ5 no nome do conselheiro e aparece no hover do painel. Aqui não:
os responsáveis por CREG1..CREG4 pediram para não ter os nomes vinculados aos
processos, e em 27/08/2026 a tabela `cadeiras_creg` foi removida junto com a
coluna `conselheiro` das duas RPCs — que, sem o de-para, seria só uma cópia de
`unidade`.

O painel do CREG mostra `CREG1`..`CREG4` e nada além disso. Há um teste que
falha se a coluna voltar: reintroduzir um de-para aqui é decisão das unidades,
não de uma migração.

`registrar_votos_creg(itens jsonb)` é a única porta de escrita de voto e status:
recusa rótulo fora da lista, anota quem preencheu, e não encosta no histórico da
planilha — linha que já veio com voto e status é imutável por ali.

A tela é **[julgados-creg.html](julgados-creg.html)**, gêmea da `julgados-cj.html`
da Câmara: lista as sessões com pendência, abre uma e mostra os processos com os
seletores de voto e status. Duas diferenças, e ambas vêm de decisões já tomadas:
a coluna mostra a **unidade** e para aí (não há de-para de nomes), e um rótulo do
histórico que saiu da lista — "Parcialmente Deferido", "Suspender" — aparece
marcado como *registro anterior* em vez de vir em branco, senão a primeira
gravação apagaria uma decisão que já existia. Salvar com ele ainda posto é
barrado na tela, com a linha nomeada, porque o banco recusaria a lista inteira.

---

## 6. Estado dos dados

Estado de produção em 27/08/2026, depois das três cargas e das pautas de
julho e agosto.

| | |
|---|---|
| distribuições no acervo | 3.181 (planilha 3.064 + ata 36 + sorteio 81) |
| processos distintos | 3.059 |
| julgados | 4.698, em 136 sessões |
| período | 05/01/2023 → 19/08/2026 |
| **pendentes de julgamento** | **166** (CREG1 54, CREG4 41, CREG3 37, CREG2 34) |
| julgados de processo fora do acervo | 1.397 |
| julgados cuja data de distribuição o acervo não tem | 47 |
| dentro / fora / indefinido na META 45 | 3.519 / 1.169 / 10 |
| divergentes da Câmara | 70 |
| fila da secretaria (sem voto ou sem status) | 167 |

Os 87 pendentes valem a leitura por unidade: 54 deles são do CREG1, e 53
desses passaram dos 45 dias. As outras três unidades saíram de meia centena
cada para 8, 11 e 14 quando as sessões de agosto entraram.

### As atas fecharam o buraco do acervo

As planilhas de gabinete param em **24/07/2026**, e a pauta de 19/08 tinha 19
processos que nenhuma delas conhecia. As **9 atas de sorteio de 17/06 a
14/08/2026** resolveram isso:

| | |
|---|---|
| distribuições nas atas | 175 |
| já presentes nas planilhas | 139 (as duas fontes concordam) |
| **novas** | **36** |
| pendentes depois delas | 214 |

Rodada a sincronização sobre esse acervo, as pautas de 05/08 (59 processos) e
19/08 (75) entram com **zero** em `processos_sem_acervo`, e todos os 134
julgados novos têm unidade resolvida pelo gatilho.

### Os 81 sorteados em 27/08 vieram da tabela antiga

No dia da virada, a tela em produção ainda era a que gravava em
`processos_sorteados`, e o sorteio daquele dia — 81 processos, 27 para cada uma
de CREG2, CREG3 e CREG4 — entrou lá. A migração `20260828…` copiou os 81 para
`acervo_creg` com `origem = 'sorteio'`; sem ela ficariam distribuídos e
invisíveis ao painel.

`processos_sorteados` **não foi esvaziada**: continua com as 81 linhas, como o
registro do que a tela gravou na época. Os pendentes passaram de 87 para 166.

Dois desses 81 já constavam do acervo em outra unidade e outra data — são
redistribuições legítimas, e o painel conta cada processo uma vez só, na
distribuição mais recente.

### O CREG1 não está desatualizado — ele parou de receber

A planilha do CREG1 termina em 17/06/2026, quase seis semanas antes das outras
três. Isso parecia defasagem, e não é: nas nove atas de sorteio, o CREG1 aparece
**só na de 17/06**. As outras três unidades receberam processo nas nove. A
unidade com a maior fila (55 pendentes) deixou de receber distribuição nova.

Vale um olhar também em **maio/2026**, que tem 15 distribuições contra 142 em
abril e 179 em junho — ou o Conselho quase não distribuiu, ou faltam
lançamentos daquele mês.

### Qualidade herdada da planilha

Nada disto impede o funcionamento; está aqui para não ser redescoberto.

- **CREG2 tem 327 distribuições**, contra ~950 de cada um dos outros três — mas
  666 processos julgados aparecem com `Unidade CREG = 2`. A planilha do CREG2
  parece truncada. Decidido em 27/08/2026 importar como está: o CREG2 aparece
  com fila artificialmente curta no painel, e os processos dele julgados antes
  ficam sem distribuição de origem.
- **18 processos aparecem em mais de uma unidade** — redistribuição, ou a mesma
  linha lançada em dois gabinetes. O painel conta só a distribuição mais
  recente, e um julgado anterior a ela não a esconde: "julgado" ali é julgado
  a partir da distribuição (`data_sessao >= data_distribuicao`).
- **1 linha do CREG3 estava marcada `CREG4`** na coluna Gabinete. A unidade vem
  do arquivo, não da coluna, então ela entrou como CREG3.
- **13 linhas com voto fora da lista do Conselho**, preservadas de propósito.
- Duas sessões da planilha (05/06/2025 e 09/02/2026) não constam da listagem da
  AGR, e uma sessão da AGR de 2023 (30/03) não consta da planilha.

`sql/verificacao_creg.sql` conta todos esses casos e roda só leitura.

---

## 7. Ordem de execução

Num banco que já tem a Câmara:

1. **`sql/schema.sql`** (ou `supabase/migrations/20260827150000_creg_acervo_julgados_pautas.sql`) — tabelas, gatilho, RPCs, RLS e o marco;
2. **`python dados/importar_creg.py "<pasta das planilhas>"`** — gera
   `dados/acervo_creg.sql` e `dados/julgados_creg.sql` (fora do Git: são dados
   administrativos em volume e o repositório é público);
3. **`python dados/importar_atas_creg.py <atas.pdf…>`** — gera
   `dados/acervo_creg_atas.sql` a partir dos PDFs das atas de sorteio;
4. **`dados/acervo_creg.sql`**, **`dados/acervo_creg_atas.sql`** e só então
   **`dados/julgados_creg.sql`** — nessa ordem: o acervo inteiro antes dos
   julgados, senão eles não encontram o processo para se ligar;
5. **`sql/verificacao_creg.sql`** — nenhum ERRO deve aparecer;
6. **sincronização** — `--colegiado CREG`, que traz 03/07, 05/08 e 19/08/2026;
7. **`sql/rederivar_creg.sql`** — depois da sincronização, e depois de cada
   atualização das planilhas de gabinete: religa ao acervo os julgados que
   entraram sem ele. Inserir no acervo não dispara o gatilho de julgados_creg
   sozinho.

Todos os passos são idempotentes.

---

## 8. O que ainda não está resolvido

- **O CREG1 não recebe distribuição desde 17/06/2026** e é a unidade com a
  maior fila (55 pendentes). Confirmado nas nove atas de sorteio; pode ser
  deliberado, para escoar o acervo, mas ninguém no sistema sabe dizer.
- **A lista de recursos do sorteio diverge do histórico.** `index.js` oferece
  `Com recurso`, `Sem recurso`, `Não se aplica` e `Pedido de revisão`; o acervo
  registrado traz `Ad Referendum` (38 linhas) e `Reexame Necessário` (15), e
  nenhum `Pedido de revisão`. Alinhar as duas listas é decisão do Conselho.
- **`processos_sorteados` continua no schema**, sem ninguém escrevendo nela
  desde 27/08/2026 — mas não vazia: guarda as 81 linhas daquele dia, como o
  registro do que a tela gravou na época (a migração `20260828…` as copiou para
  `acervo_creg`). Não foi derrubada porque é o objeto da migração
  20260823165725 e porque apagar tabela é decisão de quem opera o banco.
