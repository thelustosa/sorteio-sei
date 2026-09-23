---
name: Sorteador de Processos SEI
description: Sorteio eletrônico auditável e registro de julgamentos para os colegiados da AGR
colors:
  institutional-green: "#00534b"
  institutional-green-hover: "#003e38"
  institutional-green-soft: "rgba(0, 83, 75, 0.08)"
  pending-teal: "#2f7668"
  pending-teal-hover: "#245f55"
  pending-teal-soft: "rgba(47, 118, 104, 0.09)"
  pending-teal-border: "rgba(47, 118, 104, 0.26)"
  pending-teal-text: "#1f544b"
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
  neutral-muted-strong: "#60746b"
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
  numeral:
    fontFamily: "ui-monospace, 'SFMono-Regular', Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.015em"
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
- **Teal dos Pendentes — fundo, borda e texto** (`rgba(47,118,104,.09)` / `rgba(47,118,104,.26)` / `#1f544b`): os três derivados que dão ao canal de atenção um preenchimento próprio. Existem porque o painel administrativo precisava pintar selo de pendência, caixa de propagação e aviso de consequência, e sem eles a tela inventou uma família âmbar inteira (`--warning`, `--warning-text`, `--warning-soft`, `--warning-border`) que operou fora deste documento até ser removida. O texto usa o tom mais escuro `#1f544b` para manter contraste AA sobre o fundo a 9%.

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
- **Texto Secundário Forte** (`#60746b`): um degrau acima do anterior, para texto pequeno que precisa segurar contraste no seu próprio tamanho — cabeçalho de tabela, placeholder e rótulo estrutural em caixa alta. Não é uma terceira cor de texto para uso livre: existe para o corpo de 12–13px, onde `--muted` começa a ficar leve.
- **Borda Institucional** (`rgba(0, 83, 75, 0.16)`): toda borda e divisor do sistema — cards, tabelas, inputs.

### Named Rules
**The Tinted Neutral Rule.** Nenhuma borda, divisor ou fundo neutro usa cinza puro — todos derivam do verde institucional em baixa opacidade (8% a 22%). Até o "neutro" deste sistema carrega a cor da marca.

**The Four Card Channels Rule.** A tela inicial tem exatamente quatro cards, e cada um tem seu próprio par cor/hover — Verde Institucional (Sorteio), Verde do Acervo, Verde do Histórico, Teal dos Pendentes (Registrar dados faltantes) — todos declarados como token em `:root`, nenhum hardcoded no seletor do card. Um quinto card não herda a cor de nenhum dos quatro; ganha o próprio par.

**The One Alert Color Rule.** Vermelho é exclusivo de erro e ação destrutiva. Qualquer outro aviso de atenção (como pendência de julgamento) usa o Teal dos Pendentes, não vermelho — o sistema reserva vermelho só para quando algo deu errado de verdade. E não abre uma terceira família: quando o painel administrativo precisou de fundo e borda para o canal de atenção, a resposta foram os derivados do próprio teal, não um âmbar novo.

**The Teal Is a Channel, Not a Tint Rule.** O Teal dos Pendentes só aparece onde há pendência ou propagação de uma correção. Ele não é cor de sobrancelha, de rótulo estrutural nem de borda decorativa — rótulo pequeno usa o Texto Secundário. Um teal gasto como enfeite deixa de significar "isto precisa da sua atenção".

**The Absence Is Not a State Rule.** Valor ausente sai como travessão em texto simples, nunca dentro de um selo. Um selo comunica um estado registrado; um travessão dentro dele parece campo quebrado — e no canal de status a ausência ainda herdava a cor de atenção, pintando "sem registro" como se fosse aviso.

## Typography

