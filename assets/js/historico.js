// Histórico de sorteios: quais rodadas já foram feitas, quando, para quem, e
// quais processos entraram em cada uma.
//
// O agrupamento não é feito aqui. Os dois acervos são fechados ao navegador —
// só têm política de INSERT (ver schema.sql) —, então quem reúne as linhas em
// rodadas é a função historico_sorteios e quem lista os processos de uma delas
// é processos_sorteio. As duas só leem: abrir o histórico não altera registro
// nenhum, e esta página não tem um único caminho de escrita.
//
// A mesma página serve os dois colegiados, como o painel do acervo: o que muda
// entre eles cabe na tabela abaixo — a sigla que vai para o banco e o
// vocabulário das colunas. Quem escolhe é o data-colegiado do <body>.
const COLEGIADOS = {
  cj: {
    sigla: 'CJ',
    nome: 'Câmara de Julgamento',
    // Com o artigo junto: 'A Câmara' e 'O Conselho' não saem do mesmo molde, e
    // a frase do estado vazio sairia sem artigo nenhum se montada com `nome`.
    sujeito: 'A Câmara de Julgamento',
    destinos: 'Cadeiras',
    destino: 'Cadeira',
    // Na Câmara a coluna de decisão registra se o autuado apresentou DEFESA.
    decisao: 'Defesa',
    // O interessado é campo livre que só a tela do sorteio do Conselho
    // preenche: na Câmara a coluna nem existe no acervo.
    interessado: false,
    arquivo: 'historico-cj',
  },
  creg: {
    sigla: 'CREG',
    nome: 'Conselho Regulador',
    sujeito: 'O Conselho Regulador',
    destinos: 'Unidades',
    destino: 'Unidade',
    decisao: 'Recurso',
    interessado: true,
    arquivo: 'historico-creg',
  }
};

const COL = COLEGIADOS[document.body.dataset.colegiado] || COLEGIADOS.cj;

// O dia em que a série começa, igual para os dois colegiados: 27/08/2026, o
// primeiro sorteio feito nesta tela. Quem corta é o banco — a função
// historico_marco, chamada pelas duas RPCs —, e esta cópia existe só para a
// tela poder DIZER a data. Um teste compara as duas; se divergirem, a frase
// mentiria sobre o recorte que o banco aplicou.
const INICIO_DA_SERIE = '2026-08-27';

const COLUNAS = ['Data', 'Horário', 'Processos', COL.destinos, 'Detalhes'];

const historicoPanel = document.getElementById('historicoPanel');
const historicoTabela = document.getElementById('historicoTable');
const historicoVazio = document.getElementById('historicoVazio');
const historicoVazioTexto = document.getElementById('historicoVazioTexto');
const historicoErro = document.getElementById('historicoErro');
const historicoTotal = document.getElementById('historicoTotal');
const historicoAtualizado = document.getElementById('historicoAtualizado');
const btnAtualizar = document.getElementById('btnAtualizar');
const btnTentarNovamente = document.getElementById('btnTentarNovamente');
const loginOnlyCard = document.querySelector('[data-login-only]');
const painelCarregando = document.getElementById('painelCarregando');
const tabelaScroll = document.querySelector('.table-scroll');
const detalheDialog = document.getElementById('detalheDialog');
const detalheTitulo = document.getElementById('detalheTitulo');
const detalheResumo = document.getElementById('detalheResumo');
const detalheLoading = document.getElementById('detalheLoading');
const detalheCorpo = document.getElementById('detalheCorpo');
const detalheTabela = document.getElementById('detalheTable');
const detalheErro = document.getElementById('detalheErro');
const btnFecharDetalhe = document.getElementById('btnFecharDetalhe');
const btnExportarDetalhe = document.getElementById('btnExportarDetalhe');
// Cada abertura invalida a anterior: fechar no Escape durante uma busca lenta e
// clicar noutra rodada deixaria a resposta atrasada chegar por último e
// sobrescrever o card — título de um sorteio, lista de outro.
let detalhePedido = 0;
// Mesmo contador para a lista. Hoje nenhum caminho da tela dispara duas
// cargas ao mesmo tempo — "Atualizar" fica `disabled` e "Tentar novamente"
// mora dentro do bloco de erro, que some no início de cada carga —, mas isso
// depende de dois efeitos colaterais distantes; o contador guarda a regra
// aqui, onde ela vale: quem chegar atrasado não desenha nada.
let historicoPedido = 0;
// O que está aberto no card agora: só o que está nele pode ser exportado, e só
// depois que a lista chega — nunca a resposta de uma busca que já saiu de foco.
let detalheAtual = null;

