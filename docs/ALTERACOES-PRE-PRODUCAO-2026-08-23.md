# Alterações pré-produção — diff completo de 23/08/2026

## 1. Escopo deste documento

Este documento descreve o estado integral do diretório de trabalho em relação ao
`HEAD` no momento da revisão final, antes de criar este próprio arquivo.

| item | valor |
|---|---|
| branch | `fix/dados` |
| baseline | `d1f4fc4` |
| commit-base | `docs: registrar a carga de recuperação da CJ de agosto/2026` |
| data do commit-base | `2026-08-21T11:04:25-03:00` |
| arquivos modificados | 23 |
| arquivos novos | 4 |
| arquivos renomeados ou removidos | 0 |
| variação textual original | 1.414 adições e 152 remoções |

O inventário original tinha 27 arquivos. Este documento é o 28º arquivo do
diretório de trabalho e, por isso, não entra nos números acima. Arquivos
minificados são armazenados em uma única linha; o Git contabiliza cada um como
uma linha removida e uma adicionada, embora eles reflitam todas as mudanças da
respectiva fonte.

Para reproduzir o recorte:

```bash
git diff HEAD
git diff --name-status HEAD
git ls-files --others --exclude-standard
```

## 2. Resumo executivo

As mudanças preparam a aplicação para produção em seis frentes:

1. O sorteio CREG passa a exigir processo SEI com 15 dígitos tanto no navegador
   quanto no banco e não aceita a mesma distribuição duas vezes.
2. O backup JSON deixa de depender de download automático: em falha, ausência de
   configuração ou sessão expirada, o usuário recebe um botão explícito e o
   conteúdo continua disponível depois da reautenticação.
3. O registro de julgamentos envia somente linhas realmente alteradas e recebe
   melhorias de foco para navegação por teclado e leitores de tela.
4. A CJ usa um marco fixo em 18/06/2026 e consulta todos os anos abrangidos. Um
   PDF que falha, uma retomada após a virada do ano ou uma republicação com URL
   nova não ficam ocultos por pautas processadas depois.
5. O PostgreSQL/Supabase recebe restrições, funções endurecidas e privilégios
   mínimos explícitos; uma migração incremental já representa essa evolução da
   base hospedada.
6. Um novo workflow executa frontend, banco, sincronização e regeneração dos
   minificados em todo push e pull request.

## 3. Mapa das mudanças de comportamento

| fluxo | antes | agora |
|---|---|---|
| quantidade de processos | `parseInt` aceitava, por exemplo, `1.5` como `1` | somente inteiro entre 1 e 500 |
| botão “Adicionar linha” | podia criar a 501ª linha | interrompe em 500 e informa o limite |
| número CREG | o navegador não exigia o padrão SEI | navegador e banco exigem exatamente 15 dígitos |
| CREG repetido | podia ser reenviado | índice único recusa mesma modalidade, processo, data e unidade; API responde 409 |
| falha ao gravar sorteio | JSON era baixado automaticamente | JSON fica pendente até o clique em “Baixar backup .json” |
| sessão expirada durante gravação | a tela de login reaparecia sem um fluxo explícito de recuperação | o sorteio fica em memória e o botão de backup reaparece após o login |
| resposta assíncrona tardia | era possível voltar enquanto o POST ainda respondia | “Voltar” fica desabilitado até a persistência terminar |
| salvar julgamentos | qualquer linha com algum valor podia ser reenviada | somente linhas cujo voto ou status mudou são enviadas |
| data de distribuição informada | sem correspondência exata, o gatilho podia usar outra distribuição | fica sem vínculo para revisão; nenhuma data diferente é inventada |
| rederivação de órfãos | zerava relator, defesa e data antes de tentar novamente | dispara o gatilho sem apagar valores manuais |
| corte da sincronização | avançava pela última sessão conhecida | usa marco fixo em 18/06/2026 |
| anos consultados | normalmente somente um ano | do ano do corte até o ano atual; `--ano` continua limitando |
| pauta que falhou | podia ficar atrás do corte móvel | volta a ser elegível até ser processada |
| CI | não havia workflow geral | valida JS, Python, Postgres e minificados automaticamente |

