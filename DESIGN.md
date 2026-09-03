---
name: Sorteador de Processos SEI
description: Sorteio eletrônico auditável e registro de julgamentos para os colegiados da AGR
colors:
  institutional-green: "#00534b"
  institutional-green-hover: "#003e38"
  institutional-green-soft: "rgba(0, 83, 75, 0.08)"
  pending-teal: "#2f7668"
  pending-teal-hover: "#245f55"
  acervo-green: "#0c695c"
  acervo-green-hover: "#095548"
  acervo-muted: "#4c6c63"
  historico-green: "#16816e"
  historico-green-hover: "#126b5c"
  historico-muted: "#466c61"
  alert-red: "#b42318"
  alert-red-soft: "rgba(180, 35, 24, 0.1)"
  positive-green: "#16816e"
  neutral-bg: "#f4f7f5"
  neutral-surface: "#ffffff"
  institutional-panel: "#e9f3ef"
  surface-historico: "#f1f7f5"
  neutral-text: "#112720"
  neutral-muted: "#556b63"
  neutral-border: "rgba(0, 83, 75, 0.16)"
  on-accent: "#ffffff"
typography:
  display:
    fontFamily: "Montserrat, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.45rem, 2.6vw, 1.85rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Montserrat, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.125rem, 1.6vw, 1.375rem)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Montserrat, ui-sans-serif, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  sm: "8px"
  lg: "12px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.institutional-green}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.institutional-green-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.institutional-green}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.institutional-green-soft}"
  mode-button:
    backgroundColor: "{colors.institutional-green}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.neutral-surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
  badge-pending:
    backgroundColor: "{colors.pending-teal}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
---

# Design System: Sorteador de Processos SEI

## Overview

**Creative North Star: "O Livro de Registro Oficial" (The Official Ledger)**

O sistema se comporta como um livro de registro cartorial, não como um produto de consumo. O verde institucional funciona como o carimbo de autoridade — aparece em poucos lugares (barra de navegação, botão de ação primária, títulos) mas sempre com o mesmo peso — e o resto da interface é deliberadamente plano: superfícies brancas, bordas finas tingidas de verde no lugar de cinza neutro, e quase nenhuma sombra. Nada decorativo compete com o dado: sem gradiente, sem ilustração, sem ícone que não tenha uma função de navegação ou estado.

É uma ferramenta de auditoria de um órgão do Estado de Goiás, então a confiança institucional vem antes do floreio visual — o próprio README já documenta que a paleta e a tipografia seguem o portal oficial do estado, não uma escolha de marca própria. O sistema não tem modo escuro: existe um único tema, claro, comprometido — não uma lacuna a preencher.

**Key Characteristics:**
- Verde institucional como carimbo de autoridade, usado com parcimônia, nunca como plano de fundo generalizado.
- Superfícies planas por padrão; sombra só aparece em elementos que saem do fluxo da página.
- Tipografia de destaque (Montserrat) só existe em peso 700 — não há um corte regular/leve no projeto.
- Bordas e divisores nascem do verde institucional em baixa opacidade, nunca de um cinza neutro puro.
- Um único tema comprometido, sem variante escura.

## Colors

A paleta é quase monocromática: um verde institucional para ação e identidade, um segundo verde mais claro reservado só para o canal de "pendência", e vermelho só para erro — nunca para decoração ou ênfase genérica.

### Primary
- **Verde Institucional** (`#00534b`): a cor de ação e identidade — botão primário, barra de navegação (`.green-bar`), links, título de página, anel de foco. Herdada do portal oficial do Estado de Goiás, não é uma escolha de marca do produto.
- **Verde Institucional (hover)** (`#003e38`): único estado de interação do verde primário — sempre escurece, nunca clareia.
- **Verde Institucional (soft)** (`rgba(0, 83, 75, 0.08)`): fundo de hover de botões secundários e filtros — a mesma cor primária a 8% de opacidade, não uma cor derivada à parte.

### Secondary
- **Teal dos Pendentes** (`#2f7668`): reservado para um único canal — o card "Registrar dados faltantes" e o selo/aviso pulsante de sessões sem voto ou status. É deliberadamente uma tonalidade diferente do verde primário, para esse card se ler como o seu próprio canal dentro das quatro opções da tela inicial, e funciona como a cor de alerta do sistema sem recorrer ao vermelho.
- **Teal dos Pendentes (hover)** (`#245f55`).