historicoVazioTexto.textContent = `O histórico reúne os sorteios realizados no sistema a partir de `
  + `${dataBR(INICIO_DA_SERIE)}. ${COL.sujeito} não distribuiu processos nesse período — o próximo `
  + `sorteio aparece aqui assim que for realizado.`;

btnAtualizar.addEventListener('click', () => carregarHistorico());
btnTentarNovamente.addEventListener('click', () => carregarHistorico());
historicoTabela.addEventListener('click', abrirDetalheDaLinha);
btnFecharDetalhe.addEventListener('click', () => detalheDialog.close());
btnExportarDetalhe.addEventListener('click', exportarDetalheDocx);
// Clique no ::backdrop chega como clique no próprio dialog: fechar ali é o que
// a pessoa espera de um card modal, e o <dialog> não faz isso sozinho.
detalheDialog.addEventListener('click', evento => {
  if (evento.target === detalheDialog) detalheDialog.close();
});


// ── A moldura do painel, antes dos dados ─────────────────────────────────────
// A transição entre páginas (@view-transition, em index.css) entrega o quadro
// que existir no primeiro render da tela nova. Sem isto ela entregava um
// spinner centralizado numa página em branco: a animação vendia chegada e
// abria uma sala de espera. Agora o que ela entrega é o painel com nome —
// título, escopo, rodapé — e o indicador apenas onde a tabela vai ficar.

function mostrarMolduraDoPainel() {
  if (loginOnlyCard) loginOnlyCard.hidden = true;
  historicoPanel.hidden = false;
}

// O indicador ocupa o lugar da tabela — na abertura e também no Atualizar, que
// antes mantinha a lista antiga na tela sem sinal nenhum de consulta por até o
// tempo da resposta, enquanto o acervo, ao lado, mostrava o andamento.
function mostrarCarregamentoDaTabela(texto) {
  if (tabelaScroll) tabelaScroll.hidden = true;
  return mostrarIndicador(painelCarregando, texto);
}

// O erro do carregamento inicial quem mostra é o bootstrap, dentro do card de
// sessão — e esse card só aparece com o painel fora da tela. Devolver os dois
// ao estado anterior é o que mantém a mensagem visível.
function esconderMolduraDoPainel() {
  historicoPanel.hidden = true;
  if (loginOnlyCard) loginOnlyCard.hidden = false;
  revelarTabela();
}

function revelarTabela() {
  painelCarregando.hidden = true;
  painelCarregando.replaceChildren();
  if (tabelaScroll) tabelaScroll.hidden = false;
}

async function inicializarHistorico() {
  mostrarMolduraDoPainel();

  const carregado = await carregarHistorico({ carregamentoInicial: true });
  if (!carregado) return;

  // "Atualizar" só aparece junto com a lista: revelado com a moldura, ele
  // redesenharia uma tabela que ainda não existe.
  btnAtualizar.hidden = false;
}

function dataHoraBR() {
  const agora = new Date();
  return `${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit'
  })}`;
}

