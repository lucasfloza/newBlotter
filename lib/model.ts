const labels = ['Ordem', 'Recebida em', 'Ativo', 'Lado', 'Status', 'Quantidade', 'Preço limite', 'Executado', 'Preço médio', 'Trader', 'Cliente', 'Conta', 'Mesa', 'Mercado', 'Tipo', 'Validade', 'Moeda', 'Atualizada em', 'Observações', 'Financeiro'];
export const columns = Array.from({ length: 20 }, (_, i) => ({
  id: `c${String(i + 1).padStart(2, '0')}`,
  key: `k${String(i + 1).padStart(2, '0')}`,
  label: labels[i], filterable: i < 10, numeric: [5, 6, 7, 8, 19].includes(i),
}));
export type Row = { _id: string; _rev?: string; kind: 'row'; [field: string]: string | undefined };
export type Filters = Record<string, string>;
export type Sort = { column: string; direction: 'asc' | 'desc' };
// Contrato compartilhado com todos os escritores no CouchDB: chaves persistidas
// permitem seek por um único campo, inclusive quando vários valores são iguais.
// Este exemplo usa texto ASCII. Para números/datas, use encoding canônico ordenável.
export function normalize(value: string) { return value.trim().toLowerCase(); }
export function numericKey(value: string) {
  if (!/^\d+(\.\d{1,4})?$/.test(value.trim()) || Number(value) > 1e9) throw new Error('Informe um número de 0 a 1 bilhão, com até 4 decimais.');
  return String(Math.round(Number(value) * 10000)).padStart(16, '0');
}
export function makeRow(id: string, values: Record<string, string>): Row {
  if (!/^row:[\x20-\x7e]+$/.test(id)) throw new Error('Use um ID ASCII único com prefixo row:');
  const row: Row = { _id: id, kind: 'row' };
  for (const column of columns) {
    const value = values[column.id] ?? '';
    if (/[\u0000-\u001f]/.test(value)) throw new Error('Valores não podem conter caracteres de controle.');
    row[column.id] = value;
    const key = column.numeric && /^\d+(\.\d{1,4})?$/.test(value) ? numericKey(value) : normalize(value);
    row[column.key] = `${key}\u0000${id}`;
  }
  return row;
}
export const traders = ['Ana Lima', 'Bruno Costa', 'Carla Alves', 'Diego Santos', 'Sem trader'];
export const terminalStatuses = new Set(['Executada', 'Rejeitada', 'Cancelada']);
export function mockOrder(i: number, id = `row:order:${String(i).padStart(8, '0')}`) {
  const quantity = ((i % 50) + 1) * 100;
  const price = (12 + (i % 800) / 10).toFixed(2);
  const time = new Date(Date.UTC(2026, 9, 8, 12) + i * 1000).toISOString();
  return makeRow(id, {
    c01: `ORD-${String(i + 1).padStart(6, '0')}`, c02: time,
    c03: ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3', 'WEGE3', 'BOVA11', 'BBAS3'][i % 8],
    c04: i % 2 ? 'Venda' : 'Compra', c05: 'Nova', c06: String(quantity), c07: price,
    c08: '0', c09: '0.00', c10: traders[i % 4], c11: `Cliente ${String(i % 200 + 1).padStart(3, '0')}`,
    c12: String(10000 + i % 200), c13: ['Institucional', 'Varejo', 'Proprietaria'][i % 3],
    c14: 'B3', c15: 'Limite', c16: 'DAY', c17: 'BRL', c18: time, c19: '',
    c20: (quantity * Number(price)).toFixed(2),
  });
}
export function mockRow(i: number) {
  return makeRow(`row:${String(i).padStart(8, '0')}`, Object.fromEntries(columns.map((c, j) =>
    [c.id, `grupo-${String((i * (j + 3)) % 100).padStart(3, '0')}`])));
}