## 4. Frontend do sorteio

### 4.1 Validação e limites

Em `assets/js/index.js`:

- `Number` e `Number.isInteger` substituem `parseInt`, evitando truncamento de
  valores decimais.
- A faixa permitida continua entre 1 e 500.
- “Adicionar linha” verifica a quantidade atual antes de criar outra linha; ao
  alcançar 500, exibe mensagem acessível e mantém o foco no botão.
- A expressão `^\d{15}$` agora vale para CREG e CJ. Pontos, barras, letras e
  números incompletos são recusados antes do sorteio, da ata e do POST.
- `index.html` acrescenta `step="1"` ao campo numérico, alinhando a interface à
  validação JavaScript.

### 4.2 Persistência e backup explícito

Em `index.html` foi criado o botão oculto `#baixarBackup`. Em
`assets/js/index.js` foi criado o estado `backupPendente`.

O fluxo agora é:

1. A ata `.doc` continua sendo gerada imediatamente após o sorteio.
2. O botão “Voltar” é desabilitado enquanto o POST está pendente.
3. Se o banco confirmar o POST, a interface informa o sucesso e não oferece
   backup.
4. Se o Supabase não estiver configurado, o backup é preparado e o botão
   aparece; nenhum download JSON é iniciado sem ação humana.
5. Se a chamada falhar, o mesmo botão aparece. O erro 409 recebe mensagem
   específica para conferir o sorteio anterior antes de tentar novamente.
6. Em erro 401, “Voltar” fica temporariamente oculto e a autenticação reaparece.
   Após novo login, `inicializarSorteio()` restaura o resultado, o botão e o foco.
7. Ao clicar no botão, o JSON é gerado, o estado pendente é limpo, o botão some e
   o foco retorna a “Voltar”.
8. Escolher outra modalidade ou voltar ao início também limpa qualquer backup
   antigo, impedindo baixar dados de um sorteio anterior por engano.

O POST continua atômico: se uma linha entrar em conflito, nenhuma linha daquele
lote é gravada.

### 4.3 Acessibilidade e foco

Foram adicionados alvos programáticos com `tabindex="-1"`:

- `#modeSelectorTitle`, título da seleção CREG/CJ;
- `#resultadoSorteioTitle`, título do resultado;
- `#listaPautasTitulo`, título da lista de pautas;
- `#tituloPauta`, título do detalhe da pauta.

O foco passa a acompanhar as mudanças de contexto:

- login concluído → título da modalidade;
- modalidade escolhida → quantidade de processos;
- sorteio concluído → título do resultado;
- pauta aberta → título da pauta;
- retorno, recarga ou login na página de julgamentos → título da lista;
- backup restaurado após login → botão de download.

### 4.4 Registro de julgamentos

Em `assets/js/julgados.js`:

- cada seletor guarda seu valor inicial em `data-valor-inicial`;
- cada linha mantém `data-alterada`, recalculado a cada mudança;
- `salvar()` filtra apenas linhas alteradas e remove o marcador antes de montar o
  JSON da RPC;
- alterar e depois retornar ao valor original deixa a linha como não alterada;
- linhas parcialmente preenchidas, mas intocadas nesta abertura, não são
  reenviadas;
- após salvar, a lista é recarregada e recebe foco;
- retorno e nova tentativa após erro também direcionam o foco corretamente.

### 4.5 Rotas, cache e versão visível

- `404.html` recebe `<base href="/sorteio-sei/">`. Assim favicon, CSS e o link de
  retorno continuam resolvendo na raiz do GitHub Pages mesmo em uma URL aninhada.
- A versão dos assets passa de `20260821` para `20260823-2` em `index.html`,
  `julgados.html`, `404.html`, `assets/js/supabase.js` e `sw.js`.
