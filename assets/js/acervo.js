// Painel do acervo: quantos processos estão parados, por quanto tempo e com
// quem.
//
// A conta não é feita aqui. O banco devolve a matriz pronta pela função
// resumo_acervo_cj (ver sql/schema.sql), uma linha por célula, porque acervo_cj
// é fechada ao navegador e porque a definição de "não julgado" precisa morar em
// um lugar só. Esta página pivota o resultado e desenha.
//
// As colunas vêm do dado, não do HTML: são as cadeiras (CJ1..CJ5) que existem no
// acervo, e o nome de quem ocupa cada uma vem na mesma resposta, para o hover.
// Trocar a composição da Câmara é mexer na tabela cadeiras_cj do banco; esta
// página acompanha sem alteração.

const acervoPanel = document.getElementById('acervoPanel');
const acervoTabela = document.getElementById('acervoTable');
const acervoVazio = document.getElementById('acervoVazio');
const acervoErro = document.getElementById('acervoErro');
const acervoTotal = document.getElementById('acervoTotal');
const acervoAtualizado = document.getElementById('acervoAtualizado');
const btnAtualizar = document.getElementById('btnAtualizar');
const btnImprimir = document.getElementById('btnImprimir');
const btnTentarNovamente = document.getElementById('btnTentarNovamente');
const loginOnlyCard = document.querySelector('[data-login-only]');

btnAtualizar.addEventListener('click', () => carregarAcervo());
btnImprimir.addEventListener('click', () => window.print());
btnTentarNovamente.addEventListener('click', () => carregarAcervo());

async function inicializarAcervo() {
  const carregado = await carregarAcervo({ carregamentoInicial: true });
  if (!carregado) return;

  // Troca atômica: o loading geral desaparece e o dashboard entra já completo.
  // "Atualizar" só aparece junto com o painel: revelado antes, ele redesenharia
  // uma tabela ainda escondida — o clique "funcionaria" sem nada mudar na tela.
  if (loginOnlyCard) loginOnlyCard.hidden = true;
  acervoPanel.hidden = false;
  btnAtualizar.hidden = false;
}

function hojeBR() {
  return new Date().toLocaleDateString('pt-BR');
}

function celula(texto, tag = 'td', classe = '') {
  const el = document.createElement(tag);
  if (tag === 'th') el.scope = classe === 'linha' ? 'row' : 'col';
  if (classe && classe !== 'linha') el.className = classe;
  // String() explícito: o DOM converteria sozinho, mas deixar number aqui torna
  // o valor da célula dependente do motor em vez do código.
  el.textContent = String(texto);
  return el;
}

