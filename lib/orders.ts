import { columns, makeRow, terminalStatuses, traders, PENDING_ACCEPTANCE, UNASSIGNED_TRADER, WORKFLOW_VERSION, type Row } from './model';
import type { LocalDB } from './query';
export type OrderAction = 'accept' | 'reject' | 'assign' | 'execute' | 'cancel' | 'edit';
export type ActionOptions = { trader?: string; quantity?: number; price?: number; patch?: Record<string, string>; reason?: string };
export type Selection = { id: string; rev: string }[];

// A mesma política é usada na UI e antes de cada gravação; desabilitar um botão
// não substitui a validação de uma revisão atualizada por outro usuário.
export function canOrderAction(row: Row, action: OrderAction): boolean {
  if (row.kind !== 'row' || terminalStatuses.has(row.c05 ?? '')) return false;
  if (['accept', 'reject', 'edit'].includes(action)) return row.c05 === PENDING_ACCEPTANCE;
  if (action === 'assign') return row.c05 === 'Nova';
  if (action === 'cancel') return ['Nova', 'Parcial'].includes(row.c05 ?? '');
  return action === 'execute' && ['Nova', 'Parcial'].includes(row.c05 ?? '')
    && traders.includes(row.c10 ?? '') && row.c10 !== UNASSIGNED_TRADER
    && Number(row.c06) > Number(row.c08);
}
export function selectionActionAvailability(rows: Row[], selection: Selection): Record<OrderAction, boolean> {
  const byId = new Map(rows.map(row => [row._id, row]));
  const current = selection.length > 0 && selection.every(target => byId.get(target.id)?._rev === target.rev);
  return Object.fromEntries((['accept', 'reject', 'assign', 'execute', 'cancel', 'edit'] as OrderAction[]).map(action => [action,
    current && (action !== 'edit' || selection.length === 1) && selection.every(target => canOrderAction(byId.get(target.id)!, action)),
  ])) as Record<OrderAction, boolean>;
}