**Display Font:** Montserrat (com `ui-sans-serif, sans-serif`)
**Body Font:** pilha de sistema — `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

**Character:** Montserrat em peso 700 marca os poucos pontos de identidade (título de card, cabeçalho de página); todo o resto — corpo, rótulo, botão, tabela — fica na pilha de sistema, o que mantém a leitura densa da tela rápida em qualquer dispositivo sem carregar mais de um arquivo de fonte.

### Hierarchy
- **Display** (700, `clamp(1.45rem, 2.6vw, 1.85rem)`, 1.2): o título do painel do Acervo/Histórico (`.acervo-header-title-group h2`), branco sobre a barra verde — é o maior e mais bold texto do sistema inteiro, reservado às duas telas de dashboard. A arte do login (`.app-login-intro h2`) usa o mesmo degrau: é a porta de entrada dessas telas e da inicial, e antes ocupava dois tamanhos soltos (`clamp(1.5rem, 2.6vw, 2rem)` e `1.6rem` na variante do histórico do CREG).
- **Headline** (700, `clamp(1.125rem, 1.6vw, 1.375rem)`, 1.25): o título dentro de cada card de conteúdo (`.card h2`/`h3`) — maior que o próprio `<h1>` da página, porque é o que a pessoa vai fazer agora. Inclui o título do painel administrativo (`.admin-panel-heading h2`), que chegou a usar `clamp(1.2rem, 2vw, 1.55rem)`, fora da escala.
- **Title** (700, 1.125rem, 1.25): o `<h1>` do cabeçalho institucional — a identidade da página, deliberadamente mais discreta que o Headline abaixo dela.
- **Body** (400, 1rem, 1.5): texto corrido padrão do `<body>`.
- **Label** (700, 0.8125rem–0.875rem, 1.2–1.3): a família de texto estrutural pequeno e sempre em negrito — rótulo de botão, badge, campo de formulário (0,8125rem) e os rótulos de navegação como `#txtModo`/`.institution-name` (0,875rem, um degrau acima, mesma função).
- **Numeral** (monoespaçada de sistema, 700, 0.875rem): o número de processo SEI nas tabelas. Quinze dígitos que a pessoa compara linha a linha só se leem rápido com avanço fixo, e é o único lugar do projeto onde uma quarta família de fonte se justifica.

### Named Rules
**The Dashboard Outranks Everything Rule.** Só duas telas (Acervo e Histórico) usam o Display — o maior heading do sistema não é o `<h1>` de página nem o título do card, é o cabeçalho do próprio painel de dados. A única outra superfície nesse degrau é a arte do login, que é a entrada dessas mesmas telas. Se uma tela nova não for um dashboard, ela não herda esse tamanho.

**The Named Step Rule.** Todo `font-size` cai num degrau da hierarquia acima — um token `--text-*` ou o `clamp` do Display. Um tamanho entre dois degraus não vira um degrau novo: vira ruído que só o detector enxerga. Foi o que aconteceu com o login e com o título do painel administrativo, cada um com um `clamp` próprio a poucos décimos do degrau mais próximo.

**The Content Outranks the Masthead Rule.** Fora das duas telas de dashboard, o título dentro do card de conteúdo (Headline, `--text-xl`) é visualmente maior que o `<h1>` do cabeçalho da página (Title, `--text-lg`). A hierarquia grita o que a pessoa vai fazer agora, não o nome do sistema.

**The One-Weight Display Rule.** Montserrat só existe em peso 700 neste projeto — não há corte regular nem leve carregado. Um título em Montserrat é sempre bold; nunca introduza peso 400/500 dessa família.

**The Two-Weight Rule.** O sistema inteiro vive em dois pesos: 400 para corpo e 700 para tudo que é estrutural. Pesos intermediários da pilha de sistema — 750 e 800 especialmente — são sintéticos, ficam indistinguíveis do 700 ao lado dele e viram ruído em vez de hierarquia. Se um texto precisa de mais presença, o degrau é tamanho, caixa ou cor, nunca meio peso a mais.

**The Numeral Exception Rule.** A monoespaçada é só para o número de processo. Data, hora e contagem ficam na pilha de sistema com `font-variant-numeric: tabular-nums`, que já alinha a coluna sem trocar de família. Vale para todo card de detalhe (`.detalhe-table tbody th`, em peso 700): o do acervo e o do histórico mostravam o número na pilha de sistema e em peso 600, enquanto o painel administrativo já usava a monoespaçada.

## Layout

O contêiner principal é `width: min(1100px, 96%)`, centralizado. A tela inicial organiza as quatro opções (Sorteio, Acervo, Histórico, Registrar dados faltantes) em cards de grid de duas colunas (`minmax(250px, 0.85fr) minmax(340px, 1.15fr)`) que colapsam para uma coluna abaixo de 980px. Tabelas de dado usam `table-layout: fixed` com largura de coluna em porcentagem, e viram scroll horizontal dentro de `.table-scroll` quando a tela é estreita demais para as colunas de conteúdo (ver `#processTable` a partir de 981px).

Breakpoints observados no CSS: 480px, 600px, 620px, 768px, 880/881px e 980/981px — sem nome canônico atribuído; cada um resolve uma quebra específica de componente (barra de navegação, tabela, cards da tela inicial), não uma escala de dispositivo genérica.

Não existe uma escala de espaçamento em tokens (`--space-*`): o padding e o gap são valores em pixel escolhidos por componente (8, 10, 12, 14, 16, 18, 20, 24, 28px aparecem, sem uma progressão declarada). Trabalho novo deve casar com o valor mais próximo já usado no contexto, não inventar uma escala.

