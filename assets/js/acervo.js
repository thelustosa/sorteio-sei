// Painel do acervo: quantos processos estão parados, por quanto tempo e com
// quem.
//
// A conta não é feita aqui. O banco devolve a matriz pronta pela função
// resumo_acervo_cj (ver sql/schema.sql), uma linha por célula, porque acervo_cj
// é fechada ao navegador e porque a definição de "não julgado" precisa morar em
// um lugar só. Esta página pivota o resultado e desenha.
//
// As colunas vêm do dado, não do HTML: são os relatores que existem no acervo.
// Enquanto o sorteio gravar cadeira (CJ1..CJ5) e o histórico trouxer nome de
// conselheiro, é o banco que decide o que aparece — e quando existir o de-para
// entre cadeira e nome, o painel acompanha sem mexer aqui.

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
  btnAtualizar.hidden = false;
  const carregado = await carregarAcervo({ carregamentoInicial: true });
  if (!carregado) return;

  // Troca atômica: o loading geral desaparece e o dashboard entra já completo.
  if (loginOnlyCard) loginOnlyCard.hidden = true;
  acervoPanel.hidden = false;
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

  const thead = document.createElement('thead');
  const cabecalho = document.createElement('tr');
  cabecalho.append(celula('Período', 'th'));
  relatores.forEach(r => cabecalho.append(celula(r, 'th')));
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

    const periodoCritico = ordem >= 7 && somaLinha > 0;
    const totalLinha = celula(
      somaLinha || '—',
      'td',
      `acervo-total-col${somaLinha ? ' acervo-detalhe' : ''}${periodoCritico ? ' acervo-alerta' : ''}`
    );
    if (periodoCritico) {
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
