# Controle de acesso por órgão

## Contexto

O sistema é uma aplicação web estática que usa Supabase Auth e acessa o banco
por PostgREST. As páginas e os dados são separados entre Câmara de Julgamento
(`CJ`) e Conselho Regulador (`CREG`), mas hoje todos os usuários com o papel
Supabase `authenticated` recebem os mesmos privilégios. As políticas atuais
permitem inserir nos dois acervos e ler os julgados dos dois órgãos, enquanto
as funções `SECURITY DEFINER` verificam apenas a existência de uma sessão.

A autorização deve valer em duas camadas independentes:

1. a interface mostra e carrega somente páginas do órgão permitido;
2. o banco recusa consultas e alterações do outro órgão mesmo quando a chamada
   é feita diretamente à API, sem passar pela interface.

## Matriz inicial de permissões

| Usuário | CJ | CREG |
| --- | --- | --- |
| `alberto.estrela@goias.gov.br` | não | sim |
| `terezinha.bueno@goias.gov.br` | sim | não |
| `lucas.coelho@goias.gov.br` | sim | sim |
| `sec-agr@goias.gov.br` | sim | sim |

Um usuário autenticado sem cadastro explícito não acessa nenhum módulo. Isso
evita que a simples criação de uma conta abra automaticamente os dados dos dois
órgãos.

## Fonte de autorização

Será criada a tabela `public.permissoes_usuario`, com uma linha para cada par
`(user_id, orgao)`. O identificador referencia `auth.users(id)`, e `orgao` aceita
somente `CJ` ou `CREG`. A chave primária composta impede permissões duplicadas.

A migração cadastra a matriz inicial procurando os usuários pelo e-mail e
gravando os respectivos UUIDs. UUIDs gerados pelo Supabase não serão fixados no
arquivo. A migração falhará com uma mensagem clara se algum dos quatro e-mails
esperados não existir, evitando uma implantação parcialmente autorizada.

A tabela terá RLS habilitada. O papel `authenticated` poderá apenas selecionar
as próprias linhas (`user_id = auth.uid()`); não poderá inserir, alterar ou
excluir permissões. Administração de permissões continuará sendo uma operação
de banco feita por uma identidade privilegiada.

Duas funções pequenas concentrarão a leitura:

- `orgaos_autorizados()` retorna os órgãos do usuário atual para a interface;
- `tem_acesso_orgao(orgao)` retorna um booleano usado pelas políticas e pelas
  RPCs protegidas.

As funções serão `SECURITY INVOKER`, terão `search_path` explícito e execução
concedida somente a `authenticated`. A decisão não dependerá de
`user_metadata`, de e-mail enviado pelo navegador nem de estado visual.

## Proteção no banco

As políticas permissivas atuais serão substituídas por políticas específicas:

- `acervo_cj`: inserção somente com permissão `CJ`;
- `julgados_cj`: leitura somente com permissão `CJ`;
- `acervo_creg`: inserção somente com permissão `CREG`;
- `julgados_creg`: leitura somente com permissão `CREG`.

Os privilégios SQL mínimos existentes permanecem; a RLS decide se a operação é
autorizada. As sequências não expõem dados e continuam utilizáveis apenas para
as inserções que já passaram pela política da tabela.

As funções `SECURITY DEFINER` acessam tabelas sem se submeter à RLS. Por isso,
cada porta pública receberá uma verificação explícita antes de ler ou alterar
dados:

- CJ: `registrar_votos`, `resumo_acervo_cj` e `processos_acervo_cj`;
- CREG: `registrar_votos_creg`, `resumo_acervo_creg` e
  `processos_acervo_creg`;
- compartilhadas: `historico_sorteios` e `processos_sorteio` validarão o órgão
  informado em `p_colegiado`.

Uma tentativa sem permissão lançará `insufficient_privilege` (`SQLSTATE
42501`). As verificações atuais de sessão, formato de parâmetros e regras de
negócio continuarão valendo.

Jobs de sincronização que se conectam diretamente ao Postgres e rotinas de
manutenção privilegiadas não usam o papel `authenticated`; portanto, não serão
afetados pelas restrições dos usuários da aplicação.

## Autorização na interface

Após autenticar ou restaurar a sessão, `bootstrap.js` chamará
`orgaos_autorizados()` antes de carregar o JavaScript funcional da página. A
resposta ficará apenas em memória durante a sessão atual.