### Named Rules
**The Frame Shares One Edge Rule.** Cabeçalho, conteúdo e rodapé de uma tela alinham pela mesma borda. O rodapé usa `.footer-container`, não `.container`, então uma tela que alarga o `.container` precisa alargar o rodapé junto: o painel administrativo abriu o conteúdo para 1280px e deixou o rodapé em 1100px, e o brasão do rodapé ficou 88px à direita do brasão do cabeçalho numa tela de 1366px.

**The Hidden Column Rule.** No celular, rolagem lateral só serve a uma matriz — uma tabela em que comparar colunas é o propósito. Uma lista cuja linha termina num campo ou numa ação vira ficha abaixo de 600px, no molde de `#processTable`: cabeçalho fora de vista, cada campo com o próprio rótulo vindo de `data-label` (preenchido pelo JS a partir dos nomes das colunas). A 390px, o registro de julgamentos escondia os `<select>` de Voto e Status e o histórico escondia o "Ver processos" atrás de uma rolagem sem aviso — justamente o que cada tela existe para oferecer. A matriz do acervo continua rolando, mas com a coluna Período fixa à esquerda (`position: sticky`) e estreita, para que cada rolagem mostre o rótulo da linha. O sticky só funciona se a própria tabela não recortar: a regra global de `table` tem `overflow: hidden`, que faz da tabela o contêiner do sticky, e ali ela precisa de `overflow: visible`.

## Elevation & Depth

O sistema é estruturalmente plano: a separação entre superfícies vem quase sempre de borda de 1px, não de sombra. As sombras que existem aparecem em elementos que flutuam por cima de outro conteúdo — nunca em um card, botão ou linha de tabela em repouso.

Esta é a seção que o projeto mais já derivou. O painel administrativo chegou a renderizar seis sombras distintas numa única tela, todas em elemento no fluxo — card de login, painel de dados, barra de contexto, aba selecionada, botão de órgão e cartão de linha no celular —, nenhuma delas declarada aqui. Todas foram removidas: a hierarquia daquelas superfícies vem da borda tingida e do fundo, que é o que este sistema usa. A auditoria de 23/09/2026 ainda achou três no fluxo — um brilho verde (`0 2px 6px rgba(0, 83, 75, 0.16)`) no botão "Ver processos" do histórico, que o detector apontou como *glow*, e sombra nos dois spinners de carregamento — e uma no diálogo em preto puro (`rgb(0 0 0 / 28%)`), fora da família tingida. As três primeiras saíram; a do diálogo passou para o tom do texto.

### Shadow Vocabulary
- **Toast** (`box-shadow: 0 12px 28px rgba(17, 39, 32, 0.18)`): notificação flutuante fixa no canto da tela.
- **Panel** (`box-shadow: 0 12px 32px rgba(17, 39, 32, 0.09)`, `--shadow-panel`): painel/diálogo sobreposto do acervo — mais suave que o toast porque cobre mais área da tela. Hoje também está no próprio `.acervo-panel` do acervo e do histórico, que fica no fluxo: é uma exceção herdada, não um precedente para outro card.
- **Dialog** (`box-shadow: 0 24px 60px rgba(17, 39, 32, 0.28)`): o `<dialog>` de detalhe, a camada mais alta da tela — por isso a sombra mais longa e mais densa.
- **Menu** (`box-shadow: 0 10px 28px rgba(17, 39, 32, 0.18)`): o menu de exportação aberto sob o botão.
- **Popover** (`box-shadow: 0 8px 22px rgba(17, 39, 32, 0.16)`): o recado de exportação que aparece sob o menu.
- **Badge** (`box-shadow: 0 2px 6px rgba(17, 39, 32, 0.22)`, `--shadow-badge`): o selo de pendências, que flutua sobre a borda do card.

Toda sombra nasce do Texto Principal (`rgb(17, 39, 32)`) em opacidade — nunca de preto puro, nunca do verde institucional.

### Named Rules
**The Overlay-Only Shadow Rule.** Box-shadow é exclusivo de elementos que flutuam por cima de outro conteúdo — toast e painel/diálogo do acervo. Se o elemento não sai do fluxo normal, ele não recebe sombra. Um card, uma barra, uma aba ou uma linha de tabela em repouso se separam por borda de 1px.

**The Affordance Must Be True Rule.** Uma sombra que anuncia conteúdo escondido só pode existir quando há conteúdo escondido. O mesmo vale para qualquer sinal de rolagem: a dica de "deslize horizontalmente" e a parada de tabulação na região rolável seguem a mesma medição, e somem juntas quando a tabela cabe inteira na tela.