- O cache do service worker passa a se chamar
  `sorteio-sei-assets-20260823-2`, invalidando os arquivos antigos.
- A versão visível no rodapé de `index.html` passa de 1.5 para 1.6.
- O rodapé de `julgados.html` permanece na versão 1.5.
- `assets/js/index.min.js`, `julgados.min.js` e `supabase.min.js` foram
  regenerados a partir das fontes. Não contêm regra adicional independente.
- `assets/js/bootstrap.js`, `assets/js/bootstrap.min.js` e os arquivos CSS não
  mudaram; somente suas URLs versionadas ou sua conferência no CI foram afetadas.

## 5. Banco de dados e Supabase

Este diff não cria tabela nem coluna. Ele altera restrições, índices, funções,
privilégios, uma linha sentinela e os scripts de operação/verificação.

### 5.1 Integridade do CREG

`sql/schema.sql` passa a criar a constraint
`processos_sorteados_num_processo_15_digitos` em duas etapas:

1. `CHECK (num_processo ~ '^[0-9]{15}$') NOT VALID`, protegendo imediatamente
   novas gravações sem fingir que o legado já está correto;
2. `VALIDATE CONSTRAINT`, que só conclui se todas as linhas existentes forem
   válidas.

Também cria o índice único `ux_processos_sorteados_distribuicao` sobre:

```text
(modo, num_processo, data_distribuicao, unidade)
```

Ele impede que o mesmo processo seja distribuído novamente à mesma unidade, na
mesma data e modalidade. Assunto e recurso não fazem parte da identidade da
distribuição.

`sql/verificacao_cj.sql` ganha duas verificações:

- `ERRO`: distribuição CREG repetida pela mesma chave do índice;
- `AVISO`: número CREG legado fora do padrão de 15 dígitos.

O aviso não altera nem completa números automaticamente; a correção precisa de
fonte oficial.

### 5.2 Marco canônico da CJ

`sql/schema.sql` passa a fazer `upsert` da linha sentinela:

| coluna | valor |
|---|---|
| `url` | `marco:inicio-da-serie` |
| `titulo` | `Início da série` |
| `numero` | `0` |
| `data_sessao` | `2026-06-18` |
| `sha256` | `marco` |

O `ON CONFLICT (url) DO UPDATE` também corrige instalações que já possuíam o
marco com outra data. Consultas que contem documentos reais devem continuar
filtrando `url LIKE 'https://%'`.

### 5.3 Derivação de julgados a partir do acervo

A função `julgados_cj_derivar_do_acervo()` passa a diferenciar explicitamente
dois casos:

- com `data_distribuicao` informada: procura somente o mesmo processo naquela
  data exata; se não encontrar, deixa `acervo_id` nulo;
- sem data informada: procura a distribuição mais recente até a sessão e, se
  ainda não existir, usa a distribuição mais antiga do processo.

O `coalesce` continua preservando `relator`, `defesa` e `data_distribuicao`
informados manualmente. A mudança elimina o vínculo silencioso com uma
distribuição de data diferente.

O evento do trigger não mudou: ele continua sendo `BEFORE INSERT OR UPDATE OF`
dos campos de derivação em `julgados_cj`. A alteração está no corpo da função e
nos privilégios de execução direta.

`sql/rederivar_cj.sql` agora executa:

```sql
update public.julgados_cj
   set data_distribuicao = data_distribuicao
 where acervo_id is null;
```

A atribuição dispara o gatilho sem zerar campos manuais. O filtro continua
tornando o script repetível: após obter `acervo_id`, a linha não participa da
próxima execução. Órfãos que ainda não encontram correspondência continuam
nulos e podem ser reavaliados em outra execução. Voto e status não são tocados.

### 5.4 Autenticação das funções

- `auth_email()` passa a usar `SET search_path = ''` e tem `EXECUTE` revogado de
  `public`, `anon` e `authenticated`.
