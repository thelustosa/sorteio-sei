# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Duas secretarias executivas da AGR (Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos), cada uma operando seu próprio modo do sistema:

- **Secretário Executivo do Conselho Regulador** — modo CREG.
- **Secretária Executiva da Câmara de Julgamento** — modo CJ.

São as únicas duas pessoas com login e ações no sistema (confirmado). Os conselheiros/relatores (cadeiras CJ1-5 e unidades CREG1-4) são **destinos** da distribuição de processos, não usuários logados — aparecem na interface só como o resultado do sorteio ou do julgamento, nunca autenticam.

## Product Purpose

Substituir a distribuição manual (planilha) de processos administrativos do SEI entre as cadeiras/unidades da Câmara de Julgamento e do Conselho Regulador por um sorteio eletrônico igualitário e auditável, e manter o registro digital do que acontece depois da distribuição: o voto e o status de cada processo julgado, o acervo corrente de cada colegiado e o histórico de todas as rodadas já sorteadas. Sucesso é uma distribuição comprovadamente justa, com rastro de quem fez o quê e quando, sem depender de planilha ou de confiança na palavra de quem sorteou.

## Positioning

O mecanismo de sorteio é publicamente auditável: o repositório é público, sob licença MIT, e qualquer interessado pode inspecionar o código-fonte exato da lógica de distribuição (Fisher-Yates com `crypto.getRandomValues`, sem viés de módulo, com balanceamento proporcional cruzado por Assunto) para verificar impessoalidade e igualdade matemática. Um concorrente construído como caixa-preta, como macro de planilha fechada, ou que dependa de biblioteca paga não conseguiria fazer a mesma alegação com a mesma verificabilidade.

## Operating Context

- Dois colegiados da AGR, cada um com sua composição de cadeiras/unidades: Câmara de Julgamento (CJ1-5, com conselheiro nomeado por cadeira) e Conselho Regulador (CREG1-4).
- Os processos vêm do sistema SEI. As pautas de julgamento chegam publicadas pela própria AGR e entram sozinhas no acervo de pendências.
- Um "sorteio" é um evento só: gerar as linhas, preencher os processos, sortear, e o resultado já grava no banco (`acervo_cj` / `acervo_creg`) — não há passo manual depois para o registro entrar no histórico.
- Depois do sorteio, a secretaria correspondente abre a página de Registro de Julgamentos quando as sessões já realizadas ainda têm processo sem voto ou sem status, e preenche um a um.
- Hospedagem 100% estática no GitHub Pages; dados em Supabase/Postgres com RLS; um job do GitHub Actions (`sincronizacao/`) busca as pautas publicadas pela AGR periodicamente.
- Existe um Termo de Entrega oficial do projeto, protocolado no próprio SEI (`documentos/SEI_93024891_Termo_de_Entrega_1.pdf`), então o sistema tem status de entrega formal à AGR, não é uma ferramenta interna informal.

## Capabilities and Constraints

- Login obrigatório (Supabase Auth) antes de qualquer ação; senhas nunca ficam no código, só validadas pelo servidor.
- Distribuição garante o mesmo total de processos por unidade/cadeira, com balanceamento proporcional cruzado por Assunto — nenhuma unidade fica só com um tipo de assunto.
- Modo CJ: Assunto é sempre "Auto de Infração", travado. Modo CREG: Assunto é livre, mas o campo Recurso se auto-trava em "Não se aplica" quando o assunto não é "Auto de Infração".
- A 6ª coluna muda de nome por colegiado: "Defesa" (Sim/Não) na CJ, "Recurso" no CREG — são conceitos diferentes, nunca a mesma pergunta com rótulo trocado.
- Validação bloqueia o sorteio se houver campo em branco ou número de processo repetido, apontando a linha em conflito.
- A ata do sorteio e as atas do histórico saem em `.doc`/`.docx` gerado à mão como zip WordprocessingML no próprio navegador — sem biblioteca externa, condição para o repositório continuar redistribuível sob MIT sem custo de licença.
- Sem banco configurado, ou se o envio falhar, o sistema oferece baixar o sorteio completo em `.json` como saída alternativa — nunca perde o resultado por falha de rede.
- Todo registro (sorteio, voto, status) grava quem fez e quando — rastreabilidade não é opcional em nenhum dos fluxos.
- Repositório público, licença MIT: qualquer mudança na lógica de distribuição precisa continuar auditável por terceiros de fora da AGR.
- Nenhum padrão de acessibilidade é exigido formalmente ainda (confirmado com o time) — o código segue boas práticas gerais (aria-label, foco, contraste), mas não há obrigação documentada de WCAG ou eMAG. Registrar aqui para não presumir essa exigência em trabalho futuro sem que o time a formalize.

## Brand Commitments

Nome do produto: **Sorteador de Processos SEI** (título da página inicial: "Sorteio de Processos SEI"). A identidade visual já existente segue a identidade institucional oficial do portal do Estado de Goiás — isto é um fato documentado no próprio README, não uma direção de design em aberto: verde institucional `#00534b` como cor de realce, painel interno em verde-menta claro `#E9F5EC`, rodapé em faixa verde institucional com o logotipo oficial branco, e tipografia em Montserrat (licença OFL, substituindo a Gotham comercial porque o repositório é público sob MIT). Qualquer trabalho visual futuro documenta ou estende esse sistema — DESIGN.md, via `/impeccable document`, é quem formaliza os tokens; este arquivo só registra que o compromisso de marca existe e de onde vem.

## Evidence on Hand

- Capturas de tela reais em uso no próprio README: `assets/img/screenshot_start.png` (tela de início) e `assets/img/screenshot.png` (interface do sorteador).
- Termo de Entrega oficial protocolado no SEI: `documentos/SEI_93024891_Termo_de_Entrega_1.pdf`.
- Instância pública em produção: https://thelustosa.github.io/sorteio-sei/.
- O próprio repositório público é a evidência da alegação de auditabilidade (ver Positioning) — não é uma prova externa, é o mecanismo.
- Não há depoimento de usuário, estudo de caso ou cobertura de imprensa registrados. Trabalho futuro não deve inventar nenhum dos três.

## Product Principles

1. A distribuição precisa ser matematicamente justa, sem viés e comprovável por qualquer pessoa lendo o código-fonte — nunca um atalho que não possa ser verificado publicamente.
2. Zero dependência paga ou proprietária no stack (hospedagem estática, exportação Word feita à mão no navegador, fonte sob OFL) — é o que mantém o repositório público redistribuível sob MIT.
3. Toda ação registrada (sorteio, voto, status) grava autoria e horário — rastreabilidade é requisito do produto, não um recurso opcional.
4. CREG e CJ compartilham o sistema mas mantêm vocabulário e regras próprios (Recurso vs. Defesa, assunto livre vs. travado) — nunca forçar a lógica de um colegiado sobre o outro.
5. Confiança institucional acima de floreio visual: é uma ferramenta de auditoria de um órgão de governo, não uma superfície de marketing, e a identidade visual segue o portal oficial do Estado de Goiás por causa disso.

## Accessibility & Inclusion

Nenhum padrão formal exigido (confirmado com o time nesta sessão). Trabalho futuro segue boas práticas gerais de acessibilidade já presentes no código (rótulos ARIA, gestão de foco, contraste, `prefers-reduced-motion`), mas não deve presumir nem exigir conformidade WCAG/eMAG completa até que o time formalize essa exigência.