### Tertiary
- **Verde do Acervo** (`#0c695c`): canal de cor exclusivo do card "Acervo de processos" na tela inicial — título, contorno e fundo do botão outline daquele card, e mais nada fora dele.
- **Verde do Acervo (hover)** (`#095548`) / **texto de apoio** (`#4c6c63`, a descrição do card).
- **Verde do Histórico** (`#16816e`): mesmo papel, para o card "Histórico de sorteios". É a mesma progressão de verde que o README descreve — cada um dos quatro cards da tela inicial tem seu próprio tom, do neutro ao mais saturado.
- **Verde do Histórico (hover)** (`#126b5c`) / **texto de apoio** (`#466c61`, a descrição do card).
- **Vermelho de Alerta** (`#b42318`): erro, validação bloqueada, ação destrutiva. Nunca usado para ênfase neutra — só quando algo está de fato errado.
- **Verde Positivo** (`#16816e`): cor isolada do `.status-dot` no painel do acervo — um indicador de 8px que sinaliza estado saudável. Coincide em valor com o Verde do Histórico, mas é um uso à parte (o indicador, nunca um card) — nunca usado em botão ou texto de ação.

### Neutral
- **Fundo Neutro** (`#f4f7f5`): fundo de página, atrás de todos os cards.
- **Superfície Branca** (`#ffffff`): fundo de cards, tabelas e painéis elevados; também o fundo do card "Sorteio de processos" na tela inicial.
- **Painel Institucional** (`#e9f3ef`): o "verde-menta claro" que o README descreve — reservado a dois lugares só, o card "Registrar dados faltantes" e a linha de total do histórico, nunca um fundo de uso geral.
- **Superfície do Histórico** (`#f1f7f5`): fundo específico do card "Histórico de sorteios" na tela inicial — um quarto tom de fundo quase branco, um por card, todos próximos mas nenhum igual.
- **Texto Principal** (`#112720`): corpo de texto e títulos sem cor de destaque própria.
- **Texto Secundário** (`#556b63`): legendas, texto de apoio (`p.lead`, `.form-hint`, `.small`).
- **Borda Institucional** (`rgba(0, 83, 75, 0.16)`): toda borda e divisor do sistema — cards, tabelas, inputs.

### Named Rules
**The Tinted Neutral Rule.** Nenhuma borda, divisor ou fundo neutro usa cinza puro — todos derivam do verde institucional em baixa opacidade (8% a 22%). Até o "neutro" deste sistema carrega a cor da marca.

**The Four Card Channels Rule.** A tela inicial tem exatamente quatro cards, e cada um tem seu próprio par cor/hover — Verde Institucional (Sorteio), Verde do Acervo, Verde do Histórico, Teal dos Pendentes (Registrar dados faltantes) — todos declarados como token em `:root`, nenhum hardcoded no seletor do card. Um quinto card não herda a cor de nenhum dos quatro; ganha o próprio par.

**The One Alert Color Rule.** Vermelho é exclusivo de erro e ação destrutiva. Qualquer outro aviso de atenção (como pendência de julgamento) usa o Teal dos Pendentes, não vermelho — o sistema reserva vermelho só para quando algo deu errado de verdade.

## Typography

**Display Font:** Montserrat (com `ui-sans-serif, sans-serif`)
**Body Font:** pilha de sistema — `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

**Character:** Montserrat em peso 700 marca os poucos pontos de identidade (título de card, cabeçalho de página); todo o resto — corpo, rótulo, botão, tabela — fica na pilha de sistema, o que mantém a leitura densa da tela rápida em qualquer dispositivo sem carregar mais de um arquivo de fonte.

### Hierarchy
- **Display** (700, `clamp(1.45rem, 2.6vw, 1.85rem)`, 1.2): o título do painel do Acervo/Histórico (`.acervo-header-title-group h2`), branco sobre a barra verde — é o maior e mais bold texto do sistema inteiro, reservado às duas telas de dashboard.
- **Headline** (700, `clamp(1.125rem, 1.6vw, 1.375rem)`, 1.25): o título dentro de cada card de conteúdo (`.card h2`/`h3`) — maior que o próprio `<h1>` da página, porque é o que a pessoa vai fazer agora.
- **Title** (700, 1.125rem, 1.25): o `<h1>` do cabeçalho institucional — a identidade da página, deliberadamente mais discreta que o Headline abaixo dela.
- **Body** (400, 1rem, 1.5): texto corrido padrão do `<body>`.
- **Label** (700, 0.8125rem–0.875rem, 1.2–1.3): a família de texto estrutural pequeno e sempre em negrito — rótulo de botão, badge, campo de formulário (0,8125rem) e os rótulos de navegação como `#txtModo`/`.institution-name` (0,875rem, um degrau acima, mesma função).

### Named Rules
**The Dashboard Outranks Everything Rule.** Só duas telas (Acervo e Histórico) usam o Display — o maior heading do sistema não é o `<h1>` de página nem o título do card, é o cabeçalho do próprio painel de dados. Se uma tela nova não for um dashboard, ela não herda esse tamanho.