- `registrar_votos(jsonb)` deixa de registrar autor como `desconhecido`.
- A RPC exige simultaneamente `auth.uid()` e e-mail não vazio; ausência de JWT
  válido gera SQLSTATE `28000` com “autenticação exigida”.
- A função continua `SECURITY DEFINER`, com `search_path` vazio e validação dos
  IDs, votos e status permitidos.
- `EXECUTE` é revogado de `public`, `anon` e `service_role` e concedido somente a
  `authenticated`.
- A função interna do gatilho também tem execução direta revogada de `public`,
  `anon` e `authenticated`.

### 5.5 Privilégios mínimos

O schema deixa de depender dos grants amplos padrão do Supabase. Primeiro revoga
todos os privilégios de `anon` e `authenticated` nas quatro tabelas e quatro
sequences; depois concede somente:

| papel | privilégio |
|---|---|
| `anon` | nenhum privilégio de tabela ou sequence |
| `authenticated` | `INSERT` em `processos_sorteados` |
| `authenticated` | `INSERT` em `acervo_cj` |
| `authenticated` | `SELECT` em `julgados_cj` |
| `authenticated` | `USAGE` nas sequences de `processos_sorteados` e `acervo_cj` |

As políticas RLS continuam sendo a primeira regra por operação e os grants
agora repetem o mesmo mínimo como segunda camada. O navegador não recebe
`UPDATE`, `DELETE`, leitura dos sorteios/acervo ou acesso direto a `pautas_cj`.
As revogações de tabela desta mudança atingem `anon` e `authenticated`, não o
papel `service_role`; para ele, a mudança específica é a revogação de execução
da RPC `registrar_votos`.

### 5.6 Migração incremental nova

Foi criado
`supabase/migrations/20260823165725_corrigir_integridade_creg_e_privilegios.sql`.
Ela representa o delta para uma base hospedada já existente; `sql/schema.sql`
continua sendo o estado final para instalações novas.

A migração, nesta ordem:

1. cria a constraint CREG como `NOT VALID`;
2. remove somente linhas que correspondam a duas combinações exatas de teste;
3. valida a constraint;
4. cria o índice único;
5. grava/corrige o marco da CJ;
6. substitui e endurece as três funções;
7. redefine os grants mínimos.

O único `DELETE` identifica os alvos pelos campos abaixo e não usa um filtro
geral por data ou modalidade:

| modo | processo | data | unidade | recurso |
|---|---|---|---|---|
| CREG | `123421` | 20/08/2026 | CREG2 | Com recurso |
| CREG | `1234` | 20/08/2026 | CREG3 | Sem recurso |

Na base auditada existia uma linha de cada combinação, portanto exatamente dois
registros foram removidos. O SQL removeria todas as cópias que coincidissem com
uma dessas combinações, pois não filtra por `id`, `ordem`, `assunto` ou
`data_hora`. Nenhum outro CREG é alcançado.

A migração não atualiza `acervo_cj` nem `julgados_cj` e não rederiva vínculos
antigos automaticamente. No `upsert` do marco, contadores,
`processos_sem_acervo` e `processado_em` preexistentes são preservados. Bases com
outro número inválido ou duplicidade real param na validação/criação do índice
para exigir decisão humana, em vez de alterar dados por inferência.

O arquivo não declara `BEGIN`/`COMMIT`; a atomicidade do conjunto depende do
executor de migrações. O índice não é criado `CONCURRENTLY`, portanto sua criação
varre a tabela e pode bloquear escritas enquanto estiver em andamento.

## 6. Sincronização das pautas da CJ

### 6.1 Novo cálculo do corte

`sincronizacao/sincronizar.py` adiciona `inicio_da_serie()`, que lê a linha
`marco:inicio-da-serie` de `pautas_cj`.

A precedência do corte é:

