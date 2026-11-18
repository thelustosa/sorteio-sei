// A ata do sorteio em .docx, a mesma para as duas portas que a baixam: o
// resultado, logo depois do sorteio (index.js), e o card do histórico
// (historico.js). Eram dois templates que divergiam — colunas, cabeçalho e
// ordem das linhas — e por isso o código mora num arquivo só, que o bootstrap
// carrega junto com essas duas telas.
//
// O arquivo segue o padrão das atas que a AGR publica: parágrafo de abertura e
// a tabela do sorteio — sem Assunto/Decisão, que existem na tela mas não na
// ata oficial, e sem cabeçalho institucional nem "ATA Nº ...": a exportação
// registra o conteúdo do sorteio, não substitui a ata assinada no SEI.
//
// Sem biblioteca: um .docx é um zip com XML dentro (WordprocessingML), e o
// projeto já monta esse zip à mão para o Excel do acervo.
//
// Cada processo chega no formato da RPC processos_sorteio: { ordem,
// num_processo, destino, responsavel, interessado }.

const ATAS = {
  // A Câmara distribui por RELATOR, e a ata publica o nome de quem vai relatar
  // — não o código da cadeira (`destino`).
  CJ: {
    colunas: [
      { rotulo: 'Ordem', campo: 'ordem', pct: 600 },
      { rotulo: 'Nº do Processo', campo: 'num_processo', pct: 2200 },
      { rotulo: 'Relator', campo: 'responsavel', pct: 2200 }
    ],
    // Sem o número da Resolução Normativa que designa a composição da
    // Câmara: essa informação não fica gravada por sorteio, e citar um
    // número aqui arriscaria uma ata com uma resolução desatualizada.
    introducao: (dia, mes, ano) => `Aos ${dia} dias do mês de ${mes} de ${ano} na sede da `
      + `Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos – AGR, `
      + `realizou-se a distribuição de processos para análise, elaboração de relatório e voto `
      + `entre os integrantes da Câmara de Julgamento, através de sorteio eletrônico.`
  },
  CREG: {
    colunas: [
      { rotulo: 'Ordem', campo: 'ordem', pct: 500 },
      { rotulo: 'Nº do Processo', campo: 'num_processo', pct: 1800 },
      { rotulo: 'Interessado', campo: 'interessado', pct: 1800 },
      { rotulo: 'Unidade', campo: 'destino', pct: 900 }
    ],
    introducao: (dia, mes, ano) => `Aos ${dia} dias do mês de ${mes} de ${ano} na sede da `
      + `Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos, realizou-se `
      + `a distribuição de processos por sorteio eletrônico.`
  }
};

// A ordem das linhas na ata.
// - CJ: ordem do sorteio, com as linhas da CJ1 por último (pedido da
//   secretaria), também na ordem do sorteio entre si. A coluna Ordem é
//   renumerada 1, 2, 3… na posição em que a linha sai — a ata não mostra o
//   salto que a CJ1 no fim deixaria (…6, 8…, 7, 12).
// - CREG: agrupa por unidade (CREG1, CREG2…), ordem do sorteio dentro de cada
//   uma, com a Ordem gravada no sorteio.
// Linha sem ordem vai para o FIM do seu grupo, com o número do processo como
// desempate — o mesmo `order by 1 nulls last, 2` da RPC.
function linhasDaAta(colegiado, processos) {
  const grupo = colegiado === 'CREG'
    ? p => String(p.destino)
    : p => (p.destino === 'CJ1' ? '1' : '0');
  const linhas = [...processos].sort((a, b) =>
    grupo(a).localeCompare(grupo(b), 'pt-BR', { numeric: true })
    || ordemDaAta(a) - ordemDaAta(b)
    || String(a.num_processo).localeCompare(String(b.num_processo)));
  return colegiado === 'CREG' ? linhas : linhas.map((p, i) => ({ ...p, ordem: i + 1 }));
}

function ordemDaAta(processo) {
  // `Number(null)` é 0, e não NaN: o nulo precisa sair antes da conversão.
  const ordem = processo.ordem == null ? NaN : Number(processo.ordem);
  return Number.isFinite(ordem) ? ordem : Infinity;
}

// `data` é aaaa-mm-dd: a da rodada, não a de hoje — a ata registra quando o
// sorteio aconteceu, não quando foi exportada.
function criarAtaDocx(colegiado, processos, data) {
  const ata = ATAS[colegiado];
  const { dia, mes, ano } = dataDaAtaPorExtenso(data);
  const corpo = paragrafoXml(ata.introducao(dia, mes, ano), { justificado: true })
    + paragrafoXml('')
    + tabelaDocxXml(ata.colunas, linhasDaAta(colegiado, processos))
    + DOCX_SECAO;
  const documentoXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${corpo}</w:body></w:document>`;
  return criarZipDocx([
    ['[Content_Types].xml', DOCX_TIPOS], ['_rels/.rels', DOCX_RELACOES],
    ['word/document.xml', documentoXml]
  ]);
}

const MESES_POR_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Sem passar por toLocaleDateString: o nome do mês sairia dependente da ICU do
// motor, e a ata precisa da mesma grafia sempre.
function dataDaAtaPorExtenso(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-').map(Number);
  return { dia, mes: MESES_POR_EXTENSO[mes - 1] || '', ano };
}

function valorDaColunaDocx(processo, campo) {
  if (campo === 'ordem') return processo.ordem ?? '—';
  return processo[campo] || '—';
}

function escaparXml(valor) {
  return String(valor).replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[caractere]);
}

function paragrafoXml(texto, { negrito = false, centralizado = false, justificado = false } = {}) {
  const pPr = centralizado ? '<w:pPr><w:jc w:val="center"/></w:pPr>'
    : justificado ? '<w:pPr><w:jc w:val="both"/></w:pPr>' : '';
  const rPr = negrito ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r></w:p>`;
}