**The Content Outranks the Masthead Rule.** Fora das duas telas de dashboard, o título dentro do card de conteúdo (Headline, `--text-xl`) é visualmente maior que o `<h1>` do cabeçalho da página (Title, `--text-lg`). A hierarquia grita o que a pessoa vai fazer agora, não o nome do sistema.

**The One-Weight Display Rule.** Montserrat só existe em peso 700 neste projeto — não há corte regular nem leve carregado. Um título em Montserrat é sempre bold; nunca introduza peso 400/500 dessa família.

## Layout

O contêiner principal é `width: min(1100px, 96%)`, centralizado. A tela inicial organiza as quatro opções (Sorteio, Acervo, Histórico, Registrar dados faltantes) em cards de grid de duas colunas (`minmax(250px, 0.85fr) minmax(340px, 1.15fr)`) que colapsam para uma coluna abaixo de 980px. Tabelas de dado usam `table-layout: fixed` com largura de coluna em porcentagem, e viram scroll horizontal dentro de `.table-scroll` quando a tela é estreita demais para as colunas de conteúdo (ver `#processTable` a partir de 981px).

Breakpoints observados no CSS: 480px, 600px, 620px, 768px, 880/881px e 980/981px — sem nome canônico atribuído; cada um resolve uma quebra específica de componente (barra de navegação, tabela, cards da tela inicial), não uma escala de dispositivo genérica.

Não existe uma escala de espaçamento em tokens (`--space-*`): o padding e o gap são valores em pixel escolhidos por componente (8, 10, 12, 14, 16, 18, 20, 24, 28px aparecem, sem uma progressão declarada). Trabalho novo deve casar com o valor mais próximo já usado no contexto, não inventar uma escala.

## Elevation & Depth

O sistema é estruturalmente plano: a separação entre superfícies vem quase sempre de borda de 1px, não de sombra. As duas sombras que existem (`--shadow-toast`: `0 12px 28px rgba(17, 39, 32, 0.18)`; `--shadow-panel`: `0 12px 32px rgba(17, 39, 32, 0.09)`) aparecem só em elementos que saem do fluxo normal da página — nunca em um card, botão ou linha de tabela em repouso.

### Shadow Vocabulary
- **Toast** (`box-shadow: 0 12px 28px rgba(17, 39, 32, 0.18)`): notificação flutuante fixa no canto da tela.
- **Panel** (`box-shadow: 0 12px 32px rgba(17, 39, 32, 0.09)`): painel/diálogo sobreposto do acervo — mais suave que o toast porque cobre mais área da tela.

### Named Rules
**The Overlay-Only Shadow Rule.** Box-shadow é exclusivo de elementos que flutuam por cima da página — toast e o painel/diálogo do acervo. Se o elemento não sai do fluxo normal, ele não recebe sombra.

## Shapes

Três raios cobrem o sistema inteiro: `8px` (controles — botão, input, select, chip de navegação), `12px` (cards, tabelas, painéis, diálogos) e `999px` (pill — badges, chips de filtro, botões grandes de seleção de modo). Bordas são sempre 1px e sempre a Borda Institucional tingida de verde (ver Colors) — nunca uma borda mais grossa ou de cor neutra pura.

## Components

### Buttons
- **Shape:** raio de controle (8px).
- **Primary** (`.button-primary`, `#btnEntrar`, `#btnSalvar`): fundo Verde Institucional sólido, texto branco, `padding: 10px 14px`, altura mínima 44px.
- **Hover / Focus:** hover escurece para `--accent-hover`; foco usa `outline: 2px solid var(--accent)` com 2px de offset — nunca um anel só de sombra.
- **Secondary** (`.button-secondary`): contorno Verde Institucional, fundo transparente, hover preenche com Verde Institucional (soft).
- **Mode Button** (`.mode-button` / `.mode-button-outline`): o botão grande de seleção de colegiado na tela inicial — mesma paleta do primário, mas altura mínima 48px e raio de controle; a variante outline troca o preenchimento por contorno, herdando a cor de destaque do card em que vive: Verde Institucional (Sorteio), Verde do Acervo, Verde do Histórico ou Teal dos Pendentes (Registrar dados faltantes) — ver The Four Card Channels Rule em Colors.
- **Nav Action** (`.nav-action`, dentro da barra verde): ghost sobre fundo Verde Institucional — contorno translúcido branco, sem preenchimento em repouso.