1. `--desde`, quando informado manualmente;
2. marco fixo do banco;
3. última sessão conhecida, apenas para compatibilidade com instalações antigas.

### 6.2 Seleção dos anos

- `--ano`: consulta somente o ano informado.
- Com `--desde` ou marco: consulta cada ano do ano do corte até o ano atual.
- Sem marco e sem `--desde`: consulta somente o ano atual. Isso evita tentar uma
  faixa desde a data sentinela `1900-01-01` de uma base vazia.

Uma pauta fica pendente quando:

- sua URL ainda não existe em `pautas_cj`;
- sua sessão é estritamente posterior ao corte;
- sua sessão já ocorreu, isto é, `data_sessao <= hoje`.

Com isso:

- a sessão na própria data do marco não entra;
- um PDF que falhou volta nas rodadas seguintes;
- a retomada funciona após a virada do ano;
- uma pauta corrigida na mesma data, mas publicada em URL nova, é processada;
- URLs já registradas permanecem idempotentes.

O processamento por documento continua transacional: falhar um PDF desfaz
somente aquele documento, não registra sua URL e permite seguir com os demais.

### 6.3 Resumo e interface de linha de comando

O JSON de saída mantém `ano` e `fonte` para compatibilidade e acrescenta:

- `anos_consultados`;
- `fontes`;
- `data_de_corte`.

`ultima_sessao_conhecida` passa a ser calculada separadamente do corte efetivo.
As ajudas de `--ano` e `--desde` foram ajustadas para explicar o novo
comportamento.

### 6.4 Workflow e dependências

Em `.github/workflows/sincronizar-julgados-cj.yml`:

- a descrição de `ano` informa que vazio significa “do marco ao ano corrente”;
- `actions/checkout` passa a v6.0.2 fixada pelo SHA
  `de0fac2e4500dabe0009e67214ff5f5447ce83dd`;
- `actions/setup-python` passa a v6.2.0 fixada pelo SHA
  `a309ff8b426b58ec0e2a45f0f869d46889d02405`;
- a instalação passa a usar `python -m pip`.

Agenda, segredo `SUPABASE_DB_URL`, simulação, montagem segura dos argumentos,
timeout e resumo da execução permanecem inalterados.

`sincronizacao/requirements.txt` deixa de aceitar faixas e fixa:

```text
pypdf==5.9.0
psycopg2-binary==2.9.12
```

Não foi adicionada a dependência `requests`; a rede continua usando `urllib` da
biblioteca padrão.

## 7. Testes e integração contínua

### 7.1 Novo workflow de CI

`.github/workflows/ci.yml` é novo e roda em push, pull request e disparo manual.

Configuração:

- permissão `contents: read`;
- concorrência por workflow e referência, cancelando uma execução antiga;
- Ubuntu latest, timeout de 20 minutos;
- Python 3.11 e Node 22;
- `checkout` v6.0.2, `setup-python` v6.2.0 e `setup-node` v6.4.0,
  todos fixados por SHA.

Etapas:

1. instala `tests/requirements.txt`;
2. executa `node --check` em fontes JS, service worker e testes MJS;
3. executa todos os `tests/test_*.mjs`;
4. executa todos os `tests/test_*.py`;
5. regenera CSS e quatro JS minificados com `esbuild@0.28.2`;
6. falha se qualquer `.min.*` regenerado diferir do versionado.

O teste online da AGR continua opt-in e não roda no CI.

### 7.2 Dependências de teste

`tests/requirements.txt` é novo:

```text
-r ../sincronizacao/requirements.txt
openpyxl==3.1.5
```

Ele centraliza as dependências Python das suítes. Docker/PostgreSQL continuam
sendo requisitos externos, não pacotes Python.

### 7.3 Nova suíte de frontend

`tests/test_frontend.mjs` é uma suíte Node de 395 linhas e 14 casos. Ela usa um
DOM mínimo próprio e carrega as fontes reais `supabase.js`, `index.js` e
`julgados.js`, sem JSDOM ou nova dependência.