Na página inicial, cada botão ou link de CJ/CREG será marcado com `data-orgao`.
Os elementos cujo órgão não estiver autorizado serão ocultados antes da
inicialização do sorteio. Usuários autorizados nos dois órgãos continuarão
vendo a interface atual completa.

As páginas específicas já informam o módulo por `body[data-page]`. O bootstrap
usará esse valor para validar o acesso. Quando um usuário abrir diretamente uma
URL não autorizada, será usado `location.replace` para a página equivalente do
órgão permitido:

| Página solicitada | Redirecionamento para CJ | Redirecionamento para CREG |
| --- | --- | --- |
| sorteio | `index.html` | `index.html` |
| acervo | `acervo-cj.html` | `acervo-creg.html` |
| julgados | `julgados-cj.html` | `julgados-creg.html` |
| histórico | `historico-cj.html` | `historico-creg.html` |

Se o usuário tiver mais de um órgão, a página solicitada será mantida quando
ela pertencer a qualquer um deles. Se não tiver permissão alguma, o sistema não
carregará código nem dados protegidos, encerrará a sessão local e apresentará
no login a mensagem de que o usuário não possui acesso liberado.

Falhas de rede ao consultar permissões não serão interpretadas como ausência de
acesso: a aplicação manterá o estado de erro já usado pelo carregamento, sem
abrir o módulo, e permitirá nova tentativa. Respostas 401 continuarão usando a
renovação de sessão existente.

## Testes

### Banco

O ambiente Postgres descartável ganhará usuários de autenticação fictícios e
permissões equivalentes à matriz. Os testes executarão chamadas como o papel
`authenticated`, trocando o `sub` das claims para representar cada usuário.

Serão cobertos:

- leitura das próprias permissões e impossibilidade de ler as de terceiros;
- inserção no acervo permitido e bloqueio no acervo oposto;
- leitura de julgados permitida e bloqueada no órgão oposto;
- sucesso e `42501` em todas as RPCs específicas;
- sucesso e bloqueio das RPCs compartilhadas conforme `p_colegiado`;
- usuário autenticado sem permissão, usuário anônimo e parâmetros inválidos;
- reaplicação do `schema.sql` e equivalência com a cadeia de migrações.

### Interface

Testes JavaScript exercerão as funções reais de autorização com um DOM mínimo.
Eles verificarão:

- a matriz página/órgão e os destinos equivalentes;
- ocultação de todos os controles do órgão proibido;
- preservação dos controles para usuários com os dois órgãos;
- carregamento do módulo somente após autorização;
- redirecionamento por acesso direto a acervo, julgados e histórico;
- tratamento de usuário sem permissão e de falha na consulta;
- presença dos marcadores `data-orgao` em todas as opções relevantes.

Todos os testes novos serão escritos e executados em estado vermelho antes da
implementação correspondente. Ao final serão executadas as suítes Python e
Node existentes, a geração dos arquivos minificados/versionados e a checagem
de que os artefatos gerados estão sincronizados.

## Implantação e verificação

A alteração seguirá esta ordem:

1. testes e migração local;
2. código-fonte da interface e artefatos minificados/versionados;
3. suíte completa local;
4. aplicação da migração no projeto Supabase `sorteio-sei`;
5. consulta de verificação da matriz, políticas, privilégios e funções;
6. execução dos advisors de segurança e desempenho;
7. teste autenticado de permissão permitida e negada quando houver credenciais
   de teste disponíveis, complementado pelos testes de integração local.

A implantação do banco precede a publicação da interface. Assim, uma versão
antiga do frontend não consegue usar o órgão proibido durante a transição. A
migração será registrada tanto em `supabase/migrations` quanto no ledger do
projeto hospedado, mantendo a convenção atual do repositório.

## Critérios de conclusão

O trabalho estará concluído somente quando:

- Alberto não puder usar CJ nem pela interface nem diretamente pela API;
- Terezinha não puder usar CREG nem pela interface nem diretamente pela API;
- ambos puderem usar integralmente o próprio órgão;
- Lucas e `sec-agr` mantiverem acesso integral a CJ e CREG;
- opções não autorizadas estiverem ocultas;
- URLs não autorizadas redirecionarem para a página equivalente permitida;
- usuários sem permissão não carregarem módulos nem dados;
- os testes automatizados cobrirem as decisões positivas e negativas nas duas
  camadas;
- o schema local e o banco hospedado refletirem a mesma regra.