// A matriz vem em formato longo — (faixa, relator, processos) — e vira tabela
// aqui. Zero é desenhado como travessão: numa grade de contagem, uma coluna de
// "0" repetido esconde os números que importam.
function desenhar(linhas) {
  const relatores = [...new Set(linhas.map(l => l.relator))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const faixas = [...new Map(linhas.map(l => [l.ordem, l.faixa])).entries()].sort((a, b) => a[0] - b[0]);
  const valor = new Map(linhas.map(l => [`${l.ordem}|${l.relator}`, l.processos]));
  // Quem ocupa cada cadeira vem na mesma resposta, da tabela cadeiras_cj: o
  // front não repete o de-para, só apresenta.
  const conselheiro = new Map(linhas.map(l => [l.relator, l.conselheiro]));

  const thead = document.createElement('thead');
  const cabecalho = document.createElement('tr');
  cabecalho.append(celula('Período', 'th'));
  relatores.forEach(r => {
    const th = celula(r, 'th');
    // A cadeira sozinha não diz quem é. O nome vai no hover do mouse e no
    // aria-label, para o leitor de tela anunciar o conselheiro em vez de
    // soletrar "CJ3" em cada célula da coluna.
    const nome = conselheiro.get(r);
    if (nome && nome !== r) {
      th.title = nome;
      th.setAttribute('aria-label', `${r} — ${nome}`);
    }
    cabecalho.append(th);
  });
  cabecalho.append(celula('Total', 'th'));
  thead.append(cabecalho);

  const tbody = document.createElement('tbody');
  let total = 0;

  faixas.forEach(([ordem, faixa]) => {
    const tr = document.createElement('tr');
    tr.append(celula(faixa, 'th', 'linha'));

    let somaLinha = 0;
    relatores.forEach(r => {
      const n = valor.get(`${ordem}|${r}`) || 0;
      somaLinha += n;
      tr.append(celula(n || '—', 'td', n ? 'acervo-detalhe' : 'acervo-zero'));
    });

    // A partir de 46 dias ("Há 3 meses"), a célula Total é uma faixa visual
    // crítica mesmo quando está zerada. A quantidade só vira alerta acessível
    // quando há processo, para não anunciar "0 processos" como ocorrência.
    const periodoCritico = ordem >= 4;
    const totalLinha = celula(
      somaLinha || '—',
      'td',
      `acervo-total-col${somaLinha ? ' acervo-detalhe' : ''}${periodoCritico ? ' acervo-alerta' : ''}`
    );
    if (periodoCritico && somaLinha > 0) {
      const quantidade = somaLinha === 1 ? '1 processo' : `${somaLinha} processos`;
      totalLinha.setAttribute('aria-label', `Alerta: ${quantidade} nesta faixa de permanência`);
      totalLinha.title = `Alerta: ${quantidade} nesta faixa de permanência`;
    }
    tr.append(totalLinha);
    total += somaLinha;
    tbody.append(tr);
  });

  const rodape = document.createElement('tfoot');
  const trTotal = document.createElement('tr');
  trTotal.append(celula('Total', 'th', 'linha'));
  relatores.forEach(r => {
    const soma = faixas.reduce((acc, [ordem]) => acc + (valor.get(`${ordem}|${r}`) || 0), 0);
    trTotal.append(celula(soma || '—', 'td', soma ? 'acervo-detalhe' : 'acervo-zero'));
  });
  trTotal.append(celula(total || '—', 'td', `acervo-total-col${total ? ' acervo-detalhe' : ''}`));
  rodape.append(trTotal);

  acervoTabela.replaceChildren(thead, tbody, rodape);
  return total;
}

async function carregarAcervo({ carregamentoInicial = false } = {}) {
  acervoErro.hidden = true;
  acervoVazio.hidden = true;
  acervoAtualizado.textContent = 'Carregando…';
  btnAtualizar.disabled = true;
  btnAtualizar.setAttribute('aria-busy', 'true');
  acervoPanel.setAttribute('aria-busy', 'true');

  let linhas;
  try {
    linhas = await api('rpc/resumo_acervo_cj', { method: 'POST', body: '{}' });
  } catch (err) {
    // Sessão expirada já foi tratada em api(), que recolocou a tela de login.
    // Sem esta saída, o painel diria "verifique sua conexão" logo abaixo de
    // "sua sessão expirou" — dois diagnósticos contraditórios na mesma tela.
    if (err.status === 401) return false;
    if (carregamentoInicial) throw err;
    acervoTabela.replaceChildren();
    acervoAtualizado.textContent = 'Atualização indisponível';
    acervoErro.querySelector('p').textContent = `Não foi possível carregar o acervo (${err.message}).`;
    acervoErro.hidden = false;
    return false;
  } finally {
    btnAtualizar.disabled = false;
    btnAtualizar.removeAttribute('aria-busy');
    acervoPanel.removeAttribute('aria-busy');
  }

  const total = desenhar(linhas || []);
  acervoTotal.textContent = total === 1
    ? '1 processo aguardando julgamento'
    : `${total} processos aguardando julgamento`;
  acervoAtualizado.textContent = `Posição de ${hojeBR()}`;
  acervoVazio.hidden = total > 0;
  return true;
}
