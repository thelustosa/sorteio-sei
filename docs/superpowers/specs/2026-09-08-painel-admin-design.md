# Painel administrativo

## Contexto

O sistema grava três coisas: a distribuição de um processo (`acervo_cj` /
`acervo_creg`), o processo levado a uma sessão (`julgados_cj` /
`julgados_creg`) e a pauta publicada pela AGR que originou o julgado
(`pautas_cj` / `pautas_creg`, escrita pelo job de `sincronizacao/`).

Para o navegador, o banco é hoje quase append-only: o acervo aceita apenas
`INSERT`, os julgados apenas `SELECT`, e a única escrita é
`registrar_votos` / `registrar_votos_creg`, que toca só `voto` e `status` e
nunca apaga — o `coalesce` da função existe justamente para que campo em branco
não zere uma decisão já gravada.

Corrigir qualquer erro exige, portanto, SQL direto no banco por uma identidade
privilegiada. O próprio schema registra que essa lacuna era conhecida e que a
solução seria esta:

> DESFAZER um registro é decisão administrativa, e vai ter porta própria — um
> painel de admin com permissão que a secretaria não tem.
> — `sql/schema.sql`, em `registrar_votos` e `registrar_votos_creg`

Este documento especifica essa porta.

## Escopo

Entram na primeira versão:

- correção de dados da **sessão** (julgados): voto, status, data da sessão e
  número da pauta, inclusive **desfazer** (voltar um campo a vazio), que hoje é
  impossível por desenho;
- correção de dados do **sorteio** (acervo): relator/unidade, data de
  distribuição, assunto, defesa/recurso e ordem;
- correção do **número do processo**, em escopo escolhido pelo administrador;
- **religação** de um julgado ao acervo, que hoje só existe como
  `sql/rederivar_cj.sql` rodado à mão;
- registro de auditoria de tudo isso.

Ficam de fora, como decisão consciente e não como omissão:

- **exclusão** de registros. Julgado duplicado e distribuição repetida são ERROs
  em `sql/verificacao_cj.sql` que o painel passa a exibir mas não conserta;
  continuam exigindo SQL direto;
- **inclusão** manual de registros. Processo que apareceu na pauta e não tem
  distribuição (`pautas_*.processos_sem_acervo`) e pauta republicada pela AGR
  continuam exigindo SQL direto;
- **gestão de usuários**. Conceder o papel de administrador segue sendo operação
  privilegiada de banco, como a spec de controle de acesso por órgão
  estabeleceu.

## Autorização

### Papel

`public.permissoes_usuario` ganha uma coluna, e não uma tabela nova:

```sql
alter table public.permissoes_usuario
  add column if not exists papel text not null default 'operador'
    check (papel in ('operador', 'admin'));
```

A chave primária `(user_id, orgao)` não muda. As linhas existentes nascem como
`operador`: nenhum usuário atual ganha poder por efeito colateral da migração.

`tem_acesso_orgao()` permanece idêntica — qualquer papel dá acesso ao órgão —,
de modo que todas as policies e RPCs de hoje seguem valendo sem alteração.
Entram duas funções irmãs, `security invoker`, com `search_path` explícito e
`execute` concedido apenas a `authenticated`:

- `e_admin_orgao(p_orgao text) → boolean`, usada pelas policies e por toda RPC
  administrativa;
- `orgaos_administrados() → setof text`, usada pela interface para montar o
  seletor de órgão.

O papel de administrador é atribuído a `lucas.coelho@goias.gov.br` e
`sec-agr@goias.gov.br`, nos dois órgãos. A migração localiza os usuários pelo
e-mail e falha com mensagem clara se algum não existir, evitando implantação
parcialmente autorizada — mesma regra da migração de controle de acesso.

Alternativa descartada: representar o papel como `orgao = 'CJ:ADMIN'`. O
`check (orgao in ('CJ','CREG'))` e o retorno de `orgaos_autorizados()` são
consumidos por `bootstrap.js`, pelas policies e por `tests/test_acesso.py`; um
valor composto contaminaria os três.

### Interface