// aaaa-mm-dd → dd/mm/aaaa, sem passar por Date: o construtor lê data pura como
// UTC e, em fuso negativo, devolveria o dia anterior.
function dataBR(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// O dia da semana é do calendário local, montado a partir das partes pela mesma
// razão: `new Date('2026-08-27')` é meia-noite em UTC, que aqui ainda é dia 26.
//
// A maiúscula é feita aqui, e só na primeira letra: `text-transform: capitalize`
// no CSS devolveria "Quinta-Feira", que não é como se escreve em português.
function diaDaSemana(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return '';
  const nome = new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', { weekday: 'long' });
  return nome.charAt(0).toLocaleUpperCase('pt-BR') + nome.slice(1);
}

// O carimbo é um instante (timestamptz): convertido para o relógio de quem lê,
// que é o mesmo de quem sorteou. Ele é opcional no acervo — uma carga em lote
// pode deixá-lo vazio —, e nesse caso a coluna fica com o travessão em vez de
// uma hora inventada.
function horaBR(carimbo) {
  if (!carimbo) return '';
  const instante = new Date(carimbo);
  return Number.isNaN(instante.getTime())
    ? ''
    : instante.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const quantidadeProcessos = total => total === 1 ? '1 processo' : `${total} processos`;
const quantidadeSorteios = total => total === 1 ? '1 sorteio' : `${total} sorteios`;

function celula(texto, tag = 'td', classe = '') {
  const el = document.createElement(tag);
  if (tag === 'th') el.scope = classe === 'linha' ? 'row' : 'col';
  if (classe && classe !== 'linha') el.className = classe;
  // String() explícito: o DOM converteria sozinho, mas deixar number aqui
  // tornaria o valor da célula dependente do motor em vez do código.
  el.textContent = String(texto);
  return el;
}

// A chave da rodada viaja no dataset e volta inteira para a função do banco.
// `sorteado_em` ausente fica vazio aqui e sai como null na chamada, que é o que
// o `is not distinct from` espera do outro lado.
function identidade(sorteio) {
  return {
    data: String(sorteio.data_sorteio).slice(0, 10),
    carimbo: sorteio.sorteado_em || ''
  };
}

// Durante o deploy a página nova pode encontrar a RPC antiga por alguns
// instantes. Nesse caso as siglas continuam aparecendo, apenas sem inventar uma
// contagem. Quando `distribuicao` existe, cada número vem da mesma agregação que
// calcula o total da rodada no banco.
function distribuicaoDo(sorteio) {
  const itens = Array.isArray(sorteio.distribuicao)
    ? sorteio.distribuicao
    : (sorteio.destinos || []).map(destino => ({ destino, processos: null }));

  return itens
    .filter(item => item && String(item.destino || '').trim())
    .map(item => {
      const numero = item.processos == null ? null : Number(item.processos);
      return {
        destino: String(item.destino).trim(),
        processos: Number.isInteger(numero) && numero >= 0 ? numero : null
      };
    });
}

// Cada pill também é a porta de entrada do card filtrado: um clique nele abre
// exatamente os processos daquele destino, sem passar pela rodada inteira.
function celulaDestinos(sorteio) {
  const celulaEl = celula('', 'td', 'historico-destinos');
  const distribuicao = distribuicaoDo(sorteio);
  if (!distribuicao.length) {
    celulaEl.textContent = '—';
    return celulaEl;
  }

  const { data, carimbo } = identidade(sorteio);
  const lista = document.createElement('span');
  lista.className = 'historico-destinos-lista';
  const descricoes = [];

  distribuicao.forEach(({ destino, processos }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'historico-destino';
    Object.assign(item.dataset, { data, carimbo, destino });
    const sigla = document.createElement('span');
    sigla.className = 'historico-destino-sigla';
    sigla.textContent = destino;
    item.append(sigla);

    if (processos !== null) {
      const contagem = document.createElement('span');
      contagem.className = 'historico-destino-contagem';
      contagem.textContent = String(processos);
      item.append(contagem);
      descricoes.push(`${destino}: ${quantidadeProcessos(processos)}`);
      item.setAttribute('aria-label', `Ver os ${quantidadeProcessos(processos)} de ${destino}`);
    } else {
      descricoes.push(destino);
      item.setAttribute('aria-label', `Ver os processos de ${destino}`);
    }

    lista.append(item);
  });

  celulaEl.setAttribute('aria-label', descricoes.join('; '));
  celulaEl.append(lista);
  return celulaEl;
}

// Uma linha por rodada, na ordem que o banco devolveu — da mais recente para a
// mais antiga. A data é a identidade da linha, e por isso é o <th> dela.
function desenhar(sorteios) {
  // Sem rodada nenhuma a tabela sai inteira, cabeçalho incluído: o estado vazio
  // logo acima já explicou o que houve, e uma faixa de colunas sobre o nada só
  // faz a tela parecer meio carregada.
  if (!sorteios.length) {
    historicoTabela.replaceChildren();
    return;
  }

  const thead = document.createElement('thead');
  const cabecalho = document.createElement('tr');
  COLUNAS.forEach(rotulo => cabecalho.append(celula(rotulo, 'th')));
  thead.append(cabecalho);

  const tbody = document.createElement('tbody');
  sorteios.forEach(sorteio => {
    const { data, carimbo } = identidade(sorteio);
    const tr = document.createElement('tr');

    // Data e dia da semana em duas linhas: a data é o que se procura, o dia da
    // semana é o que confirma que se achou a sessão certa.
    const celulaData = document.createElement('th');
    celulaData.scope = 'row';
    celulaData.className = 'historico-data';
    const dia = document.createElement('span');
    dia.className = 'historico-data-dia';
    dia.textContent = dataBR(data);
    const semana = document.createElement('span');
    semana.className = 'historico-data-semana';
    semana.textContent = diaDaSemana(data);
    celulaData.append(dia, semana);
    tr.append(celulaData);

    const hora = horaBR(carimbo);
    const celulaHora = celula(hora || '—', 'td', 'historico-hora');
    if (!hora) {
      celulaHora.title = 'Rodada gravada sem o horário do sorteio';
      celulaHora.setAttribute('aria-label', 'Horário não registrado');
    }
    tr.append(celulaHora);

    tr.append(celula(sorteio.processos, 'td', 'historico-numero'));

    // Cada destino leva a sua parcela da rodada. A soma desses números é o total
    // da coluna anterior; juntos eles respondem "quantos foram para quem".
    tr.append(celulaDestinos(sorteio));

    // O alvo é um <button> dentro do <td>: a célula precisa continuar sendo
    // célula para o leitor de tela, e o botão nativo já traz foco, Enter e
    // Espaço sem handler nenhum.
    const acao = document.createElement('td');
    acao.className = 'historico-acao';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'button-secondary historico-ver';
    botao.textContent = 'Ver processos';
    const quando = hora ? `${dataBR(data)} às ${hora}` : dataBR(data);
    botao.setAttribute('aria-label',
      `Ver os ${quantidadeProcessos(sorteio.processos)} do sorteio de ${quando}`);
    Object.assign(botao.dataset, { data, carimbo });
    acao.append(botao);
    tr.append(acao);
    // Rótulo de cada campo para a ficha do celular, onde o cabeçalho sai de vista.
    COLUNAS.forEach((rotulo, i) => { tr.children[i].dataset.label = rotulo; });

    tbody.append(tr);
  });

  historicoTabela.replaceChildren(thead, tbody);
}

async function carregarHistorico({ carregamentoInicial = false } = {}) {
  const pedido = ++historicoPedido;
  const indicadorIniciadoEm = mostrarCarregamentoDaTabela(carregamentoInicial ? 'Carregando o histórico…' : 'Atualizando o histórico…');
  historicoErro.hidden = true;
  historicoVazio.hidden = true;
  historicoAtualizado.textContent = 'Carregando…';
  btnAtualizar.disabled = true;
  btnAtualizar.setAttribute('aria-busy', 'true');
  historicoPanel.setAttribute('aria-busy', 'true');

  let sorteios;
  try {
    sorteios = await api('rpc/historico_sorteios', { paginar: true,
      method: 'POST',
      body: JSON.stringify({ p_colegiado: COL.sigla })
    });
    await aguardarIndicador(indicadorIniciadoEm);
  } catch (err) {
    await aguardarIndicador(indicadorIniciadoEm);
    if (carregamentoInicial) {
      esconderMolduraDoPainel();
      throw err;
    }
    if (pedido !== historicoPedido) return false;
    historicoTabela.replaceChildren();
    // O total é do histórico que acabou de sair da tela: mantê-lo anunciaria N
    // sorteios acima de uma tabela vazia.
    historicoTotal.textContent = '';
    historicoAtualizado.textContent = 'Atualização indisponível';
    mostrarErro(historicoErro, 'Não foi possível carregar o histórico. Verifique sua conexão e tente novamente.', err.message);
    painelCarregando.hidden = true;
    painelCarregando.replaceChildren();
    return false;
  } finally {
    // Só a carga vigente devolve a tela ao estado ocioso: a atrasada
    // reabilitaria o botão no meio da carga que a substituiu.
    if (pedido === historicoPedido) {
      btnAtualizar.disabled = false;
      btnAtualizar.removeAttribute('aria-busy');
      historicoPanel.removeAttribute('aria-busy');
    }
  }

  if (pedido !== historicoPedido) return false;
  revelarTabela();
  const lista = sorteios || [];
  desenhar(lista);
  const processos = lista.reduce((soma, s) => soma + (Number(s.processos) || 0), 0);
  historicoTotal.textContent = `${quantidadeSorteios(lista.length)} · ${quantidadeProcessos(processos)}`;
  historicoAtualizado.textContent = `Atualizado em: ${dataHoraBR()}`;
  historicoVazio.hidden = lista.length > 0;
  return true;
}

// ── Card com os processos de um sorteio ──────────────────────────────────────
// A lista conta; o card mostra o que foi sorteado. Quem responde é
// processos_sorteio, com o MESMO recorte de origem da lista — se as duas
// divergirem, o card abre um número diferente do que a linha mostrava.

function abrirDetalheDaLinha(evento) {
  const botao = evento.target.closest('.historico-ver, .historico-destino');
  if (botao && historicoTabela.contains(botao)) abrirDetalhe(botao);
}

async function abrirDetalhe(botao) {
  const { data, carimbo, destino } = botao.dataset;
  const hora = horaBR(carimbo);
  const pedido = ++detalhePedido;
  detalheAtual = null;

  detalheTitulo.textContent = destino ? `Sorteio de ${dataBR(data)} — ${destino}` : `Sorteio de ${dataBR(data)}`;
  detalheResumo.textContent = 'Carregando…';
  detalheTabela.replaceChildren();
  detalheErro.hidden = true;
  detalheCorpo.hidden = true;
  detalheLoading.hidden = false;
  detalheLoading.replaceChildren(criarIndicadorCarregamento('Carregando processos…'));
  // De quando o indicador entrou: aguardarIndicador o segura até ele ter sido
  // visto, em vez de deixá-lo piscar quando a resposta volta logo.
  const montadoEm = Date.now();
  btnExportarDetalhe.disabled = true;
  // showModal antes da busca: o card aparece com o loading em vez de a tela
  // ficar parada sem resposta ao clique.
  if (!detalheDialog.open) detalheDialog.showModal();

  let processos;
  try {
    processos = await api('rpc/processos_sorteio', { paginar: true,
      method: 'POST',
      body: JSON.stringify({
        p_colegiado: COL.sigla,
        p_data: data,
        // Vazio é a rodada sem carimbo: precisa chegar como null para o
        // `is not distinct from` do banco casar com as linhas dela.
        p_sorteado_em: carimbo || null
      })
    });
  } catch (err) {
    await aguardarIndicador(montadoEm);
    if (pedido !== detalhePedido) return;
    detalheLoading.hidden = true;
    detalheLoading.replaceChildren();
    detalheCorpo.hidden = true;
    detalheResumo.textContent = '';
    mostrarErro(detalheErro, 'Não foi possível carregar os processos. Feche e abra a lista de novo.', err.message);
    return;
  }

  await aguardarIndicador(montadoEm);
  if (pedido !== detalhePedido) return;
  detalheLoading.hidden = true;
  detalheLoading.replaceChildren();
  detalheCorpo.hidden = false;
  // O filtro por destino é feito aqui, não no banco: processos_sorteio já traz
  // a rodada inteira, e uma rodada tem no máximo algumas dezenas de processos —
  // não vale uma RPC nova só para recortar o que já chegou.
  const lista = destino ? (processos || []).filter(p => p.destino === destino) : (processos || []);
  detalheAtual = { data, destino, processos: lista };
  btnExportarDetalhe.disabled = lista.length === 0;
  desenharDetalhe(lista, hora);
}

function desenharDetalhe(processos, hora) {
  detalheResumo.textContent = [COL.nome, quantidadeProcessos(processos.length), hora && `às ${hora}`]
    .filter(Boolean).join(' · ');

  const thead = document.createElement('thead');
  const cabecalho = document.createElement('tr');
  ['Ordem', 'Nº do Processo', COL.destino,
   ...(COL.interessado ? ['Interessado'] : []),
   'Assunto', COL.decisao]
    .forEach(rotulo => cabecalho.append(celula(rotulo, 'th')));
  thead.append(cabecalho);

  const tbody = document.createElement('tbody');
  processos.forEach(p => {
    const tr = document.createElement('tr');
    // Rodada gravada sem a ordem do sorteio: travessão, e não um número
    // inventado a partir da posição na lista.
    tr.append(celula(p.ordem ?? '—'));
    tr.append(celula(p.num_processo, 'th', 'linha'));

    const destino = celula(p.destino || '—');
    // A cadeira sozinha não diz quem é. O responsável vem da mesma resposta,
    // com o ocupante da época — o hover e o leitor de tela o anunciam em vez de
    // soletrar "CJ3" em cada linha.
    if (p.responsavel && p.responsavel !== p.destino) {
      destino.title = p.responsavel;
      destino.setAttribute('aria-label', `${p.destino} — ${p.responsavel}`);
    }
    tr.append(destino);

    // Nome de pessoa e assunto não cabem numa coluna que não quebra linha.
    if (COL.interessado) tr.append(celula(p.interessado || '—', 'td', 'historico-livre'));
    tr.append(celula(p.assunto || '—', 'td', 'historico-livre'));
    tr.append(celula(p.decisao || '—'));
    tbody.append(tr);
  });

  detalheTabela.replaceChildren(thead, tbody);
  equalizarColunas(detalheTabela);
}

// ── Exportar a ata do sorteio em .docx ───────────────────────────────────────
// O template mora em ata.js, o mesmo da ata que o sorteio baixa na hora.

function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Alguns navegadores só assumem o Blob depois que a navegação de download
  // avança; revogá-lo no mesmo ciclo pode cancelar um arquivo válido.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportarDetalheDocx() {
  if (!detalheAtual || !detalheAtual.processos.length) return;
  // Reaproveita o alerta que o card já tem: sem aviso, uma falha ao montar o
  // arquivo é indistinguível de um download que o navegador engoliu.
  detalheErro.hidden = true;
  try {
    const nome = [COL.arquivo, detalheAtual.data, detalheAtual.destino].filter(Boolean).join('-');
    baixarArquivo(criarAtaDocx(COL.sigla, detalheAtual.processos, detalheAtual.data), `${nome}.docx`);
  } catch (erro) {
    mostrarErro(detalheErro, 'Não foi possível gerar o arquivo. Tente exportar de novo.', erro.message);
  }
}
