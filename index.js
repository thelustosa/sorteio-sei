const assuntosCreg = ['Auto de Infração', 'Chamamento Público', 'Gratuidade', 'Manifestação', 'Minuta', 'Nota Técnica', 'Ouvidoria', 'Requerimento', 'Plano de Racionamento', 'Reajuste', 'Outros'];
const assuntosCj = ['Auto de Infração'];
const recursos = ['Com recurso', 'Sem recurso', 'Não se aplica', 'Pedido de revisão'];
// Na Câmara de Julgamento a mesma coluna registra outra coisa: se o autuado
// apresentou defesa. É o campo que os julgados herdam do acervo.
const defesas = ['Sim', 'Não'];

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
const thRecurso = document.getElementById('thRecurso');
const pillsContainer = document.getElementById('pillsContainer');
const txtModo = document.getElementById('txtModo');

// ── Autenticação ─────────────────────────────────────────────────────────────
// Login, token e chamadas ao Supabase ficam em supabase.js, compartilhados com
// a página de registro de voto e status.
ligarLogin(() => { modeSelector.style.display = 'flex'; });

btnCreg.addEventListener('click', () => {
  iniciarSorteador('CREG', ['CREG1', 'CREG2', 'CREG3', 'CREG4']);
});

btnCj.addEventListener('click', () => {
  iniciarSorteador('CJ', ['CJ1', 'CJ2', 'CJ3', 'CJ4', 'CJ5']);
});

btnVoltar.addEventListener('click', () => {
  sorteadorContent.style.display = 'none';
  modeSelector.style.display = 'flex';
  btnVoltar.hidden = true;

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
  
  // Resetar visualização de resultados
  const resultadoSorteio = document.getElementById('resultadoSorteio');
  if (resultadoSorteio) resultadoSorteio.style.display = 'none';
  const tbodyResult = document.querySelector('#resultTable tbody');
  if (tbodyResult) tbodyResult.innerHTML = '';
  const resumoContagem = document.getElementById('resumoContagem');
  if (resumoContagem) resumoContagem.innerHTML = '';
});