Casos cobertos:

1. quantidade decimal é recusada;
2. a 501ª linha não é criada;
3. falha de rede oferece backup sem download automático;
4. ausência de banco configurado tem o mesmo comportamento;
5. backup permanece acessível após 401 e reautenticação;
6. “Voltar” fica bloqueado enquanto a persistência pode responder;
7. CREG fora do padrão de 15 dígitos é recusado;
8. autenticação usa endpoint, payload e token esperados;
9. credencial inválida é traduzida sem expor resposta técnica;
10. somente julgamento alterado é enviado;
11. foco vai à quantidade após escolher modalidade;
12. foco vai à modalidade após login;
13. foco vai ao título após abrir pauta;
14. foco vai à lista de pautas após login.

### 7.4 Testes de banco

`tests/banco.py` cria, no PostgreSQL descartável, um schema `auth` e uma função
`auth.uid()` compatível com o JWT dos testes. A função usa `search_path` vazio e
lê `sub` de `request.jwt.claims`.

`tests/test_cj.py` passa a testar o schema e a migração incremental real. Entre
as novas verificações estão:

- marco canônico da série;
- grants SQL iguais ao mínimo da RLS;
- data manual sem correspondência não inventa vínculo;
- rederivação vincula órfão sem apagar campos manuais;
- CREG duplicado é recusado;
- novo CREG exige 15 dígitos;
- migração preserva CREG válido;
- RPC recusa JWT sem usuário.

Para exercitar a atualização, a suíte aplica primeiro o schema, simula o estado
anterior à migração, cria fixtures inválidas e um CREG válido, executa o arquivo
de migração e confere o resultado. O `DELETE` estreito é protegido por um teste
que falha se um CREG válido for removido.

A antiga segunda aplicação do schema como simples teste de reaplicação foi
substituída por esse caminho de upgrade real. As verificações preexistentes
também foram ampliadas para cobrir ACL das funções, `search_path`, revogação do
`service_role` e JWT com `role`, `email` e `sub`. O fixture de modo CJ usado num
teste passou a ter 15 dígitos para não misturar a regra de modo com a nova
constraint.

O runner também passa a informar corretamente quantos testes foram executados,
aprovados e pulados quando a planilha histórica local não foi fornecida.

### 7.5 Testes da sincronização

`tests/test_sincronizacao.py` adiciona o helper do marco e cobre:

- retentativa de pauta depois de uma sessão posterior;
- retentativa após virada do ano, consultando mais de uma listagem;
- banco vazio limitado ao ano atual;
- base legada sem marco limitada ao ano atual;
- `--desde` expandindo explicitamente a faixa de anos;
- pauta corrigida na mesma data e com URL nova.

O runner passa a separar executados, aprovados, falhas e teste online pulado.

### 7.6 Testes de assets

`tests/test_assets.mjs` acrescenta uma regressão para URL 404 aninhada. O teste
resolve favicon, CSS e link de retorno usando o `<base href>` e exige que todos
apontem para `/sorteio-sei/`.

As verificações existentes de versão única, existência dos minificados e
carregamento lazy continuam ativas.

## 8. Documentação e arquivos operacionais

### `README.md`

Passa a documentar:

- backup JSON por clique explícito;
- diretório de migrações do Supabase;
- `esbuild@0.28.2` fixado;
- marco da CJ em 18/06/2026;
- verificações de duplicidade e padrão CREG antes de reaplicar o schema;
- impossibilidade de inferir/corrigir números legados sem fonte oficial;
- recomendação de proteção contra senhas vazadas em plano compatível;
- vínculo apenas por data manual exata;
- retomada multi-ano e republicação por URL nova;
- instalação por `tests/requirements.txt`;
- suítes frontend/assets e novo CI.

### `FLUXO-CJ.md`

Diagramas, exemplos e tabela de falhas passam a refletir:

- botão explícito de backup;
- marco fixo e consulta de vários anos;
- retentativa e republicação;
- data manual sem fallback;
- rederivação que preserva campos manuais;
- constraint e índice CREG;
- mensagens após falha, conflito e reautenticação.

### `.gitignore`

Ignora `supabase/.temp/`, estado local da CLI. A pasta de migrações não é
ignorada e continua versionável.

## 9. Inventário completo arquivo a arquivo

As contagens `+/-` abaixo são as do snapshot original contra `HEAD`.

| arquivo | estado | `+/-` | mudança |
|---|---:|---:|---|
| `.github/workflows/sincronizar-julgados-cj.yml` | modificado | `+4/-4` | actions fixadas/atualizadas, `python -m pip` e ajuda multi-ano |
| `.github/workflows/ci.yml` | novo | `+62/-0` | CI completo para JS, Python, Postgres e minificados |
| `.gitignore` | modificado | `+3/-0` | ignora `supabase/.temp/` |
| `404.html` | modificado | `+2/-1` | base do GitHub Pages e versão de cache |
| `FLUXO-CJ.md` | modificado | `+38/-26` | fluxo técnico alinhado às novas regras |
| `README.md` | modificado | `+43/-10` | instalação, operação, segurança, sync e testes atualizados |
| `assets/js/index.js` | modificado | `+61/-18` | validações, limite, backup explícito, 401, concorrência e foco |
| `assets/js/index.min.js` | modificado | `+1/-1` | artefato regenerado de `index.js` |
| `assets/js/julgados.js` | modificado | `+23/-10` | somente alterações reais e gestão de foco |
| `assets/js/julgados.min.js` | modificado | `+1/-1` | artefato regenerado de `julgados.js` |
| `assets/js/supabase.js` | modificado | `+1/-1` | `ASSET_VERSION` para `20260823-2` |
| `assets/js/supabase.min.js` | modificado | `+1/-1` | artefato regenerado de `supabase.js` |
| `index.html` | modificado | `+8/-7` | botão de backup, alvos de foco, inteiro, cache e versão 1.6 |
| `julgados.html` | modificado | `+5/-5` | alvos de foco e versão de cache |
| `sincronizacao/requirements.txt` | modificado | `+2/-2` | versões Python exatas |
| `sincronizacao/sincronizar.py` | modificado | `+40/-16` | marco fixo, faixa de anos e resumo ampliado |
| `sql/rederivar_cj.sql` | modificado | `+5/-9` | rederivação sem zerar campos manuais |
| `sql/schema.sql` | modificado | `+77/-25` | constraint, índice, marco, derivação, funções e grants |
| `sql/verificacao_cj.sql` | modificado | `+17/-0` | duplicidade e padrão CREG |
| `supabase/migrations/20260823165725_corrigir_integridade_creg_e_privilegios.sql` | novo | `+160/-0` | migração incremental aplicada ao projeto hospedado |
| `sw.js` | modificado | `+1/-1` | novo nome do cache |
| `tests/banco.py` | modificado | `+7/-1` | mock seguro de `auth.uid()` |
| `tests/requirements.txt` | novo | `+2/-0` | dependências consolidadas de teste |
| `tests/test_assets.mjs` | modificado | `+12/-0` | regressão da 404 aninhada |
| `tests/test_cj.py` | modificado | `+285/-11` | migração, integridade, segurança e contadores do runner |
| `tests/test_frontend.mjs` | novo | `+395/-0` | 14 regressões de frontend |
| `tests/test_sincronizacao.py` | modificado | `+158/-2` | marco, retomada multi-ano, republicação e runner |

Arquivos deliberadamente sem alteração, mas integrantes do fluxo de
sincronização: `sincronizacao/agr.py` e `sincronizacao/pauta.py`. A origem HTTPS,
o parser de PDFs e suas restrições permanecem como estavam.

## 10. Estado do Supabase após a aplicação

