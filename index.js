const devNode = document.querySelector('footer div strong');
if (!devNode || devNode.textContent.trim() !== 'Lucas Lustosa Coelho') {
  throw new Error('Erro Crítico: Procure o desenvolvedor ou o responsável pela manutenção do código.');
}

const assuntosCreg = ['Auto de Infração', 'Chamamento Público', 'Gratuidade', 'Manifestação', 'Minuta', 'Nota Técnica', 'Ouvidoria', 'Requerimento', 'Plano de Racionamento', 'Reajuste', 'Outros'];
const assuntosCj = ['Auto de Infração', 'Outros'];
const recursos = ['Com recurso', 'Sem recurso', 'Não se aplica', 'Pedido de revisão'];

let modoSorteio = '';
let unidadesList = [];
let assuntosAtivos = [];

const tbody = document.querySelector('#processTable tbody');
const numRowsInput = document.getElementById('numRows');
const createBtn = document.getElementById('createRows');
const sortearBtn = document.getElementById('sortear');
const addRowBtn = document.getElementById('addRowBtn');

const btnCreg = document.getElementById('btnCreg');
const btnCj = document.getElementById('btnCj');
const btnVoltar = document.getElementById('btnVoltar');
const modeSelector = document.getElementById('modeSelector');
const sorteadorContent = document.getElementById('sorteadorContent');
const thUnidade = document.getElementById('thUnidade');
const pillsContainer = document.getElementById('pillsContainer');
const txtModo = document.getElementById('txtModo');

btnCreg.addEventListener('click', () => {
  iniciarSorteador('CREG', ['CREG1', 'CREG2', 'CREG3', 'CREG4']);
});

btnCj.addEventListener('click', () => {
  iniciarSorteador('CJ', ['CJ1', 'CJ2', 'CJ3', 'CJ4', 'CJ5']);
});

btnVoltar.addEventListener('click', () => {
  sorteadorContent.style.display = 'none';
  modeSelector.style.display = 'flex';
  btnVoltar.style.display = 'none';

  numRowsInput.style.display = 'inline-block';
  createBtn.style.display = 'inline-block';
  const label = document.querySelector('label[for="numRows"]');
  if (label) label.style.display = 'inline-block';
  const spacer = document.getElementById('spacer');
  if (spacer) spacer.style.display = 'flex';

  sortearBtn.style.display = 'none';
  addRowBtn.style.display = 'none';
  txtModo.textContent = '';
  clearRows();
});

function iniciarSorteador(modo, unidades) {
  modoSorteio = modo;
  unidadesList = unidades;
  assuntosAtivos = modo === 'CREG' ? assuntosCreg : assuntosCj;

  btnVoltar.style.display = 'inline-block';
  txtModo.textContent = modo === 'CREG' ? 'Conselho Regulador' : 'Câmara de Julgamento';

  thUnidade.textContent = modo === 'CREG' ? 'Unidade Conselho Regulador (CREG)' : 'Unidade Câmara de Julgamento (CJ)';
  sortearBtn.textContent = `Sortear ${modo} e Exportar`;

  pillsContainer.innerHTML = '';
  unidadesList.forEach(unit => {
    const label = document.createElement('label');
    label.className = 'pill';
    label.dataset.creg = unit;
    label.textContent = unit;
    label.addEventListener('click', () => {
      label.classList.toggle('excluded');
    });
    pillsContainer.appendChild(label);
  });

  modeSelector.style.display = 'none';
  sorteadorContent.style.display = 'block';

  createRows(parseInt(numRowsInput.value) || 3);
}

function clearRows() { tbody.innerHTML = ''; }

function recalculaOrdem() {
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.forEach((r, idx) => {
    r.querySelector('.num').textContent = idx + 1;
  });
}