`admin.html` é a primeira página sem órgão fixo. Ela entra em `PAGINAS` de
`bootstrap.js` com a marca `exigeAdmin` no lugar de `orgao`. Quando a marca está
presente, o bootstrap consulta `orgaos_administrados()` depois de
`orgaos_autorizados()`; conjunto vazio cai no `erroSemPermissao()` já existente,
que encerra a sessão e volta ao login com mensagem.

A consulta extra acontece somente em `admin.html` e em `index.html` — nesta para
decidir se o link do painel aparece, por um marcador `data-admin` análogo ao
`data-orgao` de hoje. As demais páginas seguem com uma consulta só.

Esconder o link é conveniência. Quem recusa é o banco, em toda RPC, com
`42501`.

## Auditoria

```sql
create table public.auditoria_admin (
  id          bigint generated always as identity primary key,
  orgao       text        not null check (orgao in ('CJ','CREG')),
  operacao    text        not null,
  tabela      text        not null,
  registro_id bigint      not null,
  antes       jsonb       not null,
  depois      jsonb       not null,
  motivo      text,
  feito_por   text        not null,
  feito_em    timestamptz not null default now()
);
```

`antes` e `depois` guardam apenas as colunas tocadas, não a linha inteira: o
registro fica legível e `interessado` — nome de pessoa física — não é despejado
em toda correção de um repositório público.

A tabela tem RLS com uma única policy, de `SELECT`, para quem é administrador do
órgão da linha. **Não existe policy de INSERT**: nem o administrador escreve
nela pelo PostgREST. Quem grava é o helper interno `auditar(...)`, chamado pelas
RPCs `SECURITY DEFINER`, que rodam como dono e passam por cima da RLS. A tabela
é append-only por construção, não por convenção.

Um registro tocado, uma linha de auditoria: corrigir uma distribuição
propagando para dois julgados grava três linhas na mesma transação.

Índices: `(orgao, feito_em desc)` para a tela de histórico, e
`(tabela, registro_id)` para responder "o que já mexeram neste registro".

## Leitura

As RPCs existentes não servem ao painel: `historico_sorteios` e
`processos_sorteio` filtram `origem = 'sorteio'`, cortam em `historico_marco()`
e não devolvem o `id` da linha. Entram seis funções `stable`,
`security definer`, recebendo `p_colegiado` — a regra que o projeto já segue é
leitura compartilhada entre colegiados, escrita separada.

| Função | Devolve |
| --- | --- |
| `admin_sessoes(p_colegiado)` | uma linha por sessão: data, pauta, total, quantos sem voto ou status |
| `admin_processos_sessao(p_colegiado, p_data_sessao)` | `id`, número, voto, status, destino, data de distribuição, `acervo_id`, quem atualizou e quando |
| `admin_sorteios(p_colegiado)` | uma linha por rodada: data, carimbo, origem, total, destinos |
| `admin_processos_acervo(p_colegiado, p_data, p_sorteado_em)` | `id`, ordem, número, destino, assunto, decisão, interessado, origem |
| `admin_julgados_do_acervo(p_colegiado, p_acervo_id)` | os julgados que copiaram aquela distribuição — o preview de impacto |
| `admin_auditoria(p_colegiado, p_limite, p_antes_de)` | o rastro, mais recente primeiro, paginado por cursor |

`admin_sorteios` agrupa por `(data_distribuicao, sorteado_em, origem)`: uma data
pode ter rodada do sorteio eletrônico e registro importado de ata, e fundi-las
esconderia justamente a linha que precisa de conserto.

Como a busca é por data — de sessão ou de sorteio — e nunca por número, um
processo com o número errado continua acessível. Era o requisito que descartou a
busca por `num_processo` como porta principal.

## Escrita

### Como "não mexer" se distingue de "apagar"

Toda RPC de correção recebe `p_campos jsonb` com apenas as chaves que mudam.
Chave ausente significa não mexer; chave presente com `null` significa apagar;
chave fora da allowlist da operação é erro `22023`. É o mesmo idioma de
`registrar_votos(itens jsonb)`, e é o que viabiliza o desfazer que o `coalesce`
daquela função impede.

### Catálogo

Cada operação existe em par, uma por colegiado, seguindo
`registrar_votos`/`registrar_votos_creg`. O vocabulário muda com o colegiado:
`relator`/`defesa` na Câmara, `unidade`/`recurso`/`interessado` no Conselho.