## Motion

O movimento aqui é confirmação, não decoração: ele diz que algo foi registrado,
que uma tela virou, que uma consulta está em andamento. Nenhuma animação existe
para chamar atenção — coerente com um sistema que a PRODUCT.md descreve como
ferramenta de auditoria antes de superfície de marca.

### Durações

Não há token de duração; os valores estão escritos em cada regra, e formam uma
escala curta e estável que trabalho novo deve reusar em vez de inventar um
número intermediário:

- **110–160ms** — resposta direta ao ponteiro: `transform` no `:active` (120ms),
  `background`/`border` em botão, chip e link de navegação (140–160ms).
- **180ms** — troca de vista dentro da mesma página (`view-fade-in`, em
  `#modeSelector`, `#sorteadorContent`, `#detalheCorpo`) e a entrada do
  indicador de carregamento (`spinner-fade-in`).
- **220ms** — entrada do toast (`toast-enter`, com `translateY(-12px)`).
- **250ms** — a transição entre páginas (padrão da UA, ver abaixo).
- **480ms** — `dashboard-reveal`, a entrada do painel do acervo já preenchido.
  É a animação mais longa do sistema e acontece uma vez por carregamento.
- **700–750ms** — rotação de spinner (`loading-spin`, `spin`).
- **1.8s** — `card-pulso-pendencia`, o único laço infinito, e só enquanto houver
  sessão sem voto ou status.

Curvas: `ease` para interação, `ease-out` para entrada, `linear` para rotação, e
`cubic-bezier(0.16, 1, 0.3, 1)` no `dashboard-reveal` — a única com desaceleração
pronunciada, porque é a única que carrega peso.

### Transição entre páginas

`@view-transition { navigation: auto }` liga a transição de documento cruzado nas
oito telas. O cross-fade padrão sozinho não serve aqui, porque as telas
compartilham a mesma moldura institucional e um fade de documento inteiro
dissolve justamente o que não muda. Então três peças saem do grupo `root` e
ganham nome próprio:

| Elemento | `view-transition-name` |
|---|---|
| `.page-header-wrapper` | `moldura-cabecalho` |
| `.green-bar` | `moldura-barra` |
| `.page-footer` | `moldura-rodape` |

Cada uma morfa de uma posição para a outra em vez de dissolver — o masthead tem
altura diferente por tela (8px de diferença no desktop, 23px em 390px) e sem os
nomes essa diferença aparecia como um salto com a faixa duplicada. Dentro delas
o texto muda, e para não haver dois textos legíveis ao mesmo tempo o cross-fade
vira revezamento: `moldura-sai` (110ms) apaga o antigo, `moldura-entra` (140ms,
com 110ms de atraso) acende o novo. Como o retrato inclui o fundo, o
`::view-transition-group` de cada peça recebe a cor da faixa — sem isso a barra
verde pisca no meio da troca.

Um `location.replace` — a correção de rota do `bootstrap.js`, que manda quem só
tem um colegiado para a tela certa — não é destino: `redirecionarSemTransicao`
marca a navegação e o documento seguinte chama `skipTransition()`. Correção de
rota não ganha cerimônia de troca de página.

### Indicadores de carregamento

O indicador tem um contrato de tempo próprio, em `supabase.js`:
`ATRASO_DO_INDICADOR` (150ms, espelhado no `animation-delay` do
`spinner-fade-in`) e `TEMPO_MINIMO_DO_INDICADOR` (600ms). Resposta abaixo do
atraso não acende nada; acima dele, o indicador fica até completar o mínimo. Os
dois valores juntos eliminam tanto o piscar quanto o lampejo pela metade.

Onde o indicador aparece importa tanto quanto quando: `.session-loading` cobre o
que existe antes da tela (permissão, download do script), e cada tela monta a
própria moldura de forma síncrona e põe o indicador dentro dela —
`.painel-carregando` no lugar da tabela do acervo/histórico, `#pautasContainer`
na lista de julgados, `.detalhe-loading` no card de processos.

No acervo e no histórico a moldura é HTML estático, e por isso o bootstrap já a
mostra na consulta de permissão, com o indicador no lugar da tabela
(`moldura` em `PAGINAS`, `bootstrap.js`); o card `.session-loading` fica para
as telas sem moldura estática e para a mensagem de erro. Antes eram dois
indicadores em fila — "Preparando…" num card no meio da página, ~165ms de
nada, e "Carregando…" 48px abaixo, dentro do painel. O Atualizar do histórico,
que mantinha a lista antiga sem sinal nenhum de consulta, passou a mostrar o
andamento no lugar da tabela, como o acervo.