function iniciarSorteador(modo, unidades) {
  modoSorteio = modo;
  unidadesList = unidades;
  assuntosAtivos = modo === 'CREG' ? assuntosCreg : assuntosCj;

  btnVoltar.hidden = false;
  txtModo.textContent = modo === 'CREG' ? 'Conselho Regulador' : 'Câmara de Julgamento';

  thUnidade.textContent = modo === 'CREG' ? 'Unidade Conselho Regulador (CREG)' : 'Unidade Câmara de Julgamento (CJ)';
  thRecurso.textContent = modo === 'CREG' ? 'Recurso' : 'Defesa';
  sortearBtn.textContent = `Sortear ${modo} e Exportar`;

  pillsContainer.innerHTML = '';
  unidadesList.forEach(unit => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.dataset.creg = unit;
    pill.setAttribute('aria-pressed', 'false');
    pill.textContent = unit;
    pill.addEventListener('click', () => {
      const excluded = pill.classList.toggle('excluded');
      pill.setAttribute('aria-pressed', String(excluded));
    });
    pillsContainer.appendChild(pill);
  });

  // Restaurar elementos que podem ter sido ocultados pós-sorteio
  const processTable = document.getElementById('processTable');
  if (processTable) processTable.style.display = 'table';
  const controls = document.querySelector('.controls');
  if (controls) controls.style.display = 'flex';
  const cregSelector = document.getElementById('cregSelector');
  if (cregSelector) cregSelector.style.display = 'flex';
  
  // Garantir que a área de resultados anterior seja limpa e escondida
  const resultadoSorteio = document.getElementById('resultadoSorteio');
  if (resultadoSorteio) resultadoSorteio.style.display = 'none';

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
  const inpProc = document.createElement('input'); inpProc.type = 'text'; inpProc.placeholder = 'Digite o nº do processo'; inpProc.setAttribute('aria-label', `Número do processo, linha ${index}`);
  tdProc.appendChild(inpProc);
  const tdInt = document.createElement('td');
  const inpInt = document.createElement('input'); inpInt.type = 'text'; inpInt.placeholder = 'Interessado'; inpInt.setAttribute('aria-label', `Interessado, linha ${index}`);
  tdInt.appendChild(inpInt);
  const tdAss = document.createElement('td');
  const selAss = document.createElement('select'); selAss.setAttribute('aria-label', `Assunto, linha ${index}`);
  const optDefaultAss = document.createElement('option'); optDefaultAss.value = ''; optDefaultAss.textContent = 'Selecione o Assunto'; optDefaultAss.disabled = true; optDefaultAss.selected = true;
  selAss.appendChild(optDefaultAss);
  assuntosAtivos.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; selAss.appendChild(o) });
  // Na Câmara de Julgamento o assunto é sempre Auto de Infração: já vem definido e travado.
  if (modoSorteio === 'CJ') {
    selAss.value = 'Auto de Infração';
    selAss.disabled = true;
  }
  tdAss.appendChild(selAss);
  const tdData = document.createElement('td'); tdData.className = 'hidden';
  const inpData = document.createElement('input'); inpData.type = 'text'; inpData.placeholder = 'Data (oculta)'; tdData.appendChild(inpData);
  const tdRec = document.createElement('td');
  const selRec = document.createElement('select'); selRec.setAttribute('aria-label', `${modoSorteio === 'CJ' ? 'Defesa' : 'Recurso'}, linha ${index}`);
  const optDefaultRec = document.createElement('option'); optDefaultRec.value = ''; optDefaultRec.textContent = modoSorteio === 'CJ' ? 'Houve defesa?' : 'Selecione o tipo de recurso'; optDefaultRec.disabled = true; optDefaultRec.selected = true;
  selRec.appendChild(optDefaultRec);
  (modoSorteio === 'CJ' ? defesas : recursos).forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; selRec.appendChild(o) });
  tdRec.appendChild(selRec);

  // Só no CREG: fora de Auto de Infração não existe recurso. Na CJ o assunto é
  // travado em Auto de Infração e a coluna é Defesa, que sempre se aplica.
  if (modoSorteio !== 'CJ') {
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
  }

  const tdUn = document.createElement('td'); tdUn.className = 'unidade small'; tdUn.textContent = '';

  const tdDel = document.createElement('td');
  tdDel.className = 'acoes';
  const btnDel = document.createElement('button');
  btnDel.type = 'button';
  btnDel.className = 'btn-excluir';
  btnDel.textContent = 'Excluir';
  btnDel.setAttribute('aria-label', `Excluir linha ${index}`);
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

  const numerosVistos = new Map();
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const cells = Array.from(r.children);
    const numProc = cells[1].querySelector('input').value.trim();
    const interessado = cells[2].querySelector('input').value.trim();
    const assunto = cells[3].querySelector('select').value;
    const defesaOuRecurso = cells[5].querySelector('select').value;

    if (!numProc || !interessado || !assunto || !defesaOuRecurso) {
      alert(`Por favor, preencha todos os campos da linha ${idx + 1} antes de sortear.`);
      return;
    }

    const anterior = numerosVistos.get(numProc);
    if (anterior) {
      alert(`O processo ${numProc} está repetido nas linhas ${anterior} e ${idx + 1}. Corrija antes de sortear.`);
      return;
    }
    numerosVistos.set(numProc, idx + 1);
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

  // ── Renderizar Resultados na Interface ──────────────────────────────────────
  const divResultado = document.getElementById('resultadoSorteio');
  const divResumo = document.getElementById('resumoContagem');
  const tbodyResult = document.querySelector('#resultTable tbody');
  const thUnidadeResult = document.getElementById('thUnidadeResult');
  
  if (divResultado && divResumo && tbodyResult) {
    // 1. Atualizar cabeçalho da coluna de resultado
    if (thUnidadeResult) {
      thUnidadeResult.textContent = modoSorteio === 'CREG' 
        ? 'Sorteado Para (Conselho Regulador)' 
        : 'Sorteado Para (Câmara de Julgamento)';
    }

    // 2. Limpar conteúdo anterior
    tbodyResult.innerHTML = '';
    divResumo.innerHTML = '';
    
    // 3. Montar a contagem de cada processo para cada unidade
    const countWrapper = document.createElement('div');
    countWrapper.className = 'resumo-wrapper';

    participantes.forEach(p => {
      const totalProcessosUnidade = atribuicoesPorCreg[p].total;
      
      const badge = document.createElement('div');
      badge.className = 'unidade-badge';
      badge.textContent = `${p}: ${totalProcessosUnidade} ${totalProcessosUnidade === 1 ? 'processo' : 'processos'}`;
      
      countWrapper.appendChild(badge);
    });
    divResumo.appendChild(countWrapper);

    // 4. Preencher a tabela de resultados
    rows.forEach(r => {
      const cells = Array.from(r.children);
      const numProc = cells[1].querySelector('input').value.trim();
      const interessado = cells[2].querySelector('input').value.trim();
      const assunto = cells[3].querySelector('select').value;
      const unidadeSorteada = cells[6].textContent.trim();

      const tr = document.createElement('tr');
      
      const tdProc = document.createElement('td');
      tdProc.textContent = numProc;

      const tdInt = document.createElement('td');
      tdInt.textContent = interessado;

      const tdAss = document.createElement('td');
      tdAss.textContent = assunto;

      const tdUn = document.createElement('td');
      tdUn.textContent = unidadeSorteada;
      tdUn.className = 'sorteado-unidade';

      tr.append(tdProc, tdInt, tdAss, tdUn);
      tbodyResult.appendChild(tr);
    });

    // Exibir a seção de resultados e ocultar a tabela de inputs / controles
    divResultado.style.display = 'block';
    
    // Ocultar a tabela de inputs original, controles e seletor de unidades
    const processTable = document.getElementById('processTable');
    if (processTable) processTable.style.display = 'none';
    const controls = document.querySelector('.controls');
    if (controls) controls.style.display = 'none';
    const cregSelector = document.getElementById('cregSelector');
    if (cregSelector) cregSelector.style.display = 'none';
    const addRowBtn = document.getElementById('addRowBtn');
    if (addRowBtn) addRowBtn.style.display = 'none';

    // Fazer scroll suave para o resultado
    divResultado.scrollIntoView({ behavior: 'smooth' });
  }

  const sorteio = {
    modo: modoSorteio,
    dataHora: new Date().toISOString(),
    unidades: participantes,
    processos: coletarDados(rows)
  };

  exportarWord(sorteio);

  salvar(sorteio)
    .then(destino => destino === 'banco'
      ? aviso('✅ Sorteio gravado no banco de dados.')
      : aviso('⚠️ Banco não configurado — guarde o arquivo .json de backup gerado.', true))
    .catch(err => aviso(`❌ Falha ao gravar no banco (${err.message}). O backup .json foi baixado — reenvie depois.`, true));
}

