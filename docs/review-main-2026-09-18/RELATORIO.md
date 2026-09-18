# Revisão do branch main — 18/09/2026

**Atualização — correções 4.0:** os quatro achados abaixo foram corrigidos no código.
A proteção de concorrência tem migração própria; as consultas de leitura paginam;
`--desde` relê URLs registradas; extrações parciais falham atomicamente.
Os scripts desta pasta agora executam testes de regressão (esperam o comportamento
corrigido), incorporados também à CI. O texto abaixo preserva o diagnóstico do
commit original. A migração hospedada não é aplicada pelo commit e deve preceder
a publicação do frontend, conforme o README.

**Validação das correções:** 269 testes Python offline, 195 testes JavaScript
de interface/paginação e 1 teste online da AGR passaram (465 no total), além
das verificações de sorteio, assets, sintaxe e geração dos bundles. A suíte CJ
também confirmou que a nova migração e o schema entregam as mesmas funções.

**Commit revisado:** `9a34e19b990b4800fb37ef333b945b9247667d83`.

**Resultado:** quatro problemas confirmados, sendo um P1 e três P2. As suítes existentes passaram, mas não cobrem os cenários reproduzidos abaixo. Recomendo corrigir a sobrescrita de votos antes de considerar concluída a validação funcional para uso simultâneo por operadores.

Esta revisão não alterou código de aplicação, schema, migrações ou dados de produção. Os únicos entregáveis versionáveis adicionados são este relatório e os dois scripts de reprodução nesta pasta. A referência é o `main` local no commit acima; não houve comparação com uma nova atualização do remoto.

## Problemas encontrados

### 1. [P1] Uma tela desatualizada sobrescreve o voto salvo por outro operador

**Localização:** `assets/js/julgados.js:286–288`, `assets/js/julgados-creg.js:292–294`, `sql/schema.sql:442–450` e `sql/schema.sql:1119–1127`.

A interface identifica a linha alterada, mas envia os dois campos (`voto` e `status`), inclusive o campo que o operador não modificou. As RPCs aplicam qualquer valor não vazio sem conferir a versão ou os valores lidos originalmente.

**Reprodução:** dois operadores abrem um processo com voto `Manter` e status vazio. A altera o voto para `Anular` e salva. Na tela que já estava aberta, B preenche apenas o status `Julgado`. O payload de B contém o voto antigo `Manter`; a RPC aceita a gravação, retorna sucesso e desfaz a alteração de A. O cenário foi reproduzido tanto na CJ quanto no CREG, executando as gravações na ordem em que chegariam de duas telas simultaneamente abertas. Não depende de as transações SQL ocorrerem no mesmo instante.

**Impacto:** perda silenciosa de uma decisão registrada. `atualizado_por` e `atualizado_em` passam a identificar apenas a última gravação; essas RPCs não preservam um histórico dos valores sobrescritos em `auditoria_admin`.

**Correção recomendada:** enviar somente os campos efetivamente modificados e adotar controle de concorrência otimista na RPC, com versão esperada ou comparação dos valores anteriores. Se o registro mudou, informar conflito e preservar as escolhas locais para revisão. Apenas bloquear o botão Salvar não resolve duas abas ou dois usuários.

**Evidência:** `reproduzir.py` confirma que o resultado final é `Manter/Julgado` depois de `Anular` ter sido salvo com sucesso, nos dois colegiados.

### 2. [P2] Listas e exportações tratam uma resposta limitada da API como completa

**Localização:** `assets/js/acervo.js:670–675,694–701`, `assets/js/supabase.js:347–370`. Também ocorre na consulta de pendências em `assets/js/julgados.js:109–112`, na equivalente do CREG e na contagem do card em `assets/js/index.js:98–105`.

O detalhe do acervo faz uma única chamada à RPC e exporta exatamente o array recebido. O cliente `api()` descarta os cabeçalhos de paginação; não há busca das próximas páginas nesses fluxos. As funções SQL do detalhe retornam conjuntos de linhas, portanto o fato de elas não terem `LIMIT` próprio não garante que o transporte REST entregue tudo.