### Movimento reduzido

`prefers-reduced-motion: reduce` desliga tudo: spinner, toast, pulso de
pendência, `backdrop-filter` do diálogo, `transform` de `:active`, as trocas de
vista — e a transição entre páginas, que é a única que `animation: none` não
alcança e precisa de `@view-transition { navigation: none }`.

A lista é explícita, seletor por seletor, e por isso **toda animação ou
transição nova precisa ser acrescentada a ela**. A auditoria de 23/09/2026
achou duas que tinham ficado de fora: o `view-fade-in` do `#cardAdmin` (que
estava na regra de entrada mas não na de movimento reduzido) e a rotação da
seta do menu Exportar.

### Named Rules

**The Frame Stays Rule.** O que é igual em todas as telas — o brasão, a barra
verde, a faixa do rodapé — nunca dissolve numa troca de página: ganha
`view-transition-name` e morfa. Um elemento novo de moldura entra na mesma
regra, com nome próprio e a cor de fundo no `::view-transition-group`.

**The Indicator Earns Its Entrance Rule.** Todo indicador de carregamento passa
por `aguardarIndicador`: ou não aparece, ou fica tempo de ser lido. Meio termo —
acender e apagar dentro da própria animação de entrada — é pior que animação
nenhuma.

**The One Indicator Rule.** Uma espera tem um indicador só, num lugar só. Quem
põe o indicador é `mostrarIndicador(conteiner, texto)` (`supabase.js`): se o
contêiner já mostra um, ele só troca o texto. Recriar o nó reiniciava a entrada
(o atraso de 150ms e o fade) — trocar o recorte do acervo duas vezes seguidas
fazia o indicador sumir e voltar no meio de uma espera que continuava a mesma.
Passar a vez de um indicador para outro em outro lugar da tela conta como dois.

**The Arrival Has a Name Rule.** Uma transição de página precisa aterrissar num
lugar identificável. Tela que busca dados mostra a própria moldura com o título
e o indicador dentro dela, nunca um spinner solto sobre página em branco.

## Shapes

Três raios cobrem o sistema inteiro: `8px` (controles — botão, input, select, chip de navegação), `12px` (cards, tabelas, painéis, diálogos) e `999px` (pill — badges, chips de filtro, botões grandes de seleção de modo). Bordas são sempre 1px e sempre a Borda Institucional tingida de verde (ver Colors) — nunca uma borda mais grossa ou de cor neutra pura. `50%` para um elemento circular (avatar de ícone, marcador) não é um quarto degrau: é forma, não raio.

### Named Rules
**The Three Radii Rule.** Use `var(--radius-control)`, `var(--radius-card)` ou `var(--radius-pill)`, nunca um pixel solto. O painel administrativo chegou a renderizar nove raios numa tela — e o mais usado, `7px`, em catorze elementos, ficava a um pixel do degrau do sistema: perto demais para alguém notar de propósito, longe demais para alguma coisa casar. Um valor a um ou dois pixels de um degrau existente é sempre erro, nunca decisão.

**The Field Is a Field Rule.** Todo controle de formulário — inclusive `input[type='date']`, `type='number'` e `select` — usa a mesma borda de 1px tingida, o mesmo raio de controle e o mesmo respiro interno de `8px 10px`. A lista de seletores que aplica isso é explícita, então **um tipo de campo novo precisa ser acrescentado a ela**: um `input` que não esteja na lista cai no controle cru do navegador, com borda cinza de 2px e canto reto ao lado dos campos institucionais. Foi o que aconteceu com `date`, o único tipo que só existe no painel administrativo.

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
- **Pending Badge** (`.pendencias-badge`): pill flutuante (posição absoluta no canto do card) com contagem de sessões pendentes — fundo Teal dos Pendentes, texto branco; o card em que vive ganha uma borda/glow que pulsa sem parar enquanto houver pendência. Some sozinha: a checagem roda uma vez por carregamento da página, então o pulso só volta a aparecer se ainda houver algo pendente na próxima vez que a tela abrir.

### Cards / Containers
- **Corner Style:** raio de card (12px).
- **Background:** Superfície Branca por padrão; os quatro cards de seleção da tela inicial (`.selection-card-*`) têm cada um sua própria cor de destaque de título e botão (ver The Four Card Channels Rule em Colors), e dois deles trocam também o fundo — "Registrar dados faltantes" usa o Painel Institucional, "Histórico de sorteios" usa a Superfície do Histórico.
- **Shadow Strategy:** nenhuma — ver Elevation & Depth. A separação vem de borda de 1px.
- **Border:** 1px, Borda Institucional (ou a cor de destaque do card, quando há pendência).
- **Internal Padding:** 24px (28px nos cards de seleção da tela inicial, 20px/16px nos breakpoints estreitos).

