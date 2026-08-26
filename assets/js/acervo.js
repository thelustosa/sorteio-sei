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
const exportMenu = document.getElementById('exportMenu');
const btnExportar = document.getElementById('btnExportar');
const exportOptions = document.getElementById('exportOptions');
const exportFeedback = document.getElementById('exportFeedback');
const btnTentarNovamente = document.getElementById('btnTentarNovamente');
const loginOnlyCard = document.querySelector('[data-login-only]');
const detalheDialog = document.getElementById('detalheDialog');
const detalheTitulo = document.getElementById('detalheTitulo');
const detalheResumo = document.getElementById('detalheResumo');
const detalheLoading = document.getElementById('detalheLoading');
const detalheCorpo = document.getElementById('detalheCorpo');
const detalheTabela = document.getElementById('detalheTable');
const detalheErro = document.getElementById('detalheErro');
const btnFecharDetalhe = document.getElementById('btnFecharDetalhe');
const btnExportarDetalhe = document.getElementById('btnExportarDetalhe');
let linhasAtuais = null;
let detalheAtual = null;

btnAtualizar.addEventListener('click', () => carregarAcervo());
btnExportar.addEventListener('click', alternarMenuExportacao);
exportOptions.addEventListener('click', escolherExportacao);
exportOptions.addEventListener('keydown', navegarMenuExportacao);
document.addEventListener('click', fecharMenuAoClicarFora);
document.addEventListener('keydown', fecharMenuComEscape);
btnTentarNovamente.addEventListener('click', () => carregarAcervo());
acervoTabela.addEventListener('click', abrirDetalheDaCelula);
acervoTabela.addEventListener('keydown', abrirDetalheDoTeclado);
btnFecharDetalhe.addEventListener('click', () => detalheDialog.close());
btnExportarDetalhe.addEventListener('click', exportarDetalhe);
// Clique no ::backdrop chega como clique no próprio dialog: fechar ali é o que
// a pessoa espera de um card modal, e o <dialog> não faz isso sozinho.
detalheDialog.addEventListener('click', evento => {
  if (evento.target === detalheDialog) detalheDialog.close();
});

async function inicializarAcervo() {
  const carregado = await carregarAcervo({ carregamentoInicial: true });
  if (!carregado) return;

  // Troca atômica: o loading geral desaparece e o dashboard entra já completo.
  // "Atualizar" só aparece junto com o painel: revelado antes, ele redesenharia
  // uma tabela ainda escondida — o clique "funcionaria" sem nada mudar na tela.
  if (loginOnlyCard) loginOnlyCard.hidden = true;
  acervoPanel.hidden = false;
  btnAtualizar.hidden = false;
  exportMenu.hidden = false;
}

function hojeBR() {
  return new Date().toLocaleDateString('pt-BR');
}

