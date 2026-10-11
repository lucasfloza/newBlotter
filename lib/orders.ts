import { columns, makeRow, terminalStatuses, traders, type Row } from './model';
import type { LocalDB } from './query';
export type OrderAction = 'accept' | 'reject' | 'assign' | 'execute' | 'cancel' | 'edit';
export type ActionOptions = { trader?: string; quantity?: number; price?: number; patch?: Record<string, string>; reason?: string };
export type Selection = { id: string; rev: string }[];

function positive(value: string | number | undefined, name: string, integer = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9 || (integer && !Number.isSafeInteger(n))) throw new Error(`${name} inválido`);
  return n;
}
export function applyAction(row: Row, action: OrderAction, options: ActionOptions = {}): Row {
  const values = Object.fromEntries(columns.map(c => [c.id, row[c.id] ?? '']));
  if (terminalStatuses.has(values.c05)) throw new Error('Ordem finalizada não pode ser alterada');
  if (action === 'accept') {
    if (!['Nova', 'Encaminhada'].includes(values.c05)) throw new Error('Somente ordens novas/encaminhadas podem ser aceitas');
    values.c05 = 'Aceita';
  } else if (action === 'reject') {
    if (Number(values.c08) > 0) throw new Error('Ordem com execução deve ser cancelada, não rejeitada');
    if (!options.reason?.trim()) throw new Error('Informe o motivo da rejeição');
    values.c05 = 'Rejeitada'; values.c19 = options.reason.trim();
  } else if (action === 'cancel') {
    values.c05 = 'Cancelada'; // Quantidade já executada é preservada.
    if (options.reason?.trim()) values.c19 = options.reason.trim();
  } else if (action === 'assign') {
    if (!traders.includes(options.trader ?? '') || options.trader === 'Sem trader') throw new Error('Selecione um trader');
    values.c10 = options.trader!;
    if (['Nova', 'Encaminhada'].includes(values.c05)) values.c05 = 'Encaminhada';
  } else if (action === 'execute') {
    if (!['Aceita', 'Parcial'].includes(values.c05)) throw new Error('Aceite a ordem antes de executar');
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
    for (const key of ['c03', 'c04', 'c06', 'c07', 'c10', 'c11', 'c19']) {
      if (options.patch?.[key] !== undefined) values[key] = options.patch[key];
    }
    const executed = Number(values.c08);
    if (executed > 0 && ['c03', 'c04', 'c07'].some(k => values[k] !== row[k])) throw new Error('Ativo, lado e preço estão bloqueados após execução parcial');
    if (!/^[A-Z0-9]{3,12}$/.test(values.c03)) throw new Error('Ativo inválido');
    if (!['Compra', 'Venda'].includes(values.c04)) throw new Error('Lado inválido');
    if (!traders.includes(values.c10)) throw new Error('Trader inválido');
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