Na última validação desta rodada, no projeto hospedado de referência
`giipnmpfclfudkzflwsv`:

| verificação | resultado |
|---|---:|
| versão da migração | `20260823165725` |
| nome | `corrigir_integridade_creg_e_privilegios` |
| linhas em `processos_sorteados` | 0 |
| CREG fora do padrão | 0 |
| fixtures exatas de E2E restantes | 0 |
| linhas em `acervo_cj` | 194 |
| linhas em `julgados_cj` | 151 |
| julgados ainda pendentes de voto ou status | 151 |
| constraint de 15 dígitos | validada |
| índice único CREG | ativo |

Os dados reais da CJ foram preservados. Os únicos registros excluídos pela
migração foram os dois CREG de teste listados na seção 5.6. Todos os registros
criados pelos testes ponta a ponta foram removidos depois da validação.

Os grants remotos conferidos coincidem com o schema: `anon` sem tabela;
`authenticated` com os dois `INSERT`, um `SELECT` e somente as duas sequences de
inserção.

## 11. Evidências de validação da rodada

As seguintes verificações foram executadas durante a preparação destas mudanças:

| verificação | resultado |
|---|---|
| suíte frontend | 14/14 |
| suíte do banco | 39/39 executados; 10 testes da planilha local pulados por ausência do arquivo |
| sincronização offline | 39/39; 1 online pulado |
| sincronização com AGR online | 40/40 |
| assets e sorteio aleatório | aprovados |
| equivalência dos minificados | aprovada |
| regeneração com `esbuild@0.28.2` | sem diff residual |
| navegação real em Chrome | páginas, rotas, menus, botões, modais, formulários e fluxos principais validados |
| limpeza pós-E2E | nenhuma fixture exata restante no Supabase |

No fluxo real do CREG foram confirmados:

- inserção válida com resposta 201;
- duplicidade com resposta 409 e rollback do lote;
- backup JSON apenas após clique;
- bloqueio em 500 linhas;
- 404 aninhada resolvendo assets e retorno;
- sessão sem autorização produzindo 401 e recuperação após login.

## 12. Decisões e limitações intencionais

- As tabelas de backup e `pautas_cj` podem aparecer em avisos informativos de
  RLS por não terem políticas permissivas; o efeito desejado é “nega tudo” para
  a API pública.
- `registrar_votos` permanece `SECURITY DEFINER` porque é a única API de escrita
  da tela de julgamentos. O acesso é limitado a `authenticated`, exige identidade
  no JWT e valida o payload.
- A proteção do Supabase contra senhas vazadas não foi ativada porque não está
  disponível no plano Free; deve ser habilitada se o projeto migrar para plano
  compatível.
- `backupPendente` vive somente na memória da página: sobrevive ao login exibido
  no mesmo documento, mas não a recarga ou fechamento da aba. Por isso o botão
  deve ser usado antes de abandonar a página quando a gravação falhar.
- A migração não tenta corrigir duplicidades ou números CREG desconhecidos por
  heurística. Ela para com erro para evitar perda ou adulteração de dado real.
- O teste online da AGR não roda automaticamente no CI para não tornar cada push
  dependente de um serviço externo.

## 13. Orientação de implantação

- Base nova: aplicar `sql/schema.sql`.
- Base hospedada existente: manter a migração
  `20260823165725_corrigir_integridade_creg_e_privilegios.sql` no histórico; ela
  já expressa o delta deste conjunto.
- Antes de reaplicar o schema sobre outra base CREG populada, executar
  `sql/verificacao_cj.sql` e resolver qualquer `ERRO` de duplicidade ou número
  inválido pela fonte oficial.
- Publicar juntos HTML, service worker, fontes JS e minificados; todos usam a
  versão `20260823-2`.
- Incluir no mesmo commit o workflow de CI e `tests/requirements.txt`.

Este documento registra o diff e o estado validado. Sua criação, por si só, não
faz commit, push nem nova publicação da aplicação.