**`admin_corrigir_julgado_*(p_id, p_campos, p_motivo)`** — allowlist `voto`,
`status`, `data_sessao`, `pauta`. Valida os rótulos contra as mesmas listas de
`registrar_votos`, recusa data de sessão futura e pauta menor ou igual a zero.

`data_sessao` está na cláusula `update of` do gatilho de derivação, que executa
`new.acervo_id := origem.id` incondicionalmente. `relator`, `defesa` e
`data_distribuicao` sobrevivem pelo `coalesce`, mas o vínculo é reatribuído:
corrigir a data de uma sessão pode religar o julgado a outra distribuição sem
que ninguém tenha pedido, que é o AVISO "Data de distribuição divergente do
acervo vinculado" de `sql/verificacao_cj.sql`. A RPC não bloqueia — a
rederivação em geral está certa —, mas lê `acervo_id` antes e depois, grava os
dois na auditoria e os devolve no retorno, para que a tela informe que o vínculo
mudou. Silêncio aqui produziria exatamente a inconsistência que a operação
pretende evitar.

**`admin_religar_julgado_*(p_id, p_motivo)`** — grava `null` nos campos
derivados e deixa o gatilho rederivá-los do acervo, técnica que o próprio schema
documenta. Cura os AVISOs "Relator divergente do acervo vinculado" e "Defesa
divergente do acervo vinculado".

**`admin_corrigir_acervo_*(p_id, p_campos, p_motivo)`** e
**`admin_redistribuir_*(p_id, p_campos, p_motivo)`** — allowlist `relator` /
`unidade`, `data_distribuicao`, `assunto`, `defesa` / `recurso`, `ordem` e, no
Conselho, `interessado`. As duas chamam o mesmo corpo interno; o que muda é a
propagação e o rótulo gravado em `auditoria_admin.operacao`.

A primeira propaga: os julgados vinculados àquela distribuição recebem os novos
valores na mesma transação, com uma linha de auditoria cada. A segunda não
propaga: o julgado preserva o relator que de fato levou o processo à mesa.

A intenção mora no nome da função, e não num booleano escolhido pelo cliente.
Assim o rastro registra o que o administrador declarou ter feito, e não é
possível redistribuir alegando correção.

**`admin_corrigir_processo_*(p_num_atual, p_num_novo, p_escopo, p_motivo)`** —
para o caso em que o próprio número está errado. Valida quinze dígitos nos dois
colegiados; o `check` existe em `acervo_creg` e não na Câmara, e a RPC exige nos
dois. `p_escopo` aceita `tudo`, `acervo` ou `julgados`.

A ordem é obrigatória: **acervo primeiro, julgados depois**. `num_processo`
também está na cláusula `update of` do gatilho; renumerar os julgados antes
faria o gatilho procurar o número novo num acervo que ainda não o tem, zerando
`acervo_id` de todos eles.

### Regras comuns

- cabeçalho `auth.uid()` → `auth_email()` → `e_admin_orgao(orgao)`, com `28000`
  para sessão ausente e `42501` para falta de permissão, idêntico às RPCs de
  hoje;
- `select ... for update` na linha antes de ler o estado anterior, para que duas
  correções simultâneas não gravem a mesma foto;
- `unique_violation` capturada e devolvida como mensagem legível: mudar a data de
  uma sessão pode colidir com `julgados_*_sessao_unica`, e mudar relator ou data
  no acervo com `acervo_*_distribuicao_unica`;
- `revoke all ... from public, anon, service_role` e `grant execute` a
  `authenticated`, como todas as demais;
- uma chamada PostgREST é uma transação, logo correção, propagação e auditoria
  são atômicas sem esforço adicional.

## Interface

`admin.html`, uma página só, com seletor de órgão — apenas os órgãos em que o
usuário é administrador aparecem — e três abas: **Sessões**, **Sorteios** e
**Auditoria**.

O fluxo é o mesmo nas duas primeiras: escolher a data na lista, ver os registros
daquela data, abrir um registro, editar os campos permitidos, confirmar. A
confirmação é um `<dialog>` nativo, componente que `acervo-cj.html` e
`historico-cj.html` já usam, e mostra o que muda de quê para quê. Na correção de
acervo, mostra também os julgados que serão afetados, vindos de
`admin_julgados_do_acervo`.