function createRowElement(index) {
  const tr = document.createElement('tr');
  const tdOrdem = document.createElement('td'); tdOrdem.className = 'num'; tdOrdem.textContent = index;
  const tdProc = document.createElement('td');
  const inpProc = document.createElement('input'); inpProc.type = 'text'; inpProc.placeholder = 'Digite o nº do processo';
  tdProc.appendChild(inpProc);
  const tdInt = document.createElement('td');
  const inpInt = document.createElement('input'); inpInt.type = 'text'; inpInt.placeholder = 'Interessado';
  tdInt.appendChild(inpInt);
  const tdAss = document.createElement('td');
  const selAss = document.createElement('select');
  const optDefaultAss = document.createElement('option'); optDefaultAss.value = ''; optDefaultAss.textContent = 'Selecione o Assunto'; optDefaultAss.disabled = true; optDefaultAss.selected = true;
  selAss.appendChild(optDefaultAss);
  assuntosAtivos.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; selAss.appendChild(o) });
  tdAss.appendChild(selAss);
  const tdData = document.createElement('td'); tdData.className = 'hidden';
  const inpData = document.createElement('input'); inpData.type = 'text'; inpData.placeholder = 'Data (oculta)'; tdData.appendChild(inpData);
  const tdRec = document.createElement('td');
  const selRec = document.createElement('select');
  const optDefaultRec = document.createElement('option'); optDefaultRec.value = ''; optDefaultRec.textContent = 'Selecione o tipo de recurso'; optDefaultRec.disabled = true; optDefaultRec.selected = true;
  selRec.appendChild(optDefaultRec);
  recursos.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; selRec.appendChild(o) });
  tdRec.appendChild(selRec);

  selAss.addEventListener('change', () => {
    if (selAss.value !== 'Auto de Infração') {
      selRec.value = 'Não se aplica';
      selRec.disabled = true;
    } else {
      selRec.disabled = false;
      if (selRec.value === 'Não se aplica' && optDefaultRec.selected) {
        selRec.value = '';
      }
    }
  });

  const tdUn = document.createElement('td'); tdUn.className = 'unidade small'; tdUn.textContent = '';

  const tdDel = document.createElement('td');
  tdDel.style.textAlign = 'center';
  const btnDel = document.createElement('button');
  btnDel.textContent = '×';
  btnDel.style.background = 'transparent';
  btnDel.style.border = 'none';
  btnDel.style.color = '#ef4444';
  btnDel.style.fontSize = '22px';
  btnDel.style.cursor = 'pointer';
  btnDel.style.fontWeight = 'bold';
  btnDel.style.padding = '0';
  btnDel.style.lineHeight = '1';
  btnDel.title = 'Excluir esta linha';
  btnDel.addEventListener('click', () => {
    tr.remove();
    recalculaOrdem();
  });
  tdDel.appendChild(btnDel);

  tr.append(tdOrdem, tdProc, tdInt, tdAss, tdData, tdRec, tdUn, tdDel);
  return tr;
}

function createRows(n) {
  clearRows();
  for (let i = 1; i <= n; i++) {
    const tr = createRowElement(i);
    tbody.appendChild(tr);
  }
}

function getParticipantes() {
  const excluidos = Array.from(document.querySelectorAll('#pillsContainer .excluded')).map(p => p.dataset.creg);
  return unidadesList.filter(c => !excluidos.includes(c));
}

function sortearProcessos() {
  const rows = Array.from(tbody.querySelectorAll('tr'));
  if (rows.length === 0) { alert('Crie as linhas primeiro.'); return; }

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const cells = Array.from(r.children);
    const numProc = cells[1].querySelector('input').value.trim();
    const interessado = cells[2].querySelector('input').value.trim();
    const assunto = cells[3].querySelector('select').value;
    const recurso = cells[5].querySelector('select').value;

    if (!numProc || !interessado || !assunto || !recurso) {
      alert(`Por favor, preencha todos os campos da linha ${idx + 1} antes de sortear.`);
      return;
    }
  }

  const participantes = getParticipantes();
  if (participantes.length === 0) { alert(`Todos os ${modoSorteio}s estão excluídos. Selecione pelo menos um para participar.`); return; }

  const atribuicoesPorCreg = {};
  participantes.forEach(c => {
    atribuicoesPorCreg[c] = {
      total: 0,
      assuntos: {}
    };
  });

  const linhasPorAssunto = {};
  rows.forEach(r => {
    const assunto = r.children[3].querySelector('select').value;
    if (!linhasPorAssunto[assunto]) {
      linhasPorAssunto[assunto] = [];
    }
    linhasPorAssunto[assunto].push(r);
  });

  const assuntosOrdenados = Object.keys(linhasPorAssunto).sort((a, b) => {
    return linhasPorAssunto[b].length - linhasPorAssunto[a].length;
  });

  const hoje = new Date();
  const dataHoje = hoje.toLocaleDateString('pt-BR');

  assuntosOrdenados.forEach(assunto => {
    const linhas = [...linhasPorAssunto[assunto]];
    linhas.sort(() => Math.random() - 0.5);

    const totalLinhasAssunto = linhas.length;
    const base = Math.floor(totalLinhasAssunto / participantes.length);
    const resto = totalLinhasAssunto % participantes.length;

    participantes.forEach(creg => {
      for (let i = 0; i < base; i++) {
        const row = linhas.pop();
        row.querySelector('.unidade').textContent = creg;
        const inputData = row.children[4].querySelector('input');
        if (inputData) inputData.value = dataHoje;
        atribuicoesPorCreg[creg].total++;
        atribuicoesPorCreg[creg].assuntos[assunto] = (atribuicoesPorCreg[creg].assuntos[assunto] || 0) + 1;
      }
    });

    if (resto > 0) {
      const candidatos = [...participantes].sort((a, b) => {
        const diff = atribuicoesPorCreg[a].total - atribuicoesPorCreg[b].total;
        if (diff === 0) return Math.random() - 0.5;
        return diff;
      });

      for (let i = 0; i < resto; i++) {
        const creg = candidatos[i];
        const row = linhas.pop();
        row.querySelector('.unidade').textContent = creg;
        const inputData = row.children[4].querySelector('input');
        if (inputData) inputData.value = dataHoje;
        atribuicoesPorCreg[creg].total++;
        atribuicoesPorCreg[creg].assuntos[assunto] = (atribuicoesPorCreg[creg].assuntos[assunto] || 0) + 1;
      }
    }
  });

  exportZip(rows, participantes);

  const msg = document.createElement('div');
  msg.textContent = `⚠️ Colocar as planilhas de backup dos ${modoSorteio}s sorteados na pasta de backup! ⚠️`;
  msg.style.position = 'fixed';
  msg.style.top = '20px';
  msg.style.left = '50%';
  msg.style.transform = 'translateX(-50%)';
  msg.style.background = '#ef4444';
  msg.style.color = 'white';
  msg.style.fontSize = '28px';
  msg.style.fontWeight = 'bold';
  msg.style.padding = '20px 40px';
  msg.style.borderRadius = '12px';
  msg.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
  msg.style.zIndex = 9999;
  msg.style.textAlign = 'center';
  document.body.appendChild(msg);

  setTimeout(() => { msg.remove(); }, 60000);
}