### Badges / Pills
- **Filter Pill** (`.pill`): chip de seleção/exclusão de unidade — fundo Verde Institucional (soft), texto verde; estado `.excluded` inverte para fundo vermelho sólido com texto riscado, o único lugar do sistema onde vermelho vira fundo em vez de texto/borda.
- **Count Badge** (`.unidade-badge`): pill estática com contagem, fundo Verde Institucional sólido, texto branco.
- **Pending Badge** (`.pendencias-badge`): pill flutuante (posição absoluta no canto do card) com contagem de sessões pendentes — fundo Teal dos Pendentes, texto branco; o card em que vive ganha uma borda/glow que pulsa por 3 ciclos e se acomoda num estado estático, nunca em loop infinito.

### Cards / Containers
- **Corner Style:** raio de card (12px).
- **Background:** Superfície Branca por padrão; os quatro cards de seleção da tela inicial (`.selection-card-*`) têm cada um sua própria cor de destaque de título e botão (ver The Four Card Channels Rule em Colors), e dois deles trocam também o fundo — "Registrar dados faltantes" usa o Painel Institucional, "Histórico de sorteios" usa a Superfície do Histórico.
- **Shadow Strategy:** nenhuma — ver Elevation & Depth. A separação vem de borda de 1px.
- **Border:** 1px, Borda Institucional (ou a cor de destaque do card, quando há pendência).
- **Internal Padding:** 24px (28px nos cards de seleção da tela inicial, 20px/16px nos breakpoints estreitos).

### Tables
- **Style:** cabeçalho com fundo levemente tingido (`--table-heading`), linha de dado com fundo branco e hover em tingido de verde bem sutil (`--table-row-hover`); borda inferior de 1px entre linhas, sem borda vertical entre colunas.
- **Layout:** `table-layout: fixed` com largura de coluna em porcentagem nas tabelas de tela mais densa (registro de julgamento, sorteio); alinhamento centralizado quando a coluna é controle (select) ou valor curto, à esquerda quando é texto de leitura longa.
- **Density:** cada família de tabela (`#processTable`, `#julgadosTable`, `.acervo-table`, `.historico-table`, `.detalhe-table`) ajusta sua própria largura mínima e comportamento de coluna — não há uma tabela genérica única.

### Inputs / Fields
- **Style:** borda 1px Borda Institucional, raio de controle (8px), fundo Superfície Branca, `width: 100%` por padrão.
- **Focus:** contorno de 2px na cor de ação, deslocado 2px para fora — igual ao foco de botão, mesma regra em todo o sistema.
- **Placeholder / Select vazio:** `.placeholder-select` usa Texto Secundário mais forte em vez do texto normal, sem mudar o fundo.

### Navigation
- Barra verde de 48px de altura fixa no topo do conteúdo (`.green-bar`), com o nome do modo à esquerda e ações (Voltar/Sair) à direita como botões ghost. Tipografia sempre em Label (700, pequena), nunca Body.

## Do's and Don'ts

### Do:
- **Do** manter o Verde Institucional exclusivo para ação primária e identidade fora da tela inicial; dentro dela, cada um dos quatro cards vive só do seu próprio canal (ver The Four Card Channels Rule).
- **Do** derivar toda borda e divisor da Borda Institucional tingida — nunca introduzir cinza neutro puro.
- **Do** reservar `box-shadow` só para elementos que saem do fluxo normal (toast, painel/diálogo) — nunca num card, botão ou linha de tabela em repouso.
- **Do** manter Montserrat só para os pontos de identidade (título de painel de dashboard, título de card, `<h1>`, rótulos estruturais curtos) em peso 700 — o resto fica na pilha de sistema.
- **Do** manter 44px de altura mínima em botão, input e select (`button, input, select { min-height: 44px }`) — é um piso de alvo de toque já embutido no sistema, não uma decisão a repensar por tela.

### Don't:
- **Don't** introduzir um modo escuro sem uma decisão de produto — hoje existe um único tema, comprometido, não uma lacuna.
- **Don't** inventar uma escala de espaçamento em token — ela não existe; use o valor em pixel mais próximo já presente no contexto.
- **Don't** usar `--surface` (`#e9f5ec`): está declarado em `:root` mas não é referenciado em nenhuma regra do CSS — é um token morto, não faz parte da paleta ativa (candidato a limpeza, não a reuso).
- **Don't** usar vermelho para ênfase neutra ou aviso brando — é exclusivo de erro e ação destrutiva; pendência usa o Teal dos Pendentes.
- **Don't** clarear o Verde Institucional para um estado de interação — o único estado de hover/active do verde primário é escurecer (`--accent-hover`), nunca um tom mais claro.
- **Don't** hardcodar hex direto num seletor `.selection-card-*` novo — as quatro cores de card já são token em `:root` (`--accent`, `--accent-secondary`, `--accent-acervo`, `--accent-historico`); um quinto card ganha seu próprio par de tokens do mesmo jeito, nunca um valor solto.
