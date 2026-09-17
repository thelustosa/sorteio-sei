# Exclusão de julgados e distribuições no painel administrativo — brief de design

Brief produzido com `/impeccable shape` sobre o sistema já existente (PRODUCT.md,
DESIGN.md "O Livro de Registro Oficial"). Não abre direção visual nova: estende o
diálogo de duas etapas do painel para uma intenção destrutiva.

## 1. Tarefa e público

- **Quem chega:** os dois administradores (`lucas.coelho`, `sec-agr`), com papel
  `admin` nos dois colegiados. Nunca a secretaria operadora.
- **Situação:** um registro que não deveria existir — distribuição lançada em
  duplicidade na carga de ata, processo de outro órgão que entrou na pauta, julgado
  importado na sessão errada. Hoje a única saída é SQL direto no banco, sem rastro.
- **Modo:** Operate. Escaneabilidade, consistência com as ações vizinhas e
  prevenção de erro acima de expressão.

## 2. Resultado e prova

- **Ação principal:** excluir, a partir da linha onde o erro é visto, um julgado,
  uma distribuição, ou a distribuição junto com os julgados ligados a ela.
- **Sucesso:** o registro some de acervo, histórico, pendências e julgados; a
  auditoria guarda a linha inteira, com autor, horário e motivo; nenhuma ERRO nova
  em `verificacao_cj.sql` / `verificacao_creg.sql`.
- **Verdade do produto:** Princípio 3 ("toda ação grava autoria e horário") vale em
  dobro, porque aqui a ação destrói o dado. O rastro é a única memória do que existiu.

## 3. Direção escolhida (decisões confirmadas em 17/09/2026)

| Decisão | Escolha |
|---|---|
| Como excluir | Apagar a linha e guardar a linha inteira em `auditoria_admin.antes` (`depois = {}`). Sem exclusão lógica. |
| Só a distribuição, com julgados ligados | Os julgados ficam, com a cópia de relator/unidade e datas, e perdem o vínculo (`acervo_id = null`). "Religar ao acervo" resolve depois. |
| Motivo | Obrigatório, no navegador e no banco. |

- **Tese de interação:** a exclusão é mais uma ação da linha e reaproveita o diálogo
  de duas etapas do painel (etapa 1 escolhe o alcance e o motivo, etapa 2 lista o
  que deixa de existir). Nada novo para aprender; o vermelho aparece só onde há
  destruição.
- **Intenção no nome da porta**, como `corrigir_acervo` × `redistribuir`: três RPCs
  por colegiado, nunca um booleano vindo do cliente.

## 4. Escopo e limites

- **Dentro:** botão "Excluir" nos detalhes de sessão e de distribuição, CJ e CREG;
  diálogo destrutivo; RPCs; exibição de exclusões na aba Auditoria; ajustes de
  larguras de coluna; testes de banco e de front.
- **Fora (anti-metas):** restaurar pela tela; exclusão em lote de uma sessão ou
  distribuição inteira; exclusão por número de processo em todo o colegiado;
  confirmação por digitação do número; qualquer mudança nas páginas da secretaria.
- **Intocado:** o fluxo e o texto das correções existentes; a navegação por data;
  as larguras das listas-resumo (`sessoes`, `sorteios`, `auditoria`).

## 5. Estados e faixas

| Estado | Comportamento |
|---|---|
| Julgado sem distribuição | Sem escolha de alcance: só "este julgado". Foco vai para o motivo. |
| Distribuição sem julgados | Sem escolha de alcance: só "a distribuição". |
| Distribuição com 1–N julgados | Escolha "Somente a distribuição — N julgados ficam sem vínculo" ou "A distribuição e N julgados vinculados". Padrão: o alcance mais estreito. |
| Motivo vazio | Etapa não avança: "Informe o motivo da exclusão." Conferido nas duas etapas, porque o campo continua editável na revisão. |
| Consulta do alcance falha | **Bloqueia** a revisão (diferente da correção, onde o preview é só informativo): "Não foi possível listar o que a exclusão alcança. Tente novamente." |
| Gravação falha | Erro no diálogo + aviso, como hoje. |
| Último processo da sessão/distribuição excluído | O grupo deixou de existir: volta para a lista de datas, com o aviso. |
| Distribuição excluída com julgados mantidos | Aviso em tom de atenção dizendo quantos ficaram sem vínculo e apontando "Religar ao acervo". |
| Auditoria de um registro excluído | Operação "Exclusão de …", campos do registro como "Campo: valor" (sem seta), número do processo recuperado do retrato. |

