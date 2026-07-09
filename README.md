# Sorteador de Processos CREG — AGR

Aplicação web estática desenvolvida para auxiliar a **Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos (AGR)** na distribuição eletrônica e igualitária de processos do SEI entre as unidades do Conselho Regulador (CREGs).

---

## Funcionalidades

- **Geração Dinâmica de Linhas**: Permite definir a quantidade inicial de processos a serem cadastrados na tabela.
- **Inserção e Exclusão Flexíveis**: 
  - Adicione novas linhas a qualquer momento utilizando o botão **+ Adicionar Linha** sem perder os dados já preenchidos.
  - Exclua linhas geradas incorretamente de forma individual clicando no botão **×** no final da linha.
- **Distribuição Igualitária por CREG**:
  - Garante que cada unidade receba a mesma quantidade total de processos.
  - Realiza o balanceamento proporcional e cruzado de cada **Assunto** individualmente, evitando que uma unidade receba apenas um tipo de processo.
- **Exclusão de Unidades**: Seleção simples das CREGs que NÃO vão participar da rodada de distribuição através de filtros de exclusão visual (pills).
- **Validação Completa**: Impede a realização do sorteio caso existam campos em branco na tabela.
- **Travamento de Recurso Inteligente**: Define automaticamente o campo de recurso como "Não se aplica" e o desabilita caso o assunto selecionado não seja "Auto de Infração".
- **Exportação Multi-Formato**:
  - Geração automática da ata de distribuição em formato Word (`.doc`).
  - Download automático de planilhas de backup individuais para cada CREG participante em formato Excel/CSV.

---

## Design e Cores

O visual foi adaptado com base na identidade visual institucional do portal do **Estado de Goiás**:
- **Paleta de Cores**: Uso do verde institucional (`#00534b`) como cor principal de realce e botões, fundo de tela branco, e painel interno em tom de verde menta claro (`#E9F5EC`).
- **Rodapé Institucional**: Banner verde com logotipo branco oficial e informações de integridade e auditoria do sorteio.

---

## Estrutura de Arquivos

- `index.html`: Arquivo de estrutura contendo o código HTML e toda a lógica de funcionamento e sorteio em JavaScript.
- `index.css`: Arquivo de estilização CSS contendo o design visual do sistema.

---

## Tecnologias Utilizadas

- **HTML5** (Semântico)
- **CSS3** (Flexbox, variáveis nativas e design responsivo)
- **JavaScript ES6+** (Lógica do sorteio e manipulação de DOM)
- **FileSaver.js** (Biblioteca para controle e download dos arquivos gerados)
