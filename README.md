# Blotter de ordens offline

Next.js App Router + React + **styled-components** (incluindo registro de estilos SSR), PouchDB/IndexedDB e replicação CouchDB opcional. Não usa Tailwind.

## Rodar

Node.js 24 e npm 11 foram usados na validação.

```sh
cd /workspace/newBlotter
npm ci --cache /workspace/.npm-cache
npm run dev
```

Na primeira abertura, a aplicação cria os índices e injeta **5.000 ordens automaticamente**, em lotes de 250 documentos. O progresso aparece na tela. A carga é idempotente e preserva ordens editadas. O banco `blotter-orders-v2` pertence ao navegador e à origem da aplicação; ele preserva o antigo banco genérico `blotter-v1`, sem migrar ou sobrescrever seus dados.

```sh
npm run typecheck
npm test
npm run build
npm start
```

Não execute build simultaneamente com um dev server que use o mesmo `.next`.

## Usar a mesa

- A tabela tem exatamente **20 colunas** de negócio, todas ordenáveis, e **10 filtros**. Texto usa prefixo sem diferenciar maiúsculas; números usam valor exato, com ponto decimal. Datas são filtradas pelo prefixo ISO, por exemplo `2026-10-08`.
- Clique seleciona uma ordem. Ctrl/Cmd ou checkboxes adicionam/removem seleção. Shift seleciona um intervalo da página. O checkbox no cabeçalho seleciona a página atual, sem adicionar uma 21ª coluna.
- A seleção persiste entre páginas. Botão direito em uma ordem já selecionada abre ações para toda a seleção; em uma ordem não selecionada, abre ações só para ela. Shift+F10 também abre o menu e as setas navegam pelas ações. Ações em lote só ficam habilitadas quando todas as ordens selecionadas permitem a operação; revisões antigas bloqueiam as ações até selecionar novamente.
- Toda ordem chega em **Pendente aceite**, **Sem trader**. Duplo clique ou **Editar** abre edição de ativo, lado, quantidade, preço limite, cliente e observações somente nesse estado. Chaves de busca, financeiro e data de atualização são recalculados ao gravar. Trader não pode ser atribuído pelo formulário de edição.
- **Aceitar**, **rejeitar** com motivo, **encaminhar** para um trader, **executar** parcial/total, **cancelar** e **exportar CSV** funcionam para uma ou várias ordens.
- **Aceitar** muda Pendente aceite para **Nova** e bloqueia a edição inteira. **Rejeitar** só é permitido enquanto Pendente aceite, mudando para Rejeitada. **Encaminhar** exige status Nova e atribui o trader sem mudar o status. **Executar** exige Nova/Parcial, trader atribuído e saldo; respeita quantidade e preço limite. Cancelar é permitido em Nova/Parcial e preserva fills. Executada/Rejeitada/Cancelada bloqueiam alterações, mas continuam exportáveis.
- Na execução em lote, quantidade informada é aplicada a cada ordem; em branco usa o saldo de cada uma. Preço em branco usa o limite de cada ordem. Resultados de ações em lote podem ter sucesso parcial: cada documento é validado e cada retorno de `bulkDocs` é inspecionado.
- **Simular chegada** insere uma nova ordem. O feed `changes` atualiza a tabela sem reload. O cartão de performance mede o tempo real da última consulta local, incluindo atualização do índice, não o tempo total de renderização.
- CSV contém somente as ordens selecionadas, tem BOM UTF-8 e separador `;` para abrir em Excel/LibreOffice. Valores que poderiam ser interpretados como fórmulas são escapados. Não é um arquivo binário `.xlsx`.

Todas as ações/executions são **simulações locais**, replicáveis se CouchDB estiver configurado. Não há integração com bolsa, OMS, limites autoritativos de risco ou identidade do operador. O histórico limitado por documento é demonstrativo; auditoria e autorizações de produção devem ser implementadas no backend.

## Arquivos