// ── Persistência (Supabase / PostgREST) ──────────────────────────────────────
// A Câmara de Julgamento grava no próprio acervo — de lá saem os julgados
// (ver schema.sql). O Conselho Regulador segue na tabela antiga enquanto não
// ganha acervo_creg/julgados_creg. Sem Supabase configurado, o sorteio vira um
// .json de backup.
const TABELAS = { CJ: 'acervo_cj', CREG: 'processos_sorteados' };

// A 6ª coluna é Defesa na Câmara de Julgamento e Recurso no Conselho Regulador
// — coisas diferentes, então cada modo guarda a sua com o próprio nome.
function coletarDados(rows) {
  return rows.map(r => {
    const cells = Array.from(r.children);
    const processo = {
      ordem: Number(cells[0].textContent.trim()),
      numProcesso: cells[1].querySelector('input').value.trim(),
      interessado: cells[2].querySelector('input').value.trim(),
      assunto: cells[3].querySelector('select').value.trim(),
      dataDistribuicao: cells[4].querySelector('input').value.trim(),
      unidade: cells[6].textContent.trim()
    };

    const escolha = cells[5].querySelector('select').value.trim();
    if (modoSorteio === 'CJ') processo.defesa = escolha;
    else processo.recurso = escolha;

    return processo;
  });
}

// Usa a data local, não a do ISO (que é UTC): um sorteio às 22h de Brasília
// cairia no dia seguinte em UTC e o nome do arquivo divergiria da ata.
function nomeArquivo(sorteio, ext) {
  const d = new Date(sorteio.dataHora);
  const dia = d.getDate().toString().padStart(2, '0');
  const mes = (d.getMonth() + 1).toString().padStart(2, '0');
  return `Sorteio_${sorteio.modo}_${dia}.${mes}.${d.getFullYear()}.${ext}`;
}