O feedback usa o toast `aviso(texto, tipo)` de `supabase.js`, com `sucesso` e
`erro` já definidos. Nenhum componente visual novo é criado: o painel reúsa
`.card`, `.table-scroll`, `.button-secondary`, `.empty-state` e a barra verde de
navegação, mantendo a identidade do portal do Estado de Goiás documentada em
`DESIGN.md`.

`admin.js` entra em `FONTES` e `admin.html` em `PAGINAS` de
`tools/versionar.mjs`, e o arquivo minificado no laço do CI, para que a
conferência de artefatos sincronizados cubra o painel.

## Testes

### Banco (`tests/test_admin.py`, Postgres em container)

- matriz de papéis: administrador, operador e usuário sem acesso, contra cada
  RPC nova, exigindo sucesso onde é permitido e `42501` onde não é;
- `e_admin_orgao` e `orgaos_administrados` para cada identidade;
- operador continua com todo o acesso de hoje e nenhum a mais;
- allowlist de campos: chave desconhecida gera `22023`;
- desfazer: chave presente com `null` apaga o campo, e chave ausente não o toca;
- rótulo de voto ou status fora da lista é recusado;
- colisão de chave única em julgado e em acervo devolve erro tratado;
- propagação: `admin_corrigir_acervo_*` atualiza os julgados vinculados;
  `admin_redistribuir_*` não os toca;
- religação de vínculo pela rederivação;
- correção de número de processo nos três escopos, com o acervo antes dos
  julgados, verificando que `acervo_id` não é zerado;
- mudança de vínculo ao corrigir `data_sessao` é registrada em `antes`/`depois` e
  devolvida no retorno;
- auditoria: uma linha por registro tocado, com autor, horário e delta corretos;
  administrador não consegue inserir, alterar nem excluir na tabela; operador não
  a lê;
- `sql/verificacao_cj.sql` e `sql/verificacao_creg.sql` sem novos ERROs depois de
  cada correção;
- reaplicação de `sql/schema.sql` e equivalência com a cadeia de migrações.

### Interface (`tests/test_admin.mjs`, DOM mínimo)

- o seletor mostra apenas os órgãos administrados;
- o gate do bootstrap: sem papel de administrador, o módulo não carrega e a
  sessão é encerrada;
- navegação entre abas e listas por data;
- o diálogo de confirmação aparece antes de qualquer gravação e exibe o delta;
- o preview de impacto lista os julgados afetados na correção de acervo;
- feedback de sucesso e de erro pelo toast;
- presença do marcador `data-admin` no link do painel.

Todos os testes novos são escritos e executados em vermelho antes da
implementação correspondente, e as suítes existentes rodam ao final, junto com a
geração dos artefatos minificados e versionados.

## Implantação

1. testes e migração local;
2. código da interface e artefatos minificados e versionados;
3. suíte completa local;
4. aplicação da migração no projeto Supabase `sorteio-sei`;
5. verificação da matriz de papéis, das policies, dos privilégios e das funções;
6. advisors de segurança e desempenho.

O banco precede a interface: uma versão antiga do frontend não alcança nenhuma
porta nova durante a transição.

## Critérios de conclusão

- somente `lucas.coelho@goias.gov.br` e `sec-agr@goias.gov.br` acessam o painel,
  nos dois órgãos;
- Alberto e Terezinha mantêm exatamente o acesso de hoje, sem ganhar nenhuma
  porta administrativa, nem pela interface nem diretamente pela API;
- é possível corrigir e desfazer dados de sessão e de sorteio nos dois
  colegiados;
- toda correção deixa linha de auditoria com autor, horário e valores anterior e
  posterior;
- correção do acervo propaga aos julgados vinculados quando declarada como
  correção, e não propaga quando declarada como redistribuição;
- nenhuma correção deixa `verificacao_cj.sql` ou `verificacao_creg.sql` com ERRO
  novo;
- os testes cobrem as decisões positivas e negativas nas duas camadas;
- o schema local e o banco hospedado refletem a mesma regra.