// aaaa-mm-dd → dd/mm/aaaa, sem passar por Date: o construtor lê data pura como
// UTC e, em fuso negativo, devolveria o dia anterior.
function dataBR(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function dataArquivo() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function alternarMenuExportacao() {
  const abrir = exportOptions.hidden;
  if (abrir) informarExportacao();
  exportOptions.hidden = !abrir;
  btnExportar.setAttribute('aria-expanded', String(abrir));
  if (abrir) exportOptions.querySelector('[role="menuitem"]')?.focus();
}

function fecharMenuExportacao({ devolverFoco = false } = {}) {
  if (exportOptions.hidden) return;
  exportOptions.hidden = true;
  btnExportar.setAttribute('aria-expanded', 'false');
  if (devolverFoco) btnExportar.focus();
}

function fecharMenuAoClicarFora(evento) {
  if (!btnExportar.contains(evento.target) && !exportOptions.contains(evento.target)) fecharMenuExportacao();
}

function fecharMenuComEscape(evento) {
  if (evento.key === 'Escape' && !exportOptions.hidden) fecharMenuExportacao({ devolverFoco: true });
}

function navegarMenuExportacao(evento) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(evento.key)) return;
  evento.preventDefault();
  const itens = [...exportOptions.querySelectorAll('[role="menuitem"]')];
  const atual = itens.indexOf(document.activeElement);
  const destino = evento.key === 'Home' ? 0
    : evento.key === 'End' ? itens.length - 1
      : (atual + (evento.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
  itens[destino]?.focus();
}

function informarExportacao(mensagem = '', estado = '') {
  exportFeedback.textContent = mensagem;
  if (estado) {
    exportFeedback.dataset.state = estado;
    exportFeedback.setAttribute('role', 'alert');
    exportFeedback.setAttribute('aria-live', 'assertive');
  } else {
    delete exportFeedback.dataset.state;
    exportFeedback.setAttribute('role', 'status');
    exportFeedback.setAttribute('aria-live', 'polite');
  }
}

function definirExportacaoOcupada(ocupada, rotulo = 'Exportar') {
  btnExportar.disabled = ocupada || !linhasAtuais;
  btnExportar.querySelector('.export-label').textContent = rotulo;
  if (ocupada) btnExportar.setAttribute('aria-busy', 'true');
  else btnExportar.removeAttribute('aria-busy');
}

async function escolherExportacao(evento) {
  const opcao = evento.target.closest('[data-export-format]');
  if (!opcao) return;
  const formato = opcao.dataset.exportFormat;
  fecharMenuExportacao({ devolverFoco: true });
  await exportar(formato);
}

async function exportar(formato) {
  const rotulo = formato === 'pdf' ? 'Gerando PDF…' : 'Gerando Excel…';
  definirExportacaoOcupada(true, rotulo);
  informarExportacao();

  try {
    // Entrega primeiro o estado de carregamento ao navegador, antes do trabalho
    // síncrono de montar o arquivo ou abrir a caixa de impressão.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (formato === 'pdf') exportarPdf();
    else if (formato === 'excel') baixarArquivo(criarExcel(linhasAtuais), `acervo-cj-${dataArquivo()}.xlsx`);
    else throw new Error('formato não reconhecido');
  } catch (erro) {
    informarExportacao(`Não foi possível gerar o arquivo. Tente novamente (${erro.message}).`, 'error');
  } finally {
    definirExportacaoOcupada(false);
  }
}

function exportarPdf() {
  const tituloAnterior = document.title;
  document.title = `acervo-cj-${dataArquivo()}`;
  try {
    window.print();
  } finally {
    document.title = tituloAnterior;
  }
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
  // Alguns navegadores só assumem o Blob depois que a navegação de download
  // avança; revogá-lo no mesmo ciclo pode cancelar um arquivo válido.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escaparXml(valor) {
  return String(valor).replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[caractere]);
}

function colunaExcel(indice) {
  let nome = '';
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) nome = String.fromCharCode(65 + ((n - 1) % 26)) + nome;
  return nome;
}