### Tables
- **Style:** cabeçalho com fundo levemente tingido (`--table-heading`), linha de dado com fundo branco e hover em tingido de verde bem sutil (`--table-row-hover`); borda inferior de 1px entre linhas, sem borda vertical entre colunas.
- **Cabeçalho:** um só rótulo estrutural em todas as tabelas — caixa alta, `--text-xs`, `letter-spacing: 0.04em`, Texto Secundário Forte. O sorteador e o registro de julgamentos usavam a regra global `thead th` em caixa normal e na cor do corpo, e liam como outro sistema ao lado do acervo, do histórico e do painel administrativo. A correção foi na regra global, não em cada tabela.
- **Celular:** abaixo de 600px, `#julgadosTable` e `.historico-table` viram ficha (ver The Hidden Column Rule em Layout); a ficha do histórico usa `grid-template-areas` para pôr data e horário no topo, as cadeiras no meio e a contagem ao lado do "Ver processos". Na ficha, o fundo é da linha inteira: o realce pintado em cada `<td>`, com o vão da grade entre eles, virava uma colcha de retalhos.
- **Layout das listas:** as listas administrativas (sessões, distribuições, auditoria) usam `table-layout: fixed` e trilhos declarados por visão, para as datas caírem num ritmo regular. Ações vem imediatamente depois do identificador da linha (`Data` ou `Processo`), nunca isolada na borda direita.
- **Cards de detalhe:** o card do acervo, o do histórico, o da Meta 45 e os detalhes "Abrir sessão" e "Abrir distribuição" do painel administrativo seguem The Equal Gutter Rule, abaixo: layout automático, tudo centralizado — cabeçalho e dado no mesmo eixo, inclusive Assunto e Interessado —, e cada coluna com o próprio conteúdo mais a mesma folga. Valor curto não quebra linha ("Auto de Infração", "Sem recurso"); quebra só o texto corrido (Interessado, o assunto por extenso do Conselho), o rótulo do cabeçalho, e — entre 961px e ~1250px, antes de a tabela rolar — o selo mais longo e o e-mail da autoria, este antes do "@" (`<wbr>`), nunca no meio da palavra. As quatro ações do painel formam uma grade 2 × 2, igual em toda linha.
- **Largura dos cards:** fixa por tipo, nunca pelo conteúdo — um card que crescesse quando os dados chegam saltaria de lado logo depois do indicador. 46rem para o histórico da Câmara e para a Meta 45; 60rem para o acervo; 64rem para o histórico do Conselho, que traz a razão social. No celular o card rola de lado com um piso (520px; 680px no acervo e 720px no histórico do Conselho), e a folga é repartida sobre esse piso.
- **Alinhamento — eixos consistentes:** nas listas-resumo, cabeçalhos e valores são centralizados para reforçar os trilhos equidistantes. O eixo sempre vale para o `th` e o `td` juntos. `white-space: nowrap` fica restrito a valores curtos que realmente não devem partir, como data/hora e identificador.
- **Density:** cada família de tabela (`#processTable`, `#julgadosTable`, `.acervo-table`, `.historico-table`, `.detalhe-table`) ajusta sua própria largura mínima e comportamento de coluna — não há uma tabela genérica única.

#### Named Rules
**The Equal Gutter Rule.** Num card de detalhe, o vão entre o conteúdo de duas colunas vizinhas é o mesmo em todo o card. Com o conteúdo centralizado, esse vão é a sobra de uma coluna mais a sobra da outra, e largura fixa em porcentagem dava a cada coluna uma sobra diferente: a auditoria de 23/09/2026 mediu vãos de 11px a 130px num mesmo card, um vão negativo no detalhe da sessão ("Reformar parcialmente" entrando em Status), e-mail e "Ordem" cortados, e os quatro detalhes do painel rolando de lado a 1366px por causa de pisos de 1320px e 1360px. A regra mora numa função só, `equalizarColunas(tabela)` em `supabase.js`: o layout automático decide o que quebra, mede-se a extensão real do conteúdo de cada coluna (linhas já quebradas, caixas de botão e de selo) e a sobra do contêiner é repartida igualmente como `--folga`, somada ao respiro lateral de cada célula (`padding-inline: calc(12px + var(--folga, 0px))`). A folga entra no respiro, não na caixa do texto — por isso o texto quebrado conserva as mesmas linhas. Um `ResizeObserver` refaz a conta quando o card aparece ou a janela muda de largura. Tabela nova de detalhe chama a mesma função; nunca uma largura por coluna.