## 6. Interação e layout

- **Na linha:** "Excluir" é o último botão do grupo de Ações, afastado dos demais
  (6px a mais), com `aria-label="Excluir processo <número>"`. Em repouso, borda sutil
  e texto secundário — vermelho em toda linha seria um alarme permanente; o vermelho
  entra no hover e no foco (mesmo padrão do `.btn-excluir` do sorteador). O anel de
  foco continua verde institucional, como em todo o sistema.
- **Etapa 1:** título "Excluir julgado" / "Excluir distribuição"; resumo com processo
  e data; `select` "O que excluir" (mesmo controle de "Onde corrigir" da
  renumeração) quando houver duas opções; motivo obrigatório ("Motivo da exclusão",
  sem o selo "opcional"). Botão verde "Revisar exclusão" — ainda não destrói nada.
- **Etapa 2:** ícone da revisão em vermelho suave; título "Revise antes de excluir";
  texto "Nada foi excluído até você confirmar. Este painel não desfaz a
  exclusão." (a garantia de auditoria já está na dica do motivo, e o DESIGN.md
  pede uma vez por tela); a lista "Registros que serão excluídos" em painel vermelho
  (`--danger-panel*`) ou "Depois da exclusão" em teal de atenção quando nada além do
  próprio registro some; botão sólido vermelho "Excluir definitivamente" →
  "Excluindo…".
- **Responsivo (≤960px, cartões):** o grupo de ações já empilha em coluna; o
  afastamento do Excluir vira margem superior.

## 7. Restrições e decisões que o implementador não inventa

- Tokens existentes apenas: `--danger`, `--danger-hover`, `--danger-soft`,
  `--danger-panel`, `--danger-panel-text`, `--danger-panel-border`, `--border-subtle`,
  `--muted`. Nenhuma família de cor nova, nenhuma sombra nova, nenhum raio solto.
- Vocabulário único: "Excluir" em botão, título, confirmação, aviso e auditoria;
  "distribuição" e "julgado" — nunca "sorteio" ou "rodada" para a linha do acervo.
- Consequência real que precisa aparecer: excluir só o julgado não impede a
  sincronização de reimportá-lo se a AGR republicar a pauta com URL nova
  (`sincronizar.py` filtra por URL e insere com `on conflict do nothing`).
- O retrato inclui `interessado` (CREG). É aceitável porque `auditoria_admin` só é
  legível por admin do próprio órgão (RLS) e o dado já está no banco; o repositório
  público não recebe dado nenhum.

## Cópia (pt-BR)

| Onde | Texto |
|---|---|
| Botão da linha | `Excluir` (aria-label `Excluir processo 202600000000001`) |
| Título | `Excluir julgado` · `Excluir distribuição` |
| Resumo (julgado) | `Processo 202600000000001 · sessão de 09/07/2026, pauta 24` |
| Resumo (distribuição) | `Processo 202600000000001 · distribuição de 18/06/2026 · CJ3` |
| Campo de alcance | `O que excluir` |
| Opções (julgado) | `Somente este julgado` · `O julgado e a distribuição vinculada, com os demais julgados dela` |
| Opções (distribuição) | `Somente a distribuição — 1 julgado fica sem vínculo` · `A distribuição e 1 julgado vinculado` |
| Motivo | `Motivo da exclusão` · placeholder atual mantido |
| Botões | `Revisar exclusão` → `Excluir definitivamente` → `Excluindo…` |
| Revisão | `Revise antes de excluir` / `Nada foi excluído até você confirmar. Este painel não desfaz a exclusão.` |
| Lista destrutiva | `Registros que serão excluídos` |
| Lista de atenção | `Depois da exclusão` |
| Sucesso | `Exclusão gravada: 1 distribuição e 2 julgados do processo 202600000000001.` |
| Atenção | `… 1 julgado ficou sem distribuição vinculada — use "Religar ao acervo" se o processo tiver outra distribuição.` |
| Auditoria | `Exclusão de julgado` · `Exclusão de distribuição` · `Exclusão de distribuição e julgados` |