- `lib/database.ts`: PouchDB browser, plugin Mango, seed em lotes e `sync({ live: true, retry: true })`.
- `lib/model.ts`: 20 colunas, ordens mockadas e chaves ordenáveis (números têm encoding numérico, não ordenação lexical).
- `lib/query.ts`: índices persistentes e `fetchPage`/`buildQuery` com `db.find`.
- `lib/useBlotter.ts`: preparação, debounce de 250 ms, feed local e descarte de respostas antigas.
- `lib/orders.ts`: política compartilhada entre menu e gravação, edições, ações em lote, controle de revisão e exportação.
- `lib/workflow-migration.ts`: atualização idempotente de documentos do fluxo antigo, preservando edições, histórico, atribuições explícitas e fills. Antigas Nova sem aceite viram Pendente aceite/Sem trader; Aceita/Encaminhada viram Nova, preservando apenas atribuição explícita de trader. Documentos novos têm `workflowVersion: "2"`.
- `components/DataTable.tsx`, `OrderDialog.tsx`: seleção, menu contextual, formulários e tabela.
- `components/blotter.styles.ts`, `StyleRegistry.tsx`: estilos e integração SSR de styled-components.

## Índices, cursores e limites de performance

Documentos usam `kind: 'row'`, `c01` até `c20`, `k01` até `k20` e IDs com prefixo `row:`. Cada `kNN` contém o valor normalizado/numérico ordenável, NUL e o ID único. Escritores remotos precisam usar o mesmo contrato de `makeRow` e atualizar as chaves junto com os valores. IDs e chaves evitam omissões quando valores se repetem. Texto editável aceita Unicode, sem caracteres de controle; os filtros por prefixo deste exemplo aceitam ASCII. Valores numéricos ordenáveis são não negativos, até um bilhão, com até quatro decimais.

Os índices `[kind, kNN]` são criados sequencialmente e reutilizados após reload; não reconstruímos os 20 índices na inicialização quando já existem. Eles são atualizados pelo PouchDB ao consultar após gravações. A primeira consulta de uma coluna pode ser mais lenta porque atualiza a árvore correspondente.

A página usa 50 linhas e um cursor na última chave. `$gte`/`$lte` faz seek inclusivo; descartamos somente a linha de borda se ela for exatamente o cursor. `limit: 51` inicialmente e `52` nas páginas seguintes permitem detectar uma página adicional. Esse cuidado contorna a exclusão de borda depois do `limit` em alguns planos do PouchDB 9. Não há `skip` crescente, busca de todo o dataset para filtrar no React ou total global obtido por varredura.

PouchDB usa **um índice por consulta**. Filtros em outras colunas são avaliados residualmente pelo Mango; o próprio plugin pode materializar muitos candidatos em memória antes de limitar. A memória da UI é limitada à página, mas isso não garante custo constante do mecanismo Mango em combinações arbitrárias. Workloads muito seletivos podem precisar de índices compostos planejados para seus filtros. Não há promessa de latência instantânea em qualquer dispositivo.

Alterações realtime são agrupadas por 120 ms e reiniciam a paginação para evitar cursors obsoletos. Não há snapshot estável entre páginas durante gravações concorrentes. A seleção guarda IDs/revisões, sem carregar todos os documentos; ações buscam somente as ordens selecionadas. Uma revisão antiga falha explicitamente, em vez de sobrescrever alterações de outro usuário. Seleção é limpa após tentar uma ação; selecione novamente após mudanças realtime. Uma alteração concorrente entre leitura e escrita também é rejeitada por `_rev`.

## CouchDB

Copie `.env.example` para `.env.local` e configure `NEXT_PUBLIC_COUCHDB_URL` com a URL HTTPS pública do banco, **sem credenciais**. Reinicie dev ou refaça build após alterá-la. Sem URL, a aplicação funciona localmente.

Configure sessão CouchDB (`/_session`) e CORS para a origem exata do frontend com credenciais/métodos/headers de replicação, ou um proxy de mesma origem com autenticação. Credenciais não devem estar em variáveis públicas. O exemplo não provisiona CouchDB nem login. Os 5.000 registros demo e suas edições serão replicados para o banco configurado, portanto use um banco de demonstração.

O feed local `db.changes({ since: 'now', live: true, include_docs: true })` recebe gravações locais e replicadas; ele não comprova acesso remoto. Conflitos de replicação entre dispositivos precisam de uma política própria; a UI mostra a revisão vencedora padrão. Sem endpoint fornecido, a sincronização com CouchDB real permanece não validada.

## Verificação

`npm test` usa PouchDB real/LevelDB: 40 ordenações, cursores com empates e exclusão de borda, filtros, feed, carga idempotente de 5.000 ordens, transições de estado, habilitação por seleção/revisão, migração idempotente, fills, validações, conflitos e CSV seguro. O teste de navegador da sessão usa Chromium/IndexedDB para validar seed automático, ações por menu, edição, seleção, paginação, download e persistência. A carga é feita em cada navegador novo, não na memória do servidor Next.js.