**The Row Owns Its Highlight Rule.** O realce de linha pinta a linha inteira, inclusive o `<th>` que a identifica (o número do processo nos cards). A regra global pintava só `td`, e a linha ficava com um retalho branco no meio.

### Inputs / Fields
- **Style:** borda 1px Borda Institucional, raio de controle (8px), fundo Superfície Branca, `width: 100%` por padrão.
- **Focus:** contorno de 2px na cor de ação, deslocado 2px para fora — igual ao foco de botão, mesma regra em todo o sistema.
- **Placeholder / Select vazio:** `.placeholder-select` usa Texto Secundário mais forte em vez do texto normal, sem mudar o fundo.

### Navigation
- Barra verde de 48px de altura fixa no topo do conteúdo (`.green-bar`), com o nome do modo à esquerda e ações (Voltar/Sair) à direita como botões ghost. Tipografia sempre em Label (700, pequena), nunca Body.
- **Celular (dashboards, abaixo de 480px):** as ações viram uma grade de duas colunas. Quando o número de ações visíveis é ímpar — três com sessão no histórico (Atualizar, Voltar, Sair) ou uma só antes do login (Voltar) —, a última ocupa a linha inteira (`:nth-last-child(1 of :not([hidden])):nth-child(odd of :not([hidden]))`). Antes ela ficava presa à metade esquerda, com um vão ao lado.

## Do's and Don'ts

### Do:
- **Do** manter o Verde Institucional exclusivo para ação primária e identidade fora da tela inicial; dentro dela, cada um dos quatro cards vive só do seu próprio canal (ver The Four Card Channels Rule).
- **Do** derivar toda borda e divisor da Borda Institucional tingida — nunca introduzir cinza neutro puro.
- **Do** reservar `box-shadow` só para elementos que flutuam por cima de outro conteúdo (toast e painel/diálogo) — nunca num card, botão, aba ou linha de tabela em repouso.
- **Do** acrescentar cada novo tipo de `input` à lista de seletores que estiliza os campos — ver The Field Is a Field Rule em Shapes.
- **Do** mover o foco quando um bloco que o continha é escondido. O diálogo de duas etapas do painel administrativo trocava o formulário pela revisão e deixava o foco cair no `<body>`: quem usa teclado ou leitor de tela não era avisado da etapa que existe justamente para ser lida antes de gravar.
- **Do** levar o foco ao título do painel quando uma ação troca a vista inteira. No painel administrativo, "Abrir sessão", "Abrir distribuição", "Voltar" e "Tentar novamente" somem com a própria troca, e o foco caía no `<body>`. `abrirComFoco()` chama `carregar()` e foca `#painelTitulo`, que já tinha `tabindex="-1"` para isso — as outras telas já faziam o mesmo com os seus títulos.
- **Do** escrever o subtítulo do cabeçalho (`p.lead`) de modo que ele continue verdadeiro em todos os estados da página. O da inicial dizia "Preencha os campos solicitados, defina a quantidade de processos e sorteie" também no login e na escolha de colegiado, onde não há campo nenhum.
- **Do** deixar visível, nas duas etapas de uma confirmação, todo campo cujo valor vai ser gravado. Esconder o motivo da alteração na hora de confirmar tirava da vista o texto que a própria tela promete mandar para a auditoria.
- **Do** traduzir nome de tabela e chave de coluna do banco antes de mostrá-los. `julgados_cj #41` e `voto:` são estrutura interna; quem lê a auditoria é a secretária executiva.
- **Do** escolher o plural com uma condição (`${n} ${n === 1 ? 'sessão' : 'sessões'}`). "5 sessão(ões) registrada(s)" pede que a pessoa monte a frase de cabeça com a contagem ali do lado.
- **Do** manter Montserrat só para os pontos de identidade (título de painel de dashboard, título de card, `<h1>`, rótulos estruturais curtos) em peso 700 — o resto fica na pilha de sistema.
- **Do** manter 44px de altura mínima em botão, input e select (`button, input, select { min-height: 44px }`) — é um piso de alvo de toque já embutido no sistema, não uma decisão a repensar por tela.

