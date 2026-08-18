# Sorteador de Processos SEI

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)

Aplicação web estática desenvolvida para auxiliar o **Secretário Executivo do Conselho Regulador** (modo CREG) e a **Secretária Executiva da Câmara de Julgamento** (modo CJ) da AGR na distribuição eletrônica e igualitária de processos do SEI entre suas respectivas unidades.

Acesse a aplicação online em: [https://thelustosa.github.io/sorteio-sei/](https://thelustosa.github.io/sorteio-sei/)

| Tela de Início | Interface do Sorteador |
| :---: | :---: |
| ![Tela de Início](assets/screenshot_start.png) | ![Interface do Sorteador](assets/screenshot.png) |

---

## Auditoria e Transparência

Este repositório está público e totalmente aberto para auditoria dos sorteios. Caso surjam quaisquer dúvidas em relação à integridade da divisão dos processos, qualquer interessado pode inspecionar o código-fonte da lógica de distribuição para verificar a conformidade, impessoalidade e igualdade matemática das regras aplicadas.

O Termo de Entrega oficial do projeto para a Agência Goiana de Regulação (AGR) está disponível para consulta em: [SEI_93024891_Termo_de_Entrega_1.pdf](documentos/SEI_93024891_Termo_de_Entrega_1.pdf).

---

## Funcionalidades

- **Acesso Restrito por Login**: o sorteio só é liberado após autenticação com usuário e senha cadastrados, garantindo que apenas as secretarias executivas realizem distribuições. As senhas não ficam no código — são validadas pelo servidor do Supabase.
- **Geração Dinâmica de Linhas**: Permite definir a quantidade inicial de processos a serem cadastrados na tabela.
- **Inserção e Exclusão Flexíveis**: 
  - Adicione novas linhas a qualquer momento utilizando o botão **+ Adicionar Linha** sem perder os dados já preenchidos.
  - Exclua linhas geradas incorretamente de forma individual clicando no botão **×** no final da linha.
- **Distribuição Igualitária**:
  - Garante que cada unidade (CREG ou CJ) receba a mesma quantidade total de processos.
  - Realiza o balanceamento proporcional e cruzado de cada **Assunto** individualmente, evitando que uma unidade receba apenas um tipo de assunto de processo.
- **Exclusão de Unidades**: Seleção simples das unidades que NÃO vão participar da rodada de distribuição através de filtros de exclusão visual (pills).
- **Validação Completa**: Impede a realização do sorteio caso existam campos em branco na tabela ou números de processo repetidos, indicando as linhas em conflito.
- **Assunto Fixo na Câmara de Julgamento**: no modo CJ, todo processo é Auto de Infração — o campo já vem preenchido e travado, eliminando a possibilidade de erro.
- **Travamento de Recurso Inteligente**: Define automaticamente o campo de recurso como "Não se aplica" e o desabilita caso o assunto selecionado não seja "Auto de Infração".
- **Exportação da Ata em Word**: geração automática da ata de distribuição em formato Word (`.doc`), nomeada dinamicamente (`Sorteio_CREG_18.08.2026.doc`).
- **Registro no Banco de Dados**: ao final do sorteio, os dados que antes iam para as planilhas são gravados no banco (Supabase/PostgreSQL), uma linha por processo. Enquanto o banco não estiver configurado — ou se o envio falhar — o sistema baixa automaticamente um arquivo `.json` de backup com o sorteio completo, para reenvio posterior, de modo que nenhum sorteio se perca.

---

## Design e Cores

O visual foi adaptado com base na identidade visual institucional do portal do **Estado de Goiás**:
- **Paleta de Cores**: Uso do verde institucional (`#00534b`) como cor principal de realce e botões, fundo de tela branco, e painel interno em tom de verde menta claro (`#E9F5EC`).
- **Rodapé Institucional**: Banner verde com logotipo branco oficial e informações de integridade e auditoria do sorteio.

---

## Estrutura de Arquivos

- `documentos/`: Pasta contendo o Termo de Entrega oficial do projeto.
- `schema.sql`: Script de criação da tabela e das políticas de segurança (RLS) do banco.
- `CONFIGURAR-SUPABASE.md`: Guia passo a passo de configuração do banco de dados.
- `index.html`: Arquivo de estrutura contendo os elementos HTML e marcação da página.
- `index.js`: Arquivo contendo toda a lógica do sorteador e integração de exportação de dados.
- `index.css`: Arquivo de estilização CSS contendo o design visual do sistema.

---

## Configuração do Banco de Dados

O passo a passo completo está em **[CONFIGURAR-SUPABASE.md](CONFIGURAR-SUPABASE.md)** — criação do projeto, execução do `schema.sql`, credenciais, teste e solução de problemas. Em resumo: crie um projeto gratuito no [Supabase](https://supabase.com), rode o [schema.sql](schema.sql) e preencha as constantes `SUPABASE_URL` e `SUPABASE_KEY` no `index.js`.

A chave publicável é pública por natureza e pode ficar no código: ela identifica o projeto, não autoriza operações. A proteção dos dados vem das políticas de RLS do `schema.sql`, que exigem **usuário autenticado** e permitem apenas a **inserção** de registros — nenhum sorteio já gravado pode ser lido, alterado ou apagado pelo navegador. É o que permite manter o código-fonte totalmente aberto para auditoria.

---

## Tecnologias Utilizadas

- **HTML5** (Semântico)
- **CSS3** (Flexbox, variáveis nativas e design responsivo)
- **JavaScript ES6+** (Lógica do sorteio e manipulação de DOM)
- **FileSaver.js** (Biblioteca para controle e download dos arquivos gerados)
- **Supabase / PostgreSQL** (Banco de dados dos sorteios, acessado via API REST com a Fetch API)