function celulaDocxXml(texto, { negrito = false, pct } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${pct}" w:type="pct"/></w:tcPr>`
    + `${paragrafoXml(texto, { negrito })}</w:tc>`;
}

// A largura que sobra entre as margens do DOCX_SECAO, em twips. É a régua do
// <w:tblGrid>, que só aceita medida absoluta — o `pct` das colunas é convertido
// contra ela.
const DOCX_LARGURA_UTIL = 11906 - 1701 - 1133;

// O <w:tblGrid> é obrigatório no CT_Tbl e tem de vir logo depois do <w:tblPr>:
// sem ele o Word não abre a ata, oferece reparar o arquivo.
//
// O arredondamento é cumulativo — cada coluna recebe a diferença entre o seu
// acumulado e o da anterior — para que a soma feche a largura útil exata em vez
// de escorregar um twip por coluna arredondada.
function gradeDocxXml(colunas) {
  const total = colunas.reduce((soma, c) => soma + c.pct, 0);
  let acumulado = 0;
  let anterior = 0;
  const grade = colunas.map(c => {
    acumulado += c.pct;
    const limite = Math.round(acumulado / total * DOCX_LARGURA_UTIL);
    const largura = limite - anterior;
    anterior = limite;
    return `<w:gridCol w:w="${largura}"/>`;
  }).join('');
  return `<w:tblGrid>${grade}</w:tblGrid>`;
}

function tabelaDocxXml(colunas, processos) {
  const cabecalho = `<w:tr>${colunas.map(c => celulaDocxXml(c.rotulo, { negrito: true, pct: c.pct })).join('')}</w:tr>`;
  const linhas = processos.map(processo =>
    `<w:tr>${colunas.map(c => celulaDocxXml(String(valorDaColunaDocx(processo, c.campo)), { pct: c.pct })).join('')}</w:tr>`
  ).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${DOCX_TABELA_BORDAS}</w:tblBorders></w:tblPr>`
    + `${gradeDocxXml(colunas)}${cabecalho}${linhas}</w:tbl>`;
}

const DOCX_TIPOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" '
  + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';
const DOCX_RELACOES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" '
  + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
  + 'Target="word/document.xml"/></Relationships>';
// Uma borda simples em toda a tabela, para não sair sem contorno nenhum no
// Word — o schema exige as seis direções, mesmo repetindo o mesmo traço.
const DOCX_TABELA_BORDAS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map(lado => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('');
const DOCX_SECAO = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
  + '<w:pgMar w:top="1417" w:right="1133" w:bottom="1417" w:left="1701" w:header="708" w:footer="708" '
  + 'w:gutter="0"/></w:sectPr>';

// Os nomes do zip têm sufixo próprio: os scripts clássicos dividem o escopo
// global, e acervo.js já declara crc32/criarZip (ver test_assets.mjs).
function crc32Docx(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inteiroDocx(buffer, deslocamento, valor, bytes) {
  for (let i = 0; i < bytes; i++) buffer[deslocamento + i] = (valor >>> (i * 8)) & 0xff;
}

function criarZipDocx(arquivos) {
  const encoder = new TextEncoder();
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const [nome, conteudo] of arquivos) {
    const nomeBytes = encoder.encode(nome);
    const dados = encoder.encode(conteudo);
    const crc = crc32Docx(dados);
    const local = new Uint8Array(30 + nomeBytes.length + dados.length);
    inteiroDocx(local, 0, 0x04034b50, 4); inteiroDocx(local, 4, 20, 2); inteiroDocx(local, 6, 0x0800, 2);
    inteiroDocx(local, 14, crc, 4); inteiroDocx(local, 18, dados.length, 4); inteiroDocx(local, 22, dados.length, 4);
    inteiroDocx(local, 26, nomeBytes.length, 2); local.set(nomeBytes, 30); local.set(dados, 30 + nomeBytes.length);
    locais.push(local);

    const central = new Uint8Array(46 + nomeBytes.length);
    inteiroDocx(central, 0, 0x02014b50, 4); inteiroDocx(central, 4, 20, 2); inteiroDocx(central, 6, 20, 2);
    inteiroDocx(central, 8, 0x0800, 2); inteiroDocx(central, 16, crc, 4); inteiroDocx(central, 20, dados.length, 4);
    inteiroDocx(central, 24, dados.length, 4); inteiroDocx(central, 28, nomeBytes.length, 2);
    inteiroDocx(central, 42, deslocamento, 4); central.set(nomeBytes, 46);
    centrais.push(central);
    deslocamento += local.length;
  }

  const tamanhoCentral = centrais.reduce((total, parte) => total + parte.length, 0);
  const fim = new Uint8Array(22);
  inteiroDocx(fim, 0, 0x06054b50, 4); inteiroDocx(fim, 8, arquivos.length, 2); inteiroDocx(fim, 10, arquivos.length, 2);
  inteiroDocx(fim, 12, tamanhoCentral, 4); inteiroDocx(fim, 16, deslocamento, 4);
  return new Blob([...locais, ...centrais, fim],
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