### Don't:
- **Don't** introduzir um modo escuro sem uma decisão de produto — hoje existe um único tema, comprometido, não uma lacuna.
- **Don't** inventar uma escala de espaçamento em token — ela não existe; use o valor em pixel mais próximo já presente no contexto.
- **Don't** usar vermelho para ênfase neutra ou aviso brando — é exclusivo de erro e ação destrutiva; pendência usa o Teal dos Pendentes.
- **Don't** abrir uma família de cor semântica nova quando o canal de atenção já existe. Uma tela que precise de fundo, borda e texto para "atenção" usa os derivados do Teal dos Pendentes, não um âmbar, um laranja ou um amarelo próprios — ver The One Alert Color Rule em Colors.
- **Don't** gastar o Teal dos Pendentes em sobrancelha, rótulo estrutural ou borda lateral decorativa. Borda colorida de 3px num item de lista é, além disso, o padrão que o detector do projeto sinaliza como tique de interface gerada.
- **Don't** usar peso 750 ou 800 — o sistema tem dois pesos, 400 e 700 (ver The Two-Weight Rule em Typography).
- **Don't** desenhar um valor ausente como selo. Travessão em texto simples; um selo diz que existe um estado registrado.
- **Don't** ecoar a mensagem da exceção dentro da própria frase de erro. `Não foi possível carregar os dados (${err.message})` produzia "não foi possível carregar os dados (não foi possível consultar o serviço)". A frase principal diz o que fazer; o texto técnico desce para uma linha de apoio, em Texto Secundário e peso normal. O caminho é um só: `mostrarErro(caixa, frase, err.message)` para as caixas `.load-error` e `aviso(frase, 'erro', err.message)` para o aviso flutuante, os dois em `supabase.js`. A auditoria de 23/09/2026 achou o molde antigo em doze lugares de cinco arquivos, mesmo depois de o painel administrativo ter sido corrigido — por isso a regra vale para a função, não para a tela.
- **Don't** deixar o ponto de status numa cor fixa. Verde ao lado de "não foi possível carregar" faz a cor contradizer o texto justamente nos dois estados em que ela teria algo a dizer. O painel administrativo resolveu com `data-estado`; o acervo e o histórico ficaram com o verde ao lado de "Atualização indisponível" até a auditoria de 23/09/2026. Hoje o ponto lê o estado que a tela já expõe — vermelho quando a `.load-error` do painel está visível, cinza enquanto o painel está `aria-busy` —, sem um segundo dono no JS.
- **Don't** deixar uma cápsula ou um selo sem texto. Quando a carga do acervo falhava, o total era apagado e a cápsula do cabeçalho ficava só com o ícone; agora ela some (`.acervo-scope:has(> span:empty)`).
- **Don't** esconder atrás de rolagem lateral o campo ou a ação que encerra a linha de uma lista — ver The Hidden Column Rule em Layout.
- **Don't** relaxar as regras na folha de impressão. O `@media print` do acervo usava os cinzas `#4a5568` e `#718096` de outra paleta e peso 800; o papel também segue The Tinted Neutral Rule e The Two-Weight Rule.
- **Don't** convidar para uma ação que a tela acabou de dizer ser impossível — "Abra uma sessão para consultar seus processos" não pode continuar no rodapé de uma lista vazia ou de um erro de carregamento.
- **Don't** dar mais de um nome ao mesmo registro. Aba, título, botão e rodapé precisam usar a mesma palavra; o painel administrativo chegou a dizer sorteio, distribuição e rodada para a mesma linha, numa tela só.
- **Don't** localizar ou dimensionar Ações por `:last-child`. Use `.col-acoes`, posicione-a logo depois do identificador e reserve uma proporção explícita para a visão; assim ela não deriva para a borda direita quando a tabela ganha outra coluna.
- **Don't** misturar o eixo do cabeçalho com o das células. Métricas de lista-resumo ficam centralizadas; texto longo fica à esquerda; valores curtos usam `tabular-nums` quando isso melhora a comparação.
- **Don't** repetir a garantia de auditoria em mais de um lugar por tela. Ela é verdadeira uma vez; repetida três vezes ocupa a área nobre do painel com texto que ninguém relê.
- **Don't** dar `view-transition-name` a um elemento sem pintar a cor de fundo
  dele no `::view-transition-group` correspondente — o retrato inclui o fundo, e
  o revezamento faz a faixa piscar (ver Motion).
- **Don't** clarear o Verde Institucional para um estado de interação — o único estado de hover/active do verde primário é escurecer (`--accent-hover`), nunca um tom mais claro.
- **Don't** hardcodar hex direto num seletor `.selection-card-*` novo — as quatro cores de card já são token em `:root` (`--accent`, `--accent-secondary`, `--accent-acervo`, `--accent-historico`); um quinto card ganha seu próprio par de tokens do mesmo jeito, nunca um valor solto.
