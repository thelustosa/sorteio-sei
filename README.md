# Sorteador de Processos SEI

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)

Aplicação web estática desenvolvida para a **Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos (AGR)**, atendendo o **Conselho Regulador** (modo CREG) e a **Câmara de Julgamento** (modo CJ) na distribuição eletrônica e igualitária de processos do SEI, gestão de acervo, registro de julgamentos, consulta de histórico de sorteios e manutenção administrativa.

Acesse a aplicação online em: [https://thelustosa.github.io/sorteio-sei/](https://thelustosa.github.io/sorteio-sei/)

| Tela de Início | Interface do Sorteador |
| :---: | :---: |
| ![Tela de Início](assets/img/screenshot_start.png) | ![Interface do Sorteador](assets/img/screenshot.png) |

---

## Auditoria e Transparência

Este repositório é público e totalmente aberto para auditoria dos sorteios. Caso surjam quaisquer dúvidas em relação à integridade da divisão dos processos, qualquer interessado pode inspecionar o código-fonte da lógica de distribuição para verificar a conformidade, impessoalidade e igualdade matemática das regras aplicadas (algoritmo Fisher-Yates com `crypto.getRandomValues`, sem viés de módulo e com balanceamento proporcional cruzado por assunto).

O Termo de Entrega oficial do projeto para a Agência Goiana de Regulação (AGR) está disponível para consulta em: [SEI_93024891_Termo_de_Entrega_1.pdf](documentos/SEI_93024891_Termo_de_Entrega_1.pdf).

---

## Funcionalidades

- **Autenticação e Controle de Acesso por Órgão**: o acesso ao sistema é restrito a servidores autorizados, com controle granular por órgão (`CREG`, `CJ` ou `ambos`) e papel de usuário (`admin` ou operador) gerenciados na tabela `permissoes_usuario`.
  - A tela de login apresenta contexto visual e textual específico para o destino solicitado.
  - O menu inicial ajusta dinamicamente a exibição e o posicionamento dos botões conforme os órgãos autorizados para o usuário logado.
  - A segurança é garantida em duas camadas: controle de interface em `bootstrap.js` e validação no banco de dados via RPCs `SECURITY DEFINER` e políticas de Row Level Security (RLS) que consultam `orgaos_autorizados()`. As senhas são tratadas com segurança diretamente pelo Supabase Auth.
- **Geração Dinâmica de Linhas**: Permite definir a quantidade inicial de processos a serem cadastrados na tabela (de 1 a 500 processos).
- **Inserção e Exclusão Flexíveis**: 
  - Adicione novas linhas a qualquer momento utilizando o botão **Adicionar linha** sem perder os dados já preenchidos.
  - Exclua linhas geradas incorretamente de forma individual clicando no botão **×** no final da linha.
- **Distribuição Igualitária**:
  - Garante que cada unidade ou cadeira receba a mesma quantidade total de processos.
  - Realiza o balanceamento proporcional e cruzado de cada **Assunto** individualmente, evitando que uma unidade receba apenas um tipo de assunto de processo.
  - Utiliza o algoritmo Fisher-Yates impulsionado por `crypto.getRandomValues()` com descarte de resto para eliminar viés de módulo.
- **Exclusão de Unidades**: Seleção simples das unidades que NÃO vão participar da rodada de distribuição através de filtros de exclusão visual (pills).
- **Validação Completa**: Impede a realização do sorteio caso existam campos em branco na tabela, formatos inválidos ou números de processo SEI repetidos, indicando as linhas em conflito.
- **Regras Específicas por Colegiado**:
  - **Câmara de Julgamento (CJ)**: todo processo é Auto de Infração (campo pré-fixado e travado, eliminando erro de digitação); a 6ª coluna registra se houve **Defesa** (Sim/Não) — dado herdado pelos julgamentos do acervo; os destinos correspondem às cadeiras `CJ1`..`CJ5`, mapeadas para os conselheiros relatores via `cadeiras_cj`. Processo com **Defesa = "Não"** não participa do sorteio: vai sempre para a `CJ1`, que é quem recebe o lote de homologação de auto de infração — e a `CJ1` recebe **só** esse lote. Os processos com defesa são sorteados entre as demais cadeiras (`CJ2`..`CJ5`). A pill da `CJ1` continua na tela, mas fixa — não pode ser excluída, porque não participa do sorteio; um lote todo sem defesa é distribuído mesmo com `CJ2`..`CJ5` excluídas.
  - **Conselho Regulador (CREG)**: 11 assuntos disponíveis; **Travamento de Recurso Inteligente** que define automaticamente o campo como "Não se aplica" e o desabilita caso o assunto selecionado não seja "Auto de Infração"; campo adicional para identificação do **Interessado**; os destinos correspondem às unidades `CREG1`..`CREG4`.
- **Exportação da Ata em Word**: geração automática da ata de distribuição em formato Word (`.doc`), nomeada dinamicamente (`Sorteio_CREG_DD.MM.AAAA.doc`). A ata traz cabeçalho institucional e as mesmas colunas da tela — ordem, processo, interessado (se houver), assunto, recurso (ou defesa, na CJ) e unidade sorteada — permitindo conferência da repartição por assunto sem depender do sistema.
- **Registro de Julgamentos e Monitor de Pendências**:
  - Páginas dedicadas ([julgados-cj.html](julgados-cj.html) e [julgados-creg.html](julgados-creg.html)) onde a secretaria abre uma pauta e preenche o voto e o status de cada processo deliberado em sessão.
  - **Aviso visual de pendências**: o card da tela principal monitora em tempo real processos sem voto ou sem status e exibe um alerta visual pulsante e badge com a contagem de pendências.
  - Processos chegam automaticamente das pautas publicadas pela AGR via rotina de sincronização, e o registro do voto/status anota auditoria de autoria e horário (`atualizado_por` e `atualizado_em`) via RPC protegida `registrar_votos`.
- **Acervo de Processos**:
  - Painéis de consulta ([acervo-cj.html](acervo-cj.html) e [acervo-creg.html](acervo-creg.html)) para acompanhamento dos processos distribuídos que aguardam deliberação.
  - Organização por faixas de permanência (menos de 30 dias, 30 a 60 dias, 60 a 90 dias, mais de 90 dias) e opções de exportação do acervo em planilha Excel (`.xlsx`) e documento PDF.
- **Histórico de Sorteios**:
  - Páginas dedicadas ([historico-creg.html](historico-creg.html) e [historico-cj.html](historico-cj.html)) acessíveis por botão na tela principal.
  - A lista traz uma rodada por linha, da mais recente para a mais antiga, com data, dia da semana, horário, quantidade total de processos e a distribuição detalhada por destino com sua respectiva contagem (ex.: `CJ1: 3`, `CJ2: 3`...), cuja soma compõe o total da linha.
  - Clicar em **Ver processos** abre a rodada completa (ordem, processo, destino sorteado, relator da época na CJ, interessado no CREG, assunto e defesa/recurso).
  - Clicar na sigla de um destino abre o modal já filtrado exclusivamente para aquele destino.
  - **Exportação em Word (.docx)**: exporta os processos exibidos no modal em arquivo `.docx` nos moldes oficiais de ata da AGR (cabeçalho institucional, texto de abertura com data por extenso e tabela formatada), gerado diretamente no navegador via WordprocessingML sem bibliotecas externas.
  - O sorteio grava o resultado diretamente no acervo (`acervo_cj` e `acervo_creg`) com `origem = 'sorteio'`, entrando no histórico automaticamente a partir do marco inicial de `2026-08-27`. A antiga tabela provisória `processos_sorteados` foi completamente descontinuada.
- **Painel Administrativo**: área restrita a administradores, em [admin.html](admin.html), para efetuar manutenções e correções em registros de sorteios e julgamentos já gravados — eliminando a necessidade de intervenções manuais via SQL direto.
  - Cobre os dois colegiados com seletor de órgão na própria página e navegação por data de sessão de julgamento ou rodada de sorteio.
  - Operações atômicas com allowlist e validação rigorosa: corrigir voto, status, data da sessão e número da pauta (inclusive **desfazer**, retornando campos para vazio/null); corrigir distribuição gravada pelo sorteio; religar julgados ao acervo; corrigir número de processo (com propagação atômica para todos os registros que compartilham o número incorreto); e redistribuir processos preservando o histórico do julgado.
  - Confirmação em duas etapas detalhando exatamente o impacto antes da gravação.
  - Aba **Meta 45**: julgados com status `Julgado` dentro e fora da meta de 45 dias (da distribuição à sessão), por mês, bimestre, trimestre, quadrimestre ou semestre, com filtro de ano e um resumo do ano. Julgado sem data de distribuição, ou com sessão anterior a ela, aparece à parte como sem prazo aferível e fica fora do percentual. Lê a RPC `admin_meta_45`, que usa a coluna gerada `meta_45` das duas tabelas de julgados.
  - Trilha de auditoria append-only em `auditoria_admin` gravada na mesma transação por funções `SECURITY DEFINER`, com consulta paginada de 100 em 100 registros na aba **Auditoria**.
- **Registro no Banco de Dados e Resiliência**: ao final do sorteio, os dados são gravados no banco (Supabase/PostgreSQL) no acervo correspondente. Em caso de instabilidade na conexão ou banco não configurado, a interface disponibiliza download do sorteio completo em `.json` como alternativa segura de contingência.

---

## Design e Cores

O visual foi desenvolvido com base na identidade visual institucional do portal do **Estado de Goiás**:
- **Paleta de Cores**: Uso do verde institucional (`#00534b`) como cor principal de realce e botões, fundo de tela branco, painel interno em tom de verde menta claro (`#E9F5EC`) e tokens de cores temáticas para cada card de serviço.
- **Rodapé Institucional**: Banner verde com logotipo oficial do Estado de Goiás, versão atual da aplicação (Versão 3.9.2), créditos e informações de integridade e auditoria do sorteio.
- **Tipografia**: Títulos e elementos de destaque em **Montserrat**, complementados pela tipografia nativa do sistema operacional para o corpo de texto.

---

## Estrutura de Arquivos

As páginas ficam na raiz porque é de lá que o GitHub Pages serve o site —
`index.html` é a porta de entrada e `404.html` é o que o Pages procura quando o
endereço não existe. Todo o resto está agrupado por natureza.

```text
├── index.html              sorteio de processos (entrada do site)
├── julgados-cj.html        registro do voto e do status (Câmara)
├── julgados-creg.html      registro do voto e do status (Conselho)
├── acervo-cj.html          painel do acervo (Câmara)
├── acervo-creg.html        painel do acervo (Conselho) — mesmo acervo.js
├── historico-cj.html       histórico de sorteios (Câmara)
├── historico-creg.html     histórico de sorteios (Conselho) — mesmo historico.js
├── admin.html              painel administrativo (os dois colegiados, seletor dentro)
├── 404.html                página de endereço inexistente
│
├── assets/
│   ├── css/index.css       fonte legível do design de todas as páginas
│   ├── css/index.min.css   versão otimizada servida pelo site
│   ├── js/
│   │   ├── bootstrap.js    carregamento sob demanda, verificação de sessão e controle de acesso
│   │   ├── index.js        fonte da lógica do sorteio, validação e ata
│   │   ├── julgados.js     fonte do registro de julgamentos da Câmara
│   │   ├── julgados-creg.js  o mesmo, para o Conselho Regulador
│   │   ├── acervo.js       fonte do painel do acervo dos dois colegiados
│   │   ├── historico.js    fonte do histórico de sorteios dos dois colegiados
│   │   ├── admin.js        fonte do painel administrativo dos dois colegiados
│   │   ├── supabase.js     cliente Supabase, autenticação, permissões por órgão e chamadas de API
│   │   └── *.min.js        versões otimizadas servidas pelo site
│   ├── fonts/              arquivos de fonte Montserrat em .woff2
│   └── img/                logotipos, favicon e as capturas de tela do README
│
├── sql/                      tudo que roda no SQL Editor do Supabase
│   ├── schema.sql            tabelas, gatilho, função de registro e RLS
│   ├── verificacao_cj.sql    conferência de consistência da CJ — só lê
│   ├── verificacao_creg.sql  a mesma conferência para o CREG — só lê
│   ├── rederivar_cj.sql      religa ao acervo os julgados que entraram sem ele
│   ├── rederivar_creg.sql    o mesmo, para o Conselho Regulador
│   ├── backup_cj.sql         copia as tabelas da CJ para o schema backup_cj
│   ├── restaurar_cj.sql      a volta do backup
│   ├── backup_pre_mesclagem_cj.sql  foto da CJ antes de trazer o histórico de volta
│   ├── mesclar_historico_cj.sql     soma o histórico de backup_cj à nova série
│   └── desfazer_mesclagem_cj.sql    tira só o que a mesclagem trouxe
│
├── supabase/migrations/    histórico aplicado ao projeto hospedado
├── sincronizacao/          job que lê as pautas da AGR (roda no GitHub Actions)
├── dados/                  conversão das planilhas e das atas de sorteio em SQL
├── documentos/             Termo de Entrega oficial do projeto
├── tools/versionar.mjs     grava nos assets a versão derivada do conteúdo
└── tests/                  suítes automatizadas e dependências de teste
```

O `supabase/migrations/` e o ledger do projeto hospedado
(`supabase_migrations.schema_migrations`) têm de ter as MESMAS versões: uma
linha por arquivo, sob o timestamp do próprio nome. O `supabase db push`
reaplica todo arquivo cuja versão não esteja no ledger — e reaplicar
20260902120000 derruba tabela de novo. Aplicar migração pelo SQL Editor ou
pelo `apply_migration` do MCP grava a linha com o timestamp DA HORA, e esse
número não se escolhe.

Então a ordem é: aplicar PRIMEIRO, e só depois nomear o arquivo com a versão
que o ledger recebeu. O número é arbitrário — só precisa ordenar direito e ser
o mesmo dos dois lados —, e assim ele nasce igual, sem correção nenhuma. Se o
arquivo já tiver sido nomeado antes, renomeie ou renumere a linha:

```sql
update supabase_migrations.schema_migrations
   set version = '<versão do arquivo>' where version = '<a que o Supabase gerou>';
```

As duas linhagens foram reconciliadas em 02/09/2026 — nove linhas do ledger
eram iterações que os arquivos de hoje consolidam, e saíram. O ledger de antes
está inteiro, com o SQL que rodou, em
`supabase_migrations.ledger_backup_20260902`.

Em 11/09/2026 foi a vez do painel admin: o ledger guardava três linhas
(`painel_admin`, `painel_admin_comentarios` e a correção do mesmo dia) para o
`20260908120000_painel_admin.sql`, que o commit 1f46615 já tinha consolidado num
arquivo só — e a correção nunca chegara ao banco, porque EDITAR um arquivo já
aplicado não reaplica nada. As três viraram uma, sob a versão do arquivo, com os
statements das três preservados na ordem; o ledger de antes está em
`supabase_migrations.ledger_backup_20260911`.

O SQL tem de chegar ao banco em UTF-8. No Windows PowerShell 5.1 o
`Get-Content -Raw` lê pelo codepage ANSI do sistema, não pelo do arquivo: um
`.sql` com acento vira mojibake silencioso — o SQL roda, mas os literais entram
corrompidos. Foi assim que a 20260904110552 gravou a lista branca de votos do
CREG com "Aprovação" e "Extinção" corrompidos, e a 20260904131343 teve de
recriar as oito RPCs. Leia sempre com `Get-Content -Raw -Encoding UTF8` (ou
`node -e "process.stdout.write(require('fs').readFileSync(f,'utf8'))"`), e
depois de aplicar confira que nada acentuado se quebrou:

```sql
select p.proname
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.prosrc ~ 'Ã[©£¡§ºª´¨]|â€';   -- tem de vir vazio
```

Documentação: este README, mais um documento por colegiado —
[`FLUXO-CJ.md`](FLUXO-CJ.md), o fluxo completo da Câmara de Julgamento, do
sorteio ao julgamento registrado, com as regras, as tabelas, a API e o
tratamento de falhas; e [`FLUXO-CREG.md`](FLUXO-CREG.md), o do Conselho
Regulador, que cobre só o que difere e aponta para o primeiro no resto.

O GitHub Pages define um cache curto para os arquivos publicados e não permite
configurar cabeçalhos por repositório. Por isso os assets entram com `?v=`, e
essa versão é o hash do próprio conteúdo: `node tools/versionar.mjs` recalcula
o hash e grava em `ASSET_VERSION` (`assets/js/supabase.js`) e nos `?v=` dos
HTMLs. Não existe versão para escolher à mão — nenhuma URL é reaproveitada com
conteúdo diferente, que era o que deixava o navegador com CSS antigo e JS novo.
Ao alterar um asset, gere os `.min.*`, rode o versionador e os testes.

```powershell
npx --yes esbuild@0.28.2 assets/css/index.css --minify --outfile=assets/css/index.min.css
npx --yes esbuild@0.28.2 assets/js/supabase.js --minify-syntax --minify-whitespace --outfile=assets/js/supabase.min.js
npx --yes esbuild@0.28.2 assets/js/bootstrap.js --minify-syntax --minify-whitespace --outfile=assets/js/bootstrap.min.js
npx --yes esbuild@0.28.2 assets/js/index.js --minify-syntax --minify-whitespace --outfile=assets/js/index.min.js
npx --yes esbuild@0.28.2 assets/js/julgados.js --minify-syntax --minify-whitespace --outfile=assets/js/julgados.min.js
npx --yes esbuild@0.28.2 assets/js/julgados-creg.js --minify-syntax --minify-whitespace --outfile=assets/js/julgados-creg.min.js
npx --yes esbuild@0.28.2 assets/js/acervo.js --minify-syntax --minify-whitespace --outfile=assets/js/acervo.min.js
npx --yes esbuild@0.28.2 assets/js/historico.js --minify-syntax --minify-whitespace --outfile=assets/js/historico.min.js
npx --yes esbuild@0.28.2 assets/js/admin.js --minify-syntax --minify-whitespace --outfile=assets/js/admin.min.js
node tools/versionar.mjs
```

---

## Configuração do Banco de Dados

Crie um projeto gratuito no [Supabase](https://supabase.com), rode o [schema.sql](sql/schema.sql) no SQL Editor e preencha as constantes `SUPABASE_URL` e `SUPABASE_KEY` no [supabase.js](assets/js/supabase.js). O `sql/schema.sql` cria as tabelas, o gatilho, a função de registro de votos e as políticas de segurança — e pode ser reaplicado sem duplicar registros. Ele também garante o marco fixo da sincronização em 18/06/2026.

Antes de reaplicá-lo numa base já populada, rode
[`sql/verificacao_cj.sql`](sql/verificacao_cj.sql) e
[`sql/verificacao_creg.sql`](sql/verificacao_creg.sql). Se houver “Distribuição
repetida”, decida qual registro conservar: o índice único do schema falha com
segurança, sem apagar ou escolher dados automaticamente.

Acervos e julgados dos dois colegiados aceitam somente número SEI com 15 dígitos, e a unidade do CREG
tem de ser `CREG1`, `CREG2`… Se uma base antiga tiver número fora do padrão,
corrija-o pela fonte oficial antes de reaplicar o schema; a validação falha sem
completar ou apagar números por inferência.

Depois, em **Authentication → Users**, cadastre os usuários do sistema; e em **Authentication → Providers → Email**, mantenha **desativado** o "Enable sign ups", evitando cadastros públicos não autorizados.

Com os usuários criados no Supabase Auth, cadastre as permissões de cada um na tabela `public.permissoes_usuario`:

```sql
insert into public.permissoes_usuario (user_id, email, orgao, papel)
values
  ('<UUID_DO_USUARIO_1>', 'operador.creg@goias.gov.br', 'creg', 'operador'),
  ('<UUID_DO_USUARIO_2>', 'operador.cj@goias.gov.br', 'cj', 'operador'),
  ('<UUID_DO_USUARIO_3>', 'admin@goias.gov.br', 'ambos', 'admin');
```

- **`orgao`**: define o escopo de atuação do usuário (`'creg'`, `'cj'` ou `'ambos'`). Usuários restritos a um órgão só conseguem visualizar e operar os módulos daquele colegiado.
- **`papel`**: o valor `'admin'` habilita o botão de acesso e a execução de rotinas privilegiadas no [Painel Administrativo](admin.html). Para operadores das secretarias executivas, use `'operador'`.

Se o projeto migrar para um plano Pro ou superior, ative também **Prevent use
of leaked passwords**; o recurso não está disponível no plano Free.

### Prevenção de Inatividade (Keep-Alive do Supabase)

No plano gratuito, o Supabase pausa automaticamente projetos que ficam 7 dias sem requisições. Para evitar a hibernação sem custos, o `sql/schema.sql` inclui a função `public.ping()`, que é leve, segura (não lê nem altera dados) e marcada como `STABLE` para responder a requisições `HEAD` e `GET` anônimas com `200 OK`.

Para configurar no **UptimeRobot** (plano gratuito com método `HEAD`) ou no **cron-job.org**:
- **Tipo de Monitor:** `HTTP(s)`
- **URL:**
  ```text
  https://<SEU_PROJECT_REF>.supabase.co/rest/v1/rpc/ping?apikey=<SUA_PUBLISHABLE_KEY>
  ```
- **Intervalo:** A cada 5 a 15 minutos (ou diário via cron).

A chave publicável é pública por natureza e pode ficar no código: ela identifica o projeto, não autoriza operações por si só. A proteção dos dados é assegurada pelas políticas de RLS e funções RPC com `SECURITY DEFINER`:
- O usuário anônimo não acessa dados restritos.
- Usuários autenticados operam sob o escopo autorizado de seu órgão (`orgaos_autorizados()`), inserindo novos sorteios e consultando apenas as tabelas autorizadas.
- Não existem políticas de `UPDATE` ou `DELETE` direto abertas ao cliente web em tabela nenhuma.
- Atualizações de votos e status passam exclusivamente pela RPC `registrar_votos` / `registrar_votos_creg`, e manutenções administrativas passam pelas RPCs com allowlist de campos e gravação transacional na trilha append-only `auditoria_admin`. É essa blindagem que permite manter o código-fonte 100% aberto para auditoria sem renunciar à segurança dos dados.

---

## Câmara de Julgamento: acervo e julgados

> O passo a passo completo, com diagramas, está em **[FLUXO-CJ.md](FLUXO-CJ.md)**.

A CJ deixou de compartilhar uma tabela única de sorteio com o Conselho Regulador e passou a ter as duas tabelas que a secretaria já usava na planilha:

- **`acervo_cj`** — uma linha por **distribuição** de um processo a um relator. Um processo redistribuído aparece mais de uma vez, com datas e relatores diferentes. É aqui que o sorteio da CJ grava: a cadeira sorteada (`CJ1`..`CJ5`) é o relator do processo, e quem ocupa cada cadeira sai da tabela `cadeiras_cj`.
- **`julgados_cj`** — uma linha por processo levado a uma **sessão de julgamento**, ligada ao registro do acervo por `acervo_id`.

O que a planilha resolvia com fórmulas agora é regra do banco. Ao registrar um julgamento basta informar o processo e a data da sessão — um gatilho localiza o processo no acervo e preenche **relator**, **defesa** e **data de distribuição**, e o banco calcula **`dias_dt`** (dias entre a distribuição e a sessão) e **`periodo_dt`** (o trimestre, `1T26`). Valor informado à mão nunca é sobrescrito; gravar `null` num campo derivado pede a rederivação.

Quando uma data de distribuição é informada à mão, o vínculo só é criado se
existir no acervo aquela distribuição exata. Sem correspondência, o julgado fica
órfão para revisão em vez de apontar para uma distribuição de outra data.

Quando o processo foi redistribuído, vale a distribuição vigente **na data da sessão** — o relator que de fato levou o processo à mesa. Os campos derivados são gravados como cópia, e não lidos por referência, para que uma redistribuição posterior não reescreva um julgamento já ocorrido.

Ordem de execução no SQL Editor do Supabase:

1. `sql/schema.sql` — cria as tabelas, o gatilho e as políticas;
2. `dados/acervo_cj.sql` e `dados/julgados_cj.sql` — **só num banco novo**, para carregar o histórico da planilha. Gerados por `python dados/importar_planilha.py "Câmara de Julgamento - REG.xlsx"`, ficam fora do Git por precaução: são dados administrativos em volume, e este repositório é público.

Os dois passos são idempotentes: rodar de novo não duplica nada. No banco em produção o histórico já foi carregado e depois arquivado — ver abaixo.

O Conselho Regulador ganhou o mesmo par de tabelas em 27/08/2026 — ver a seção
abaixo.

### Registro do voto e do status

Os julgados que chegam da AGR vêm **sem voto e sem status** — as duas coisas são decisão da sessão e só existem depois dela. Quem preenche é a secretaria, em **[julgados-cj.html](julgados-cj.html)**:

```text
lista das pautas com pendência → clica no número da reunião
  → tabela dos processos daquela pauta, com Voto e Status
  → Salvar
```

Voto (`Manter`, `Anular`, `Vista`) e Status (`Julgado`, `Retornou`, `Retirado`, `Vista`) são independentes: processo retirado de pauta fica com status e sem voto, e continua aparecendo como pendente enquanto faltar algum dos dois. Só as linhas em que o funcionário mexeu são enviadas.

Isso abriu, pela primeira vez, **leitura** do banco para o navegador — só da tabela `julgados_cj`, e só para usuário autenticado. A escrita continua fechada: não existe política de `UPDATE` em nenhuma tabela. Gravar passa pela função `registrar_votos`, que aceita apenas voto e status, recusa rótulo fora da lista e anota em `atualizado_por` / `atualizado_em` quem preencheu e quando.

E a função não encosta no histórico: linha que veio da planilha, já com voto e status, é imutável por essa porta. Só é editável o que ainda está pendente ou o que a própria página gravou antes — para corrigir um erro de digitação.

### Sincronização automática com as pautas da AGR

A partir daqui a planilha não é mais necessária para atualizar os julgados: a fonte é a publicação oficial em [pautas das reuniões](https://goias.gov.br/agr/pautas-das-reunioes-2026/).

```text
listagem da AGR → reuniões ainda não processadas → baixa o PDF
  → extrai o texto → descarta o rodapé "Referência: Processo nº …"
  → extrai e normaliza os processos → insere em julgados_cj
  → o gatilho busca cada processo em acervo_cj e preenche o resto
  → registra o documento em pautas_cj
```

Onde isso roda: **GitHub Actions**, não no site. O site é estático no Pages e o navegador nem conseguiria consultar `goias.gov.br`, que não libera CORS. O job roda de hora em hora, das 07:00 às 20:00 de Goiás, e sincroniza os dois colegiados na mesma passagem — a Câmara reúne às quintas, o Conselho não tem dia fixo e nenhum dos dois avisa a hora em que a pauta vai ao ar. Repetir a busca não duplica nada: a URL já registrada em `pautas_*` fica de fora da rodada seguinte. Se um colegiado falhar, o outro continua e a Action aponta qual foi. Pode ser disparado à mão em **Actions → Sincronizar Julgados → Run workflow**, com a opção `simular` para ver o resultado sem gravar nada e a opção de limitar a um colegiado. O log de cada rodada fica na aba Actions, o que mantém a sincronização tão auditável quanto o resto do projeto.

Para funcionar, cadastre em **Settings → Secrets and variables → Actions** o segredo `SUPABASE_DB_URL` com a connection string do banco.

Também dá para rodar da sua máquina:

```bash
python sincronizacao/sincronizar.py --simular --dsn "postgresql://..."
```

Como o parser identifica um processo: número SEI de **15 dígitos precedido de `Processo nº`**. Conferido em 10 pautas de datas diferentes — 190 números de 15 dígitos, todos com o rótulo, e nenhum outro número do documento chega perto (auto de infração tem 5 dígitos, código verificador do SEI tem 8). O rodapé é retirado **antes** da busca, por contexto e nunca por lista de números proibidos: `Referência: Processo nº …` aponta para o processo do próprio documento no SEI e ele muda a cada ano. Se um dia aparecer um número de 15 dígitos sem o rótulo, a sincronização registra o aviso em vez de perdê-lo em silêncio.

Nada disso reimplementa a regra Acervo → Julgados: quem preenche relator, defesa e data de distribuição continua sendo o gatilho do banco. Processo que aparece na pauta e não está no acervo é gravado assim mesmo, sem inventar dado, e sai listado em `pautas_cj.processos_sem_acervo` para a secretaria completar o acervo.

Rodar duas vezes não duplica nada: `pautas_cj.url` barra o documento repetido e a chave `(num_processo, data_sessao)` de `julgados_cj` barra o processo repetido. O marco de início é fixo e a rodada automática consulta todos os anos desde ele, então um PDF que falhou volta mesmo após a virada do ano; uma versão corrigida com URL nova também é processada.

## Conselho Regulador: acervo e julgados

> O que difere da Câmara, com as fórmulas traduzidas uma a uma, está em
> **[FLUXO-CREG.md](FLUXO-CREG.md)**.

Até 27/08/2026 o sorteio do CREG gravava numa tabela solta, sem acervo e sem
julgados, medida provisória enquanto o Conselho não tinha o desenho da Câmara.
Agora tem:

- **`acervo_creg`** — uma linha por **distribuição** de um processo a uma unidade
  (`CREG1`..`CREG4`). É aqui que o sorteio do CREG grava. A unidade é o que se
  guarda: não há de-para de ocupantes, pelo motivo do parágrafo abaixo.
- **`julgados_creg`** — uma linha por processo levado a uma **sessão do
  Conselho**, ligada ao acervo por `acervo_id`.
- **`pautas_creg`** — um registro por documento de pauta já processado.

Não há equivalente a `cadeiras_cj`: os responsáveis por CREG1..CREG4 pediram
para não ter os nomes vinculados aos processos, então o painel do Conselho
mostra a unidade e nada além dela.

O **interessado** existe em `acervo_creg` e é preenchido só pelo sorteio,
digitado na tela. A importação das planilhas e das atas não o traz: no
histórico é nome de pessoa física em volume, e este repositório é público.

O vocabulário muda, a estrutura não. Na Câmara a coluna de decisão é a **defesa**
(houve ou não); no Conselho é o **recurso**, com cinco valores. A Câmara só julga
auto de infração; o Conselho tem onze assuntos. E o Conselho acompanha três
números que a Câmara não tem, todos calculados pelo banco: **`meta_45`** (o
processo chegou à mesa em até 45 dias), **`dias_dist_cr_cj`** (quanto levou entre
sair da CJ e ser distribuído no CREG) e **`em_relacao_cj`** (o Conselho decidiu
diferente da Câmara).

O gatilho é o mesmo da CJ: informe o processo e a data da sessão, e o banco
localiza a distribuição vigente **naquela data** para preencher unidade, assunto,
recurso e data de distribuição. Isso corrige um defeito da planilha, cujo
`INDEX/MATCH` pegava a primeira ocorrência na ordem dos arquivos e podia apontar
para o gabinete errado quando o processo fora redistribuído.

A sincronização com a AGR usa o mesmo parser, sem alteração — muda a página
(`pautas-das-sessoes-do-conselho-regulador-{ano}`), o filtro por comissão some
(os títulos do Conselho não nomeiam o colegiado) e uma sessão sem processo passa
a ser registrada com zero em vez de virar erro: o Conselho convoca sessão
especial, e a de 03/07/2026 não levou nenhum processo.

Ordem de execução no SQL Editor:

1. `sql/schema.sql` — tabelas, gatilho, RPCs, políticas e o marco de 30/06/2026;
2. `python dados/importar_creg.py "<pasta das planilhas>"` — lê `CREG1..4.xlsx`,
   `Conselho Regulador.xlsx` e `Conselho Regulador 2025.2.xlsx` e gera
   `dados/acervo_creg.sql` e `dados/julgados_creg.sql`, que ficam fora do Git;
3. `python dados/importar_atas_creg.py <atas.pdf…>` — lê as atas de sorteio
   publicadas no SEI e gera `dados/acervo_creg_atas.sql`. É o que mantém o
   acervo em dia enquanto o Conselho sortear fora do sistema: a ata sai antes de
   a planilha de gabinete ser atualizada;
4. `dados/acervo_creg.sql`, `dados/acervo_creg_atas.sql` e só então
   `dados/julgados_creg.sql` — o acervo inteiro antes dos julgados;
5. `sql/verificacao_creg.sql` — nenhum ERRO deve aparecer.

Tudo é idempotente: rodar de novo não duplica nada.

O Conselho tem as duas telas no mesmo desenho da Câmara:
[julgados-creg.html](julgados-creg.html) para o voto e o status, e
[acervo-creg.html](acervo-creg.html) para o painel. O painel compartilha o
`acervo.js` com a Câmara — quem escolhe o par de funções do banco é o
`data-colegiado` do `<body>`.

### Backup e restauração

Em 19/08/2026 a série de julgados foi reiniciada: o histórico da planilha saiu
das tabelas de produção e ficou guardado no schema `backup_cj`, dentro do mesmo
banco. Produção passou a ter só os processos ainda não julgados, e os
julgamentos passaram a ser registrados pelo sistema a partir dali.

Dois dias depois, uma carga de recuperação repôs o período que a planilha não
alcançava — de 25/06 a 20/08/2026 — lendo as atas de sorteio publicadas no SEI e
as pautas publicadas pela AGR: 157 distribuições e 151 julgados. O script era de
execução única e não ficou no repositório; o que ele decidiu, e onde deixou o
banco, está em [`FLUXO-CJ.md`](FLUXO-CJ.md).

- [`backup_cj.sql`](sql/backup_cj.sql) copia `acervo_cj`, `julgados_cj` e
  `pautas_cj` para o schema `backup_cj`. Rode antes de qualquer alteração de
  risco.
- [`restaurar_cj.sql`](sql/restaurar_cj.sql) é a volta: devolve as três tabelas ao
  estado do backup.

Em 18/09/2026 o histórico voltou à produção, somado à nova série, para a CJ
ter a mesma profundidade do CREG. O estado anterior ficou em
`backup_cj_pre_mesclagem` ([`backup_pre_mesclagem_cj.sql`](sql/backup_pre_mesclagem_cj.sql)),
e [`desfazer_mesclagem_cj.sql`](sql/desfazer_mesclagem_cj.sql) é a volta — tira
só o que a mesclagem trouxe. Ver *A mesclagem do histórico* em
[`FLUXO-CJ.md`](FLUXO-CJ.md).

Cada um é **um único comando** — um bloco `do $$ … $$`. No SQL Editor do
Supabase os comandos passam por um pooler em modo transação e podem cair em
conexões diferentes, então `begin;…commit;` não segura nada. Num bloco único, ou
tudo passa ou nada é gravado.

Para uma cópia **fora** do Supabase, pegue a connection string em
*Project Settings → Database* e rode:

```bash
docker run --rm -v "$PWD:/saida" postgres:15-alpine pg_dump "SUA_CONNECTION_STRING" -Fc -f /saida/sorteio-sei-backup.dump
```

### Testes

Instale uma vez as dependências usadas pelas suítes Python:

```bash
python -m pip install -r tests/requirements.txt
```

#### Testes de banco e regras de negócio (requerem Docker e psycopg2)

```bash
python tests/test_cj.py "C:/caminho/Câmara de Julgamento - REG.xlsx"
```
Sobe um Postgres descartável no Docker (mesmo motor do Supabase), aplica o schema e confere que o banco reproduz as fórmulas e derivações da Câmara de Julgamento — inclusive recalculando os campos derivados das 3.144 linhas de julgados. Sem a planilha à mão, os testes dependentes dela são pulados e o restante roda normalmente.

```bash
python tests/test_creg.py
```
Sobe um Postgres descartável e valida todas as regras, fórmulas e funções do Conselho Regulador (`meta_45`, `dias_dt`, `dias_dist_cr_cj`, `em_relacao_cj`, derivação de pautas e RPC de registro de votos).

```bash
python tests/test_acesso.py
```
Testa o modelo de controle de acesso por órgão em Postgres real: checagem de isolamento por órgão (`CREG`, `CJ` e `ambos`), permissões de operadores e bloqueio estrito de acessos não autorizados nas tabelas e nas RPCs protegidas.

```bash
python tests/test_admin.py
```
Testa as operações do painel administrativo em Postgres real: controle de perfil (`papel = 'admin'`), operações de correção com allowlist (voto, status, pauta, data, desfazer para vazio), renumeração em lote, correção de acervo, redistribuição com preservação de histórico, exclusão de julgado e de distribuição (com ou sem os julgados vinculados, motivo obrigatório e retrato completo na auditoria), integridade transacional e gravação imutável na trilha `auditoria_admin`.

#### Testes de sincronização e workflows

```bash
python tests/test_sincronizacao.py
```
Testa o parser e a sincronização contra fixtures reais (HTML da listagem, texto e PDF de pautas de datas diferentes) e contra o Postgres descartável, sem depender do portal estar no ar. O parâmetro `--online` permite executar testes de integração contra o portal oficial da AGR para detectar eventuais mudanças de layout.

```bash
python tests/test_workflows.py
```
Valida o contrato dos workflows do GitHub Actions (`ci.yml` e `sincronizar-julgados.yml`): sincronização agendada periódica, cobertura de ambos os colegiados na mesma execução, disparo manual e tolerância a falhas isoladas entre colegiados.

#### Testes do frontend e assets (Node.js nativo)

```bash
node tests/test_sorteio.mjs
node --test tests/test_frontend.mjs
node tests/test_assets.mjs
```
Não necessitam de Docker nem de banco de dados: exercitam a aleatoriedade uniforme do sorteio (Fisher-Yates sem viés), a navegação e interface do usuário (cards dinâmicos, modais, exportações em `.docx`, `.xlsx` e `.pdf`, autenticação contextual), além da integridade de minificação, lazy loading e versão de cache por hash.

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) repete essas verificações em todo push e pull request, validando sintaxe JavaScript (`node --check`), suítes Node.js, testes PostgreSQL/Python e garantindo que os arquivos `.min.*` estejam devidamente regenerados e alinhados ao versionador.

### Atualização 3.9.2

A migração `20260918130135_corrigir_concorrencia_votos.sql` deve ser aplicada
antes de publicar o frontend 3.9.2. Ela mantém as assinaturas e os privilégios
das RPCs de votos, mas compara os valores anteriores sob bloqueio de linha.
As telas enviam somente os campos alterados; uma decisão substituída por outra
pessoa gera conflito, preservando o formulário para conferência. Clientes
antigos ainda podem preencher campos vazios ou reenviar valores idênticos,
mas precisam atualizar a página para substituir decisões já preenchidas.

Consultas de listagem buscam todas as páginas da Data API antes de apresentar
ou exportar o resultado. As RPCs de escrita não são repetidas por paginação.

Na sincronização, `--desde AAAA-MM-DD` força a releitura também das URLs já
registradas após essa data e atualiza os metadados da última leitura. O
reprocessamento acrescenta processos ausentes, sem apagar julgados nem mudar
votos/status existentes. Remoções ou mudanças na data de uma sessão exigem
conferência administrativa. PDFs com números de processo não reconhecidos
falham integralmente e continuam disponíveis para nova tentativa; não são
marcados como importação concluída.

Regressões da revisão: `python tests/test_regressoes_review.py` e
`node --test tests/test_api_paginacao.mjs`, além da suíte de frontend.

---

## Tecnologias Utilizadas

- **HTML5** (Semântico, estruturado com foco em usabilidade e acessibilidade)
- **CSS3** (Variáveis nativas para tokens de cores, Flexbox, Grid e animações leves)
- **JavaScript ES6+** (Modular, sem dependências de frameworks pesados no cliente e manipulação nativa do DOM)
- **Sem dependências externas no cliente** (Geração de atas em Word `.doc`/`.docx`, planilhas Excel `.xlsx` e relatórios PDF via APIs nativas e `Blob`)
- **Supabase / PostgreSQL** (Banco de dados relacional, Row Level Security, funções RPC com `SECURITY DEFINER`, autenticação segura e auditoria append-only)
- **Python 3** (Automação da sincronização de pautas da AGR via `pdfplumber`/`beautifulsoup4` e suítes completas de testes)
- **GitHub Actions** (CI contínuo com verificação estrita de integridade e rotina diária de sincronização de pautas)
- **esbuild** (Minificação e empacotamento determinístico com versionamento de assets por hash SHA-256)