function dadosTabulares(linhas) {
  const relatores = [...new Set(linhas.map(l => l.relator))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const faixas = [...new Map(linhas.map(l => [l.ordem, l.faixa])).entries()].sort((a, b) => a[0] - b[0]);
  const valor = new Map(linhas.map(l => [`${l.ordem}|${l.relator}`, Number(l.processos) || 0]));
  const cabecalho = ['Período', ...relatores, 'Total'];
  const corpo = faixas.map(([ordem, faixa]) => {
    const numeros = relatores.map(relator => valor.get(`${ordem}|${relator}`) || 0);
    return [faixa, ...numeros, numeros.reduce((soma, numero) => soma + numero, 0)];
  });
  const totais = relatores.map(relator => faixas.reduce((soma, [ordem]) => soma + (valor.get(`${ordem}|${relator}`) || 0), 0));
  return [cabecalho, ...corpo, ['Total', ...totais, totais.reduce((soma, numero) => soma + numero, 0)]];
}

function planilhaXml(linhas) {
  const dados = dadosTabulares(linhas);
  const quantidadeRelatores = dados[0].length - 2;
  const ultimaColuna = colunaExcel(dados[0].length - 1);
  const primeiraLinhaDados = 5;
  const quantidadeFaixas = dados.length - 2;
  const ultimaLinhaDados = primeiraLinhaDados + quantidadeFaixas - 1;
  const linhaTotal = primeiraLinhaDados + quantidadeFaixas;
  const linhaAtualizacao = linhaTotal + 1;
  const ordensPorFaixa = new Map(linhas.map(linha => [linha.faixa, Number(linha.ordem)]));
  const totalGeral = dados.at(-1).at(-1);
  const resumo = totalGeral === 1
    ? `1 processo aguardando julgamento • Atualizado em: ${hojeBR()}`
    : `${totalGeral} processos aguardando julgamento • Atualizado em: ${hojeBR()}`;
  const texto = (referencia, valor, estilo) => `<c r="${referencia}" t="inlineStr" s="${estilo}"><is><t>${escaparXml(valor)}</t></is></c>`;
  const numero = (referencia, valor, estilo, formula = '') => `<c r="${referencia}" s="${estilo}">${formula ? `<f>${formula}</f>` : ''}<v>${valor}</v></c>`;

  const cabecalho = dados[0].map((valor, indice) =>
    texto(`${colunaExcel(indice)}4`, String(valor).toLocaleUpperCase('pt-BR'), indice === 0 ? 13 : 4)
  ).join('');

  const corpo = dados.slice(1, -1).map((linha, indice) => {
    const numeroLinha = primeiraLinhaDados + indice;
    const critica = (ordensPorFaixa.get(linha[0]) || 0) >= 4;
    const celulas = linha.map((valor, indiceColuna) => {
      const coluna = colunaExcel(indiceColuna);
      const referencia = `${coluna}${numeroLinha}`;
      if (indiceColuna === 0) return texto(referencia, String(valor).toLocaleUpperCase('pt-BR'), 5);
      if (indiceColuna === linha.length - 1) {
        const formula = quantidadeRelatores > 0 ? `SUM(B${numeroLinha}:${colunaExcel(indiceColuna - 1)}${numeroLinha})` : '';
        return numero(referencia, valor, critica ? 8 : 7, formula);
      }
      return numero(referencia, valor, 6);
    }).join('');
    return `<row r="${numeroLinha}" ht="36" customHeight="1">${celulas}</row>`;
  }).join('');

  const totais = dados.at(-1).map((valor, indiceColuna) => {
    const coluna = colunaExcel(indiceColuna);
    const referencia = `${coluna}${linhaTotal}`;
    if (indiceColuna === 0) return texto(referencia, String(valor).toLocaleUpperCase('pt-BR'), 9);
    if (indiceColuna === dados[0].length - 1) {
      const formula = quantidadeRelatores > 0 ? `SUM(B${linhaTotal}:${colunaExcel(indiceColuna - 1)}${linhaTotal})` : '';
      return numero(referencia, valor, 11, formula);
    }
    const formula = quantidadeFaixas > 0 ? `SUM(${coluna}${primeiraLinhaDados}:${coluna}${ultimaLinhaDados})` : '';
    return numero(referencia, valor, 10, formula);
  }).join('');

  const colunasIntermediarias = quantidadeRelatores > 0
    ? `<col min="2" max="${dados[0].length - 1}" width="15" customWidth="1"/>`
    : '';
  const filtroFinal = quantidadeFaixas > 0 ? ultimaLinhaDados : 4;

  // A ordem dos elementos filhos de worksheet faz parte do schema OOXML.
  // O Excel é mais estrito que o LibreOffice: autoFilter precisa vir antes de
  // mergeCells, caso contrário ele oferece reparar a pasta e pode abri-la vazia.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><tabColor rgb="FF00534B"/><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="1" width="30" customWidth="1"/>${colunasIntermediarias}<col min="${dados[0].length}" max="${dados[0].length}" width="14" customWidth="1"/></cols><sheetData><row r="1" ht="34" customHeight="1">${texto('A1', 'Acervo de processos', 1)}</row><row r="2" ht="26" customHeight="1">${texto('A2', 'Visão gerencial do tempo de permanência dos processos distribuídos à Câmara de Julgamento.', 2)}</row><row r="3" ht="28" customHeight="1">${texto('A3', resumo, 3)}</row><row r="4" ht="32" customHeight="1">${cabecalho}</row>${corpo}<row r="${linhaTotal}" ht="36" customHeight="1">${totais}</row><row r="${linhaAtualizacao}" ht="26" customHeight="1">${texto(`A${linhaAtualizacao}`, `Atualizado em: ${hojeBR()}`, 12)}</row></sheetData><autoFilter ref="A4:${ultimaColuna}${filtroFinal}"/><mergeCells count="4"><mergeCell ref="A1:${ultimaColuna}1"/><mergeCell ref="A2:${ultimaColuna}2"/><mergeCell ref="A3:${ultimaColuna}3"/><mergeCell ref="A${linhaAtualizacao}:${ultimaColuna}${linhaAtualizacao}"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1" horizontalDpi="300" verticalDpi="300"/></worksheet>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inteiro(buffer, deslocamento, valor, bytes) {
  for (let i = 0; i < bytes; i++) buffer[deslocamento + i] = (valor >>> (i * 8)) & 0xff;
}

function criarZip(arquivos) {
  const encoder = new TextEncoder();
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const [nome, conteudo] of arquivos) {
    const nomeBytes = encoder.encode(nome);
    const dados = encoder.encode(conteudo);
    const crc = crc32(dados);
    const local = new Uint8Array(30 + nomeBytes.length + dados.length);
    inteiro(local, 0, 0x04034b50, 4); inteiro(local, 4, 20, 2); inteiro(local, 6, 0x0800, 2);
    inteiro(local, 14, crc, 4); inteiro(local, 18, dados.length, 4); inteiro(local, 22, dados.length, 4);
    inteiro(local, 26, nomeBytes.length, 2); local.set(nomeBytes, 30); local.set(dados, 30 + nomeBytes.length);
    locais.push(local);

    const central = new Uint8Array(46 + nomeBytes.length);
    inteiro(central, 0, 0x02014b50, 4); inteiro(central, 4, 20, 2); inteiro(central, 6, 20, 2);
    inteiro(central, 8, 0x0800, 2); inteiro(central, 16, crc, 4); inteiro(central, 20, dados.length, 4);
    inteiro(central, 24, dados.length, 4); inteiro(central, 28, nomeBytes.length, 2);
    inteiro(central, 42, deslocamento, 4); central.set(nomeBytes, 46);
    centrais.push(central);
    deslocamento += local.length;
  }

  const tamanhoCentral = centrais.reduce((total, parte) => total + parte.length, 0);
  const fim = new Uint8Array(22);
  inteiro(fim, 0, 0x06054b50, 4); inteiro(fim, 8, arquivos.length, 2); inteiro(fim, 10, arquivos.length, 2);
  inteiro(fim, 12, tamanhoCentral, 4); inteiro(fim, 16, deslocamento, 4);
  return new Blob([...locais, ...centrais, fim], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// As partes fixas do pacote OOXML. Ficam aqui porque as duas planilhas do
// painel — a matriz e o detalhe de uma célula — usam os mesmos estilos: o mesmo
// verde institucional, a mesma fonte, a mesma numeração.
const EXCEL_TIPOS = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
const EXCEL_RELACOES = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const EXCEL_WORKBOOK_RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
const EXCEL_ESTILOS = '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;-#,##0;&quot;—&quot;"/></numFmts><fonts count="11"><font><sz val="11"/><color rgb="FF112720"/><name val="Montserrat"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Montserrat"/></font><font><sz val="10"/><color rgb="FFE6F2EF"/><name val="Montserrat"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Montserrat"/></font><font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Montserrat"/></font><font><b/><sz val="9"/><color rgb="FF112720"/><name val="Montserrat"/></font><font><b/><sz val="12"/><color rgb="FF112720"/><name val="Montserrat"/></font><font><b/><sz val="12"/><color rgb="FF00534B"/><name val="Montserrat"/></font><font><b/><sz val="12"/><color rgb="FF991B1B"/><name val="Montserrat"/></font><font><sz val="9"/><color rgb="FF718096"/><name val="Montserrat"/></font><font><b/><sz val="13"/><color rgb="FF00332D"/><name val="Montserrat"/></font></fonts><fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00534B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00453E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0F0E8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9F3EF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFBFE3D1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FBFA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD7E2DE"/></left><right style="thin"><color rgb="FFD7E2DE"/></right><top style="thin"><color rgb="FFD7E2DE"/></top><bottom style="thin"><color rgb="FFD7E2DE"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FF00534B"/></left><right style="thin"><color rgb="FF00534B"/></right><top style="thin"><color rgb="FF00534B"/></top><bottom style="thin"><color rgb="FF00534B"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FF2F7668"/></left><right style="thin"><color rgb="FF2F7668"/></right><top style="thin"><color rgb="FF2F7668"/></top><bottom style="thin"><color rgb="FF2F7668"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="14"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="7" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="8" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="5" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="7" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="10" fillId="8" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="9" fillId="9" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';

// Monta o .xlsx a partir de uma folha já pronta. O que muda entre as duas
// exportações é só o XML da folha e o nome da aba.
function pacoteExcel(folhaXml, nomeAba, areaImpressao) {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${escaparXml(nomeAba)}" sheetId="1" r:id="rId1"/></sheets>${areaImpressao}<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
  return criarZip([
    ['[Content_Types].xml', EXCEL_TIPOS], ['_rels/.rels', EXCEL_RELACOES],
    ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', EXCEL_WORKBOOK_RELS],
    ['xl/worksheets/sheet1.xml', folhaXml], ['xl/styles.xml', EXCEL_ESTILOS]
  ]);
}

function criarExcel(linhas) {
  const dados = dadosTabulares(linhas);
  const ultimaColuna = colunaExcel(dados[0].length - 1);
  const ultimaLinha = dados.length + 4;
  const area = `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Acervo'!$A$1:$${ultimaColuna}$${ultimaLinha}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Acervo'!$4:$4</definedName></definedNames>`;
  return pacoteExcel(planilhaXml(linhas), 'Acervo', area);
}

// ── Detalhe de uma célula: a lista de processos daquele bloco ────────────────
// Uma linha por processo, nas mesmas colunas que o card mostra na tela.
function planilhaDetalheXml(processos, titulo) {
  const colunas = ['Nº do Processo', 'Cadeira', 'Conselheiro', 'Distribuição', 'Dias parados'];
  const texto = (col, linha, valor, estilo) =>
    `<c r="${colunaExcel(col)}${linha}" s="${estilo}" t="inlineStr"><is><t>${escaparXml(valor)}</t></is></c>`;
  const numero = (col, linha, valor, estilo) =>
    `<c r="${colunaExcel(col)}${linha}" s="${estilo}"><v>${valor}</v></c>`;

  const linhas = [
    `<row r="1" ht="34" customHeight="1">${texto(0, 1, titulo, 1)}</row>`,
    `<row r="2" ht="20" customHeight="1">${texto(0, 2, `${processos.length} processo(s) aguardando julgamento — Atualizado em: ${hojeBR()}`, 2)}</row>`,
    `<row r="4" ht="22" customHeight="1">${colunas.map((c, n) => texto(n, 4, c, n === 0 ? 13 : 4)).join('')}</row>`
  ];

  processos.forEach((p, n) => {
    const linha = 5 + n;
    linhas.push(`<row r="${linha}" ht="18" customHeight="1">`
      + texto(0, linha, p.num_processo, 5)
      + texto(1, linha, p.relator, 5)
      + texto(2, linha, p.conselheiro, 5)
      + texto(3, linha, dataBR(p.data_distribuicao), 5)
      + numero(4, linha, Number(p.dias) || 0, 6)
      + '</row>');
  });

  return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="10" customWidth="1"/>'
    + '<col min="3" max="3" width="34" customWidth="1"/><col min="4" max="4" width="16" customWidth="1"/>'
    + '<col min="5" max="5" width="14" customWidth="1"/></cols>'
    + `<sheetData>${linhas.join('')}</sheetData>`
    + '<mergeCells count="2"><mergeCell ref="A1:E1"/><mergeCell ref="A2:E2"/></mergeCells>'
    + '</worksheet>';
}

function criarExcelDetalhe(processos, titulo) {
  const ultimaLinha = processos.length + 4;
  const area = `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Detalhe'!$A$1:$E$${ultimaLinha}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Detalhe'!$4:$4</definedName></definedNames>`;
  return pacoteExcel(planilhaDetalheXml(processos, titulo), 'Detalhe', area);
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

// Bloco com número abre a lista daquele recorte. `ordem` e `relator` vazios são
// o total: a função do banco entende os dois como "não filtre por isso", e é o
// que faz o total da linha, o da coluna e o geral serem clicáveis pelo mesmo
// caminho da célula.
function tornarClicavel(celulaEl, { ordem = '', relator = '', rotulo }) {
  celulaEl.dataset.ordem = ordem;
  celulaEl.dataset.relator = relator;
  celulaEl.dataset.rotulo = rotulo;
  celulaEl.tabIndex = 0;
  celulaEl.setAttribute('role', 'button');
  // A célula de faixa crítica já anuncia o alerta. Substituir esse rótulo pelo
  // da ação esconderia a urgência; os dois somam.
  const alerta = celulaEl.getAttribute('aria-label');
  celulaEl.setAttribute('aria-label',
    alerta ? `${alerta}. ${rotulo}: ver os processos` : `${rotulo}: ver os processos`);
  return celulaEl;
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
      const td = celula(n || '—', 'td', n ? 'acervo-detalhe' : 'acervo-zero');
      if (n) tornarClicavel(td, { ordem, relator: r, rotulo: `${faixa} · ${r}` });
      tr.append(td);
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
    if (somaLinha) tornarClicavel(totalLinha, { ordem, rotulo: `${faixa} · todas as cadeiras` });
    tr.append(totalLinha);
    total += somaLinha;
    tbody.append(tr);
  });

  const rodape = document.createElement('tfoot');
  const trTotal = document.createElement('tr');
  trTotal.append(celula('Total', 'th', 'linha'));
  relatores.forEach(r => {
    const soma = faixas.reduce((acc, [ordem]) => acc + (valor.get(`${ordem}|${r}`) || 0), 0);
    const td = celula(soma || '—', 'td', soma ? 'acervo-detalhe' : 'acervo-zero');
    if (soma) tornarClicavel(td, { relator: r, rotulo: `${r} · todo o período` });
    trTotal.append(td);
  });
  const totalGeral = celula(total || '—', 'td', `acervo-total-col${total ? ' acervo-detalhe' : ''}`);
  if (total) tornarClicavel(totalGeral, { rotulo: 'Todo o acervo aguardando julgamento' });
  trTotal.append(totalGeral);
  rodape.append(trTotal);

  acervoTabela.replaceChildren(thead, tbody, rodape);
  return total;
}

async function carregarAcervo({ carregamentoInicial = false } = {}) {
  acervoErro.hidden = true;
  acervoVazio.hidden = true;
  acervoAtualizado.textContent = 'Carregando…';
  btnAtualizar.disabled = true;
  btnExportar.disabled = true;
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
    linhasAtuais = null;
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
  linhasAtuais = linhas || [];
  btnExportar.disabled = false;
  acervoTotal.textContent = total === 1
    ? '1 processo aguardando julgamento'
    : `${total} processos aguardando julgamento`;
  acervoAtualizado.textContent = `Atualizado em: ${hojeBR()}`;
  acervoVazio.hidden = total > 0;
  return true;
}

// ── Detalhe: o card com os processos de um bloco ─────────────────────────────
// A tabela conta; o card lista. Quem faz a lista é processos_acervo_cj, com a
// MESMA definição de pendente e as mesmas faixas do resumo — se as duas
// divergirem, o card abre um número diferente do que o bloco mostrava.

function abrirDetalheDaCelula(evento) {
  const celulaEl = evento.target.closest('[data-rotulo]');
  if (celulaEl && acervoTabela.contains(celulaEl)) abrirDetalhe(celulaEl);
}

function abrirDetalheDoTeclado(evento) {
  if (evento.key !== 'Enter' && evento.key !== ' ') return;
  const celulaEl = evento.target.closest('[data-rotulo]');
  if (!celulaEl || !acervoTabela.contains(celulaEl)) return;
  // Espaço rolaria a página sob o card que está prestes a abrir.
  evento.preventDefault();
  abrirDetalhe(celulaEl);
}

async function abrirDetalhe(celulaEl) {
  const { ordem, relator, rotulo } = celulaEl.dataset;
  detalheAtual = null;
  detalheTitulo.textContent = rotulo;
  detalheResumo.textContent = 'Carregando…';
  detalheTabela.replaceChildren();
  detalheErro.hidden = true;
  detalheCorpo.hidden = true;
  detalheLoading.hidden = false;
  detalheLoading.replaceChildren(criarIndicadorCarregamento('Carregando processos…'));
  btnExportarDetalhe.disabled = true;
  // showModal antes da busca: o card aparece com o loading em vez de a tela
  // ficar parada sem resposta ao clique.
  if (!detalheDialog.open) detalheDialog.showModal();

  let processos;
  try {
    processos = await api('rpc/processos_acervo_cj', {
      method: 'POST',
      body: JSON.stringify({ p_ordem: ordem ? Number(ordem) : null, p_relator: relator || null })
    });
  } catch (err) {
    // Sessão expirada já recolocou a tela de login atrás do card; deixá-lo
    // aberto por cima esconderia justamente o formulário.
    if (err.status === 401) {
      detalheDialog.close();
      return;
    }
    detalheLoading.hidden = true;
    detalheLoading.replaceChildren();
    detalheCorpo.hidden = true;
    detalheResumo.textContent = '';
    detalheErro.querySelector('p').textContent = `Não foi possível carregar os processos (${err.message}).`;
    detalheErro.hidden = false;
    return;
  }

  detalheLoading.hidden = true;
  detalheLoading.replaceChildren();
  detalheCorpo.hidden = false;
  detalheAtual = { rotulo, processos: processos || [] };
  desenharDetalhe(detalheAtual.processos);
  btnExportarDetalhe.disabled = detalheAtual.processos.length === 0;
}

function desenharDetalhe(processos) {
  const quantidade = processos.length === 1 ? '1 processo' : `${processos.length} processos`;
  detalheResumo.textContent = `${quantidade} · Atualizado em: ${hojeBR()}`;

  const thead = document.createElement('thead');
  const cabecalho = document.createElement('tr');
  ['Nº do Processo', 'Relator', 'Distribuição', 'Dias parados']
    .forEach(rotulo => cabecalho.append(celula(rotulo, 'th')));
  thead.append(cabecalho);

  const tbody = document.createElement('tbody');
  processos.forEach(p => {
    const tr = document.createElement('tr');
    tr.append(celula(p.num_processo, 'th', 'linha'));
    const cadeira = celula(p.relator);
    if (p.conselheiro && p.conselheiro !== p.relator) cadeira.title = p.conselheiro;
    tr.append(cadeira);
    tr.append(celula(dataBR(p.data_distribuicao)));
    tr.append(celula(p.dias));
    tbody.append(tr);
  });

  detalheTabela.replaceChildren(thead, tbody);
}

function exportarDetalhe() {
  if (!detalheAtual || !detalheAtual.processos.length) return;
  const nome = detalheAtual.rotulo.replace(/[^\wÀ-ÿ]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  baixarArquivo(criarExcelDetalhe(detalheAtual.processos, detalheAtual.rotulo),
    `acervo-cj-${nome}-${dataArquivo()}.xlsx`);
}