// ── Word (.doc) ──────────────────────────────────────────────────────────────
function exportarWord(sorteio) {
  const hoje = new Date(sorteio.dataHora);
  const dia = hoje.getDate().toString().padStart(2, '0');
  const mesExtenso = hoje.toLocaleString('pt-BR', { month: 'long' });
  const ano = hoje.getFullYear();

  const cabecalho = `Aos ${dia} dias do mês de ${mesExtenso} de ${ano} na sede da Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos, realizou-se a distribuição de processos por sorteio eletrônico.`;
  const colunaNome = sorteio.modo === 'CREG' ? 'Unidade Conselho Regulador' : 'Unidade Câmara de Julgamento';

  const dados = [...sorteio.processos].sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR', { numeric: true }));

  let tableHtml = `<table border="1" style="border-collapse:collapse;width:100%"><tr><th>Ordem</th><th>Nº Processo</th><th>Interessado</th><th>${escaparHtml(colunaNome)}</th></tr>`;
  dados.forEach(d => {
    tableHtml += `<tr><td>${escaparHtml(d.ordem)}</td><td>${escaparHtml(d.numProcesso)}</td><td>${escaparHtml(d.interessado)}</td><td>${escaparHtml(d.unidade)}</td></tr>`;
  });
  tableHtml += '</table>';

  const wordConteudo = '﻿' + `<meta charset="UTF-8"><p>${escaparHtml(cabecalho)}</p>${tableHtml}`;
  baixarArquivo(new Blob([wordConteudo], { type: 'application/msword' }), nomeArquivo(sorteio, 'doc'));
}

function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// dd/mm/aaaa → aaaa-mm-dd (formato date do Postgres)
function dataISO(dataBR) {
  const [dia, mes, ano] = dataBR.split('/');
  return `${ano}-${mes}-${dia}`;
}

// Uma linha por processo, no formato da tabela de cada modo. A unidade sorteada
// (CJ1..CJ5) é o relator do processo no acervo da Câmara — é ela que os julgados
// usam depois para saber quem levou o processo à sessão.
function linhasParaBanco(sorteio) {
  if (sorteio.modo === 'CJ') {
    return sorteio.processos.map(p => ({
      num_processo: p.numProcesso,
      interessado: p.interessado,
      relator: p.unidade,
      data_distribuicao: dataISO(p.dataDistribuicao),
      defesa: p.defesa === 'Sim',
      assunto: p.assunto,
      ordem: p.ordem,
      sorteado_em: sorteio.dataHora
    }));
  }

  return sorteio.processos.map(p => ({
    modo: sorteio.modo,
    data_hora: sorteio.dataHora,
    ordem: p.ordem,
    num_processo: p.numProcesso,
    interessado: p.interessado,
    assunto: p.assunto,
    data_distribuicao: dataISO(p.dataDistribuicao),
    recurso: p.recurso,
    unidade: p.unidade
  }));
}

// Grava o sorteio no banco. Sem Supabase configurado (ou em caso de falha),
// baixa o JSON de backup para reenvio posterior — nenhum sorteio se perde.
async function salvar(sorteio) {
  const tabela = TABELAS[sorteio.modo];
  if (!SUPABASE_URL || !SUPABASE_KEY || !accessToken || !tabela) {
    baixarBackup(sorteio);
    return 'arquivo';
  }

  const linhas = linhasParaBanco(sorteio);

  try {
    const resp = await fetch(`${baseUrl()}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(linhas)
    });
    if (resp.status === 401) throw new Error('sessão expirada — recarregue a página e entre novamente');
    if (resp.status === 409) throw new Error('este sorteio já está gravado: mesmo processo, mesma data e mesma unidade');
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${await resp.text()}`);
    return 'banco';
  } catch (err) {
    baixarBackup(sorteio);
    throw err;
  }
}

function baixarBackup(sorteio) {
  const json = JSON.stringify(sorteio, null, 2);
  baixarArquivo(new Blob([json], { type: 'application/json' }), nomeArquivo(sorteio, 'json'));
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