function positive(value: string | number | undefined, name: string, integer = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9 || (integer && !Number.isSafeInteger(n))) throw new Error(`${name} inválido`);
  return n;
}
export function applyAction(row: Row, action: OrderAction, options: ActionOptions = {}): Row {
  const values = Object.fromEntries(columns.map(c => [c.id, row[c.id] ?? '']));
  if (terminalStatuses.has(values.c05)) throw new Error('Ordem finalizada não pode ser alterada');
  if (!canOrderAction(row, action)) {
    if (action === 'execute') throw new Error('Execução exige ordem Nova/Parcial com trader atribuído e saldo disponível');
    if (action === 'assign') throw new Error('Somente ordens Nova podem ser encaminhadas');
    if (['accept', 'reject', 'edit'].includes(action)) throw new Error('Aceitar, rejeitar e editar exigem status Pendente aceite');
    throw new Error('Ação indisponível para o status atual');
  }
  if (action === 'accept') {
    values.c05 = 'Nova'; values.c10 = UNASSIGNED_TRADER;
  } else if (action === 'reject') {
    if (!options.reason?.trim()) throw new Error('Informe o motivo da rejeição');
    values.c05 = 'Rejeitada'; values.c19 = options.reason.trim();
  } else if (action === 'cancel') {
    values.c05 = 'Cancelada'; // Quantidade já executada é preservada.
    if (options.reason?.trim()) values.c19 = options.reason.trim();
  } else if (action === 'assign') {
    if (!traders.includes(options.trader ?? '') || options.trader === UNASSIGNED_TRADER) throw new Error('Selecione um trader');
    values.c10 = options.trader!;
  } else if (action === 'execute') {
    const remaining = Number(values.c06) - Number(values.c08);
    const quantity = positive(options.quantity ?? remaining, 'Quantidade', true);
    const price = positive(options.price ?? values.c07, 'Preço');
    if (price < 0.01 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-5) throw new Error('Preço deve ter no máximo duas casas decimais');
    if (quantity > remaining) throw new Error('Quantidade maior que o saldo da ordem');
    if ((values.c04 === 'Compra' && price > Number(values.c07)) || (values.c04 === 'Venda' && price < Number(values.c07))) throw new Error('Preço de execução viola o preço limite');
    const total = Number(values.c08) + quantity;
    values.c09 = ((Number(values.c08) * Number(values.c09) + quantity * price) / total).toFixed(2);
    values.c08 = String(total); values.c05 = total === Number(values.c06) ? 'Executada' : 'Parcial';
  } else {
    // Edição é restrita aos campos de negócio; estado e fills só mudam via ações.
    if (options.patch?.c10 !== undefined && options.patch.c10 !== UNASSIGNED_TRADER) throw new Error('Atribua um trader pela ação Encaminhar após aceitar');
    for (const key of ['c03', 'c04', 'c06', 'c07', 'c11', 'c19']) {
      if (options.patch?.[key] !== undefined) values[key] = options.patch[key];
    }
    const executed = Number(values.c08);
    if (!/^[A-Z0-9]{3,12}$/.test(values.c03)) throw new Error('Ativo inválido');
    if (!['Compra', 'Venda'].includes(values.c04)) throw new Error('Lado inválido');
    values.c10 = UNASSIGNED_TRADER;
    if (!values.c11.trim()) throw new Error('Informe o cliente');
    const quantity = positive(values.c06, 'Quantidade', true);
    if (quantity <= executed) throw new Error('Quantidade deve ser maior que a quantidade já executada');
    values.c06 = String(quantity); // Normaliza inclusive a notação exponencial de inputs numéricos.
    const price = positive(values.c07, 'Preço');
    if (price < 0.01 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-5) throw new Error('Preço deve ter no máximo duas casas decimais');
    values.c07 = price.toFixed(2);
  }
  values.c18 = new Date().toISOString();
  values.c20 = (Number(values.c06) * Number(values.c07)).toFixed(2);
  const updated = makeRow(row._id, values);
  updated._rev = row._rev;
  updated.workflowVersion = WORKFLOW_VERSION;
  // Log limitado por documento, sem consulta extra por linha. Produção deve usar
  // auditoria autoritativa no backend; este histórico é demonstrativo e replicável.
  const history = JSON.parse(row.actionHistory ?? '[]') as { action: string; at: string }[];
  updated.actionHistory = JSON.stringify([...history.slice(-49), { action, at: values.c18 }]);
  return updated;
}
export async function runOrderAction(db: LocalDB, selection: Selection, action: OrderAction, options: ActionOptions = {}) {
  let succeeded = 0;
  const failures: string[] = [];
  // Não há transação em bulkDocs: inspecione cada resultado e informe êxito parcial.
  for (let offset = 0; offset < selection.length; offset += 100) {
    const targets = selection.slice(offset, offset + 100);
    const response = await db.allDocs({ keys: targets.map(s => s.id), include_docs: true });
    const updates: Row[] = [];
    response.rows.forEach((item, i) => {
      try {
        if (!('doc' in item) || !item.doc || item.value.deleted) throw new Error('Ordem removida');
        if (item.doc._rev !== targets[i].rev) throw new Error('Ordem alterada por outro usuário; selecione a revisão atual');
        updates.push(applyAction(item.doc, action, options));
      } catch (e) { failures.push(`${targets[i].id}: ${e instanceof Error ? e.message : 'Falha'}`); }
    });
    for (const item of await db.bulkDocs(updates)) {
      if ('error' in item) failures.push(`${item.id}: ${item.status === 409 ? 'Conflito de revisão' : item.message}`);
      else succeeded++;
    }
  }
  return { succeeded, failures };
}
export async function exportOrders(db: LocalDB, selection: Selection) {
  const response = await db.allDocs({ keys: selection.map(s => s.id), include_docs: true });
  const rows = response.rows.flatMap(r => 'doc' in r && r.doc && !r.value.deleted ? [r.doc] : []);
  if (rows.length !== selection.length) throw new Error('Algumas ordens foram removidas; atualize a seleção');
  // Previne fórmulas ao abrir texto controlado pelo usuário no Excel/LibreOffice.
  const escape = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
  return '\ufeff' + [columns.map(c => escape(c.label)).join(';'), ...rows.map(r => columns.map(c => escape(r[c.id] ?? '')).join(';'))].join('\r\n');
}