**Condição:** o recorte consultado contém mais registros que o limite configurado da Data API. O limite padrão documentado pelo Supabase é 1.000 registros e pode ser configurado por projeto. A configuração efetiva de produção não foi consultada. [Documentação oficial](https://supabase.com/docs/reference/python/select).

**Reprodução:** `paginacao.mjs` executa a implementação real de `api()` com uma resposta REST simulada contendo 1.000 itens e `Content-Range: 0-999/1001`. O resultado contém só 1.000 itens e nenhuma segunda consulta é feita. A inspeção dos consumidores confirma que esse array é tratado como a lista completa. Esta reprodução valida o comportamento do cliente; não afirma que a produção esteja hoje truncando um recorte específico.

**Impacto:** o total agregado do painel pode superar a quantidade de processos no detalhe e no Excel; pendências antigas podem ficar fora da tela e o badge apresentar uma contagem menor que a real.

**Correção recomendada:** paginar com ordenação estável, obter contagens no servidor e buscar todas as páginas necessárias à exportação. Distinguir no texto da interface a quantidade carregada do total. Acrescentar um teste com volume maior que o limite configurado.

### 3. [P2] A opção `--desde` não reprocessa documentos já registrados

**Localização:** `sincronizacao/sincronizar.py:134–164`, em especial `162–163`; contrato da opção em `299–301` e no formulário de `.github/workflows/sincronizar-julgados.yml`.

`desde` muda somente a data de corte. A condição `p.url not in ja_vistas` continua sendo aplicada incondicionalmente. Assim, a opção apresentada como reprocessamento não volta a ler uma pauta já registrada, mesmo que seu PDF tenha sido corrigido mantendo a URL.

**Reprodução:** registrar uma pauta de 02/07/2026 e chamar `pautas_pendentes(..., desde=30/06/2026)` com a mesma URL na listagem. A lista de pendentes fica vazia. O SHA-256 guardado não é comparado porque o documento nem chega a ser baixado novamente.

**Impacto:** o disparo manual não recupera processos omitidos ou acrescentados a um documento na mesma URL. É necessário mexer no registro de controle por fora do fluxo anunciado.

**Lacuna de teste:** `tests/test_sincronizacao.py:438–451` apaga `pautas_cj` antes de testar o reprocessamento; com isso, não exercita o caso de uma URL ainda registrada.

**Correção recomendada:** definir uma opção explícita para forçar a releitura das URLs no intervalo, preservando a idempotência dos julgados. Atualizar de forma coerente o hash e os metadados da pauta; `registrar_pauta()` atualmente usa `ON CONFLICT DO NOTHING`. Definir separadamente como reconciliar remoções e alterações de sessão sem apagar decisões já preenchidas.

**Evidência:** `reproduzir.py` confirma que a pauta registrada continua excluída mesmo com `desde` anterior à sessão.

### 4. [P2] Extração parcial encerra a pauta e impede a recuperação automática dos itens omitidos

**Localização:** `sincronizacao/sincronizar.py:178–205`, em especial `194–205`.

O sincronizador detecta números de processo não reconhecidos pelo parser, mas só rejeita o documento quando **nenhum** processo foi extraído. Se ao menos um item for reconhecido, os demais números ignorados geram apenas um aviso no log e a URL é registrada como concluída.

**Reprodução:** documento com `Processo nº 202600029999902` e `Proc. 202600029999903`. O primeiro é importado; o segundo aparece na detecção de números sem rótulo, mas não é importado. Mesmo assim, a pauta entra em `pautas_cj`. As próximas execuções excluem sua URL da fila.

**Impacto:** uma mudança parcial de formatação do PDF causa perda persistente de itens da pauta, com processamento considerado bem-sucedido. Corrigir o parser posteriormente não recupera os processos sem reabrir o documento para processamento. O defeito de `--desde` agrava a recuperação, mas as duas causas são independentes.

**Correção recomendada:** quando houver números suspeitos, marcar a importação como incompleta e mantê-la elegível para nova tentativa, ou recusar atomicamente a pauta para conferência. Não importar números sem rótulo indiscriminadamente: podem não ser processos pautados. Registrar a divergência também no resumo estruturado e no estado de falha do job.

**Evidência:** `reproduzir.py` confirma um julgado importado, outro ausente e a URL registrada como processada para o mesmo documento.

## Validações executadas

| Área | Resultado |
| --- | --- |
| Permissões por órgão — `test_acesso.py` | 11/11 |
| Operações administrativas e auditoria — `test_admin.py` | 69/69 |
| CJ, importação, migrações, backup e restauração — `test_cj.py` | 86/86; nenhum pulado |
| CREG, derivação, importadores e atas — `test_creg.py` | 46/46 |
| Sincronização com fixtures e PostgreSQL — `test_sincronizacao.py` | 45/45 offline |
| Contratos dos workflows — `test_workflows.py` | 6/6 |
| Integração online com a AGR/CJ | O teste inicialmente pulado foi executado separadamente e passou |
| Interface com ambiente simulado — `test_frontend.mjs` | 186/186 |
| Aleatoriedade — `test_sorteio.mjs` | Passou |
| Assets, carregamento e hash — `test_assets.mjs` | Passou |
| Sintaxe JavaScript/Node, incluindo `sw.js` | 21 arquivos aprovados |
| Sintaxe Python de aplicação, importadores e testes | 13 arquivos aprovados |
| Minificação com esbuild 0.28.2 | 9/9 arquivos iguais aos versionados, normalizando CRLF/LF |
| Reproduções adicionais desta revisão | Quatro problemas confirmados; voto exercitado nos dois colegiados |

No total, **263 testes Python offline + 186 testes de interface + 1 teste online passaram**, além das verificações independentes de sorteio, assets, sintaxe e minificação. Os avisos de PDF inválido e de indisponibilidade durante a suíte offline são cenários deliberadamente simulados; não indicam falha real do portal.

Os testes SQL rodaram em PostgreSQL 15 descartável no Docker. A suíte CJ encontrou sua planilha de referência local e verificou 3.144 linhas de julgados; as divergências esperadas em relação às fórmulas foram aceitas pela própria suíte. A comparação de migrações com o schema passou no fluxo de upgrade montado pelos testes. Isso não equivale a verificar o ledger do projeto hospedado.

## Escopo e limites

Foram revisados os módulos JavaScript de autenticação, sorteio, julgamentos, acervo, histórico e administração; schema, controle de acesso e funções SQL; sincronização e importadores; workflows e estratégia de assets. A validação automatizada cobriu também os scripts de manutenção usados pelas suítes.

Não houve teste ponta a ponta autenticado em navegador real, auditoria visual/responsiva, teste de carga, consulta à base de produção ou confirmação de seus secrets, parâmetros de Auth, limite REST, ledger e jobs agendados. O teste online existente cobre a fonte da CJ; o CREG foi validado pelas fixtures e pela suíte local. Portanto, os resultados validam o código e os cenários descritos, sem certificar integralmente a operação hospedada ou a ausência de outros bugs.

## Como repetir as reproduções

Na raiz do projeto, com Node.js, Python, Docker e as dependências de `tests/requirements.txt` disponíveis:

```powershell
python docs/review-main-2026-09-18/reproduzir.py
node docs/review-main-2026-09-18/paginacao.mjs
```

O script Python cria e remove o container exclusivo `sorteio_sei_review_regression`, usando a porta local 55439. Ele não usa credenciais de produção. As assertivas agora verificam os comportamentos corrigidos, incluindo transações concorrentes, atomicidade do lote, releitura e recuperação após falha.