async function exportZip(rows, participantes) {
  const hoje = new Date();
  const dia = hoje.getDate().toString().padStart(2, '0');
  const mes = (hoje.getMonth() + 1).toString().padStart(2, '0');
  const mesExtenso = hoje.toLocaleString('pt-BR', { month: 'long' });
  const ano = hoje.getFullYear();

  const zip = new JSZip();

  // ── Word (.doc) ──────────────────────────────────────────────────────────────
  const cabecalho = `Aos ${dia} dias do mês de ${mesExtenso} de ${ano} na sede da Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos, realizou-se a distribuição de processos por sorteio eletrônico.`;
  const colunaNome = modoSorteio === 'CREG' ? 'Unidade Conselho Regulador' : 'Unidade Câmara de Julgamento';

  let tableHtml = `<table border="1" style="border-collapse:collapse;width:100%"><tr><th>Ordem</th><th>Nº Processo</th><th>Interessado</th><th>${colunaNome}</th></tr>`;

  const dados = rows.map(r => {
    const cells = Array.from(r.children);
    return {
      ordem: cells[0].textContent.trim(),
      numProc: cells[1].querySelector('input').value.trim(),
      interessado: cells[2].querySelector('input').value.trim(),
      unidade: cells[6].textContent.trim()
    };
  });
  dados.sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR', { numeric: true }));
  dados.forEach(d => {
    tableHtml += `<tr><td>${d.ordem}</td><td>${d.numProc}</td><td>${d.interessado}</td><td>${d.unidade}</td></tr>`;
  });
  tableHtml += '</table>';

  const wordConteudo = '\uFEFF' + `<meta charset="UTF-8"><p>${cabecalho}</p>${tableHtml}`;
  zip.file(`Sorteio_${modoSorteio}.doc`, wordConteudo);

  // ── Planilhas CSV (uma por unidade) ──────────────────────────────────────────
  const cabecalhoColuna = modoSorteio === 'CREG' ? 'Unidade Conselho Regulador' : 'Unidade Câmara de Julgamento';

  participantes.forEach(unit => {
    const linhasUnit = rows.filter(r => r.querySelector('.unidade').textContent === unit);
    if (linhasUnit.length === 0) return;

    let csv = '\uFEFF';
    csv += `${cabecalhoColuna};Nº Processo;Interessado;Assunto;Data de Distribuição;Recurso\n`;

    linhasUnit.forEach(r => {
      const cells = Array.from(r.children);
      const unidade    = cells[6].textContent.trim();
      const numProc    = cells[1].querySelector('input').value.trim();
      const interessado = cells[2].querySelector('input').value.trim();
      const assunto    = cells[3].querySelector('select').value.trim();
      const dataDistrib = cells[4].querySelector('input').value.trim();
      const recurso    = cells[5].querySelector('select').value.trim();
      csv += [unidade, numProc, interessado, assunto, dataDistrib, recurso].join(';') + '\n';
    });

    zip.file(`${unit} ${dia}.${mes}.${ano}.csv`, csv);
  });

  // ── Gerar e baixar o ZIP ─────────────────────────────────────────────────────
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, `Sorteio_${modoSorteio}_${dia}.${mes}.${ano}.zip`);
}

createBtn.addEventListener('click', () => {
  const n = parseInt(numRowsInput.value) || 0;
  if (n <= 0) { alert('Digite uma quantidade válida (>=1).'); return; }
  createRows(n);
  createBtn.style.display = 'none';
  numRowsInput.style.display = 'none';
  const label = document.querySelector('label[for="numRows"]');
  if (label) label.style.display = 'none';
  const spacer = document.getElementById('spacer');
  if (spacer) spacer.style.display = 'none';
  sortearBtn.style.display = 'inline-block';
  addRowBtn.style.display = 'inline-block';
});

addRowBtn.addEventListener('click', () => {
  const nextIndex = tbody.querySelectorAll('tr').length + 1;
  const tr = createRowElement(nextIndex);
  tbody.appendChild(tr);
});

sortearBtn.addEventListener('click', sortearProcessos);
