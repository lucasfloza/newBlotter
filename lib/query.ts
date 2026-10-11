import { columns, normalize, numericKey, type Row, type Filters, type Sort } from './model';
export type LocalDB = PouchDB.Database<Row>;
export const PAGE_SIZE = 50;
const indexName = (key: string) => `rows-by-${key}`;
export async function ensureIndexes(db: LocalDB) {
  // Índices persistem em IndexedDB; createIndex é idempotente. Criação sequencial
  // evita 20 builds concorrentes disputando CPU/IO na primeira montagem.
  const existing = (await db.getIndexes()).indexes;
  for (const column of columns) {
    const fields = ['kind', column.key];
    // createIndex também pode atualizar um índice já existente. Não reconstruir
    // as 20 árvores ao recarregar: valide a definição e reutilize as persistidas.
    if (existing.some(index => index.name === indexName(column.key)
      && index.ddoc === `_design/${indexName(column.key)}`
      && JSON.stringify(index.def.fields.map(field => Object.keys(field)[0])) === JSON.stringify(fields))) continue;
    await db.createIndex({ index: {
      fields, ddoc: indexName(column.key), name: indexName(column.key),
    } });
  }
}
export function buildQuery(filters: Filters, sort: Sort, after: string | null, size = PAGE_SIZE) {
  const column = columns.find(c => c.id === sort.column);
  if (!column) throw new Error('Coluna de ordenação inválida');
  const selector: Record<string, unknown> = { kind: { $eq: 'row' } };
  for (const c of columns.filter(c => c.filterable)) {
    const prefix = normalize(filters[c.id] ?? '');
    if (!prefix) continue;
    if (!/^[\x20-\x7e]*$/.test(prefix)) throw new Error('Os filtros deste exemplo aceitam texto ASCII.');
    // Busca por prefixo é uma faixa B-tree, sem regex/filtragem no React.
    const lower = c.numeric ? `${numericKey(prefix)}\u0000` : prefix;
    selector[c.key] = { $gte: lower, $lt: `${lower}\uffff` };
  }
  const range = (selector[column.key] ?? { $gte: '' }) as Record<string, string>;
  if (after !== null) {
    if (sort.direction === 'asc') {
      range.$gte = after;
    } else {
      delete range.$lt;
      range.$lte = after;
    }
  }
  selector[column.key] = range;
  return {
    selector,
    sort: [{ kind: sort.direction }, { [column.key]: sort.direction }],
    use_index: [indexName(column.key), indexName(column.key)],
    // PouchDB 9 aplica exclusão de $gt/$lt depois do limit em alguns planos.
    // Seek inclusivo + uma posição extra evita concluir falsamente que acabou.
    limit: size + (after === null ? 1 : 2),
  } as PouchDB.Find.FindRequest<Row>;
}
export async function fetchPage(db: LocalDB, filters: Filters, sort: Sort, after: string | null, size = PAGE_SIZE) {
  // Sem skip crescente e sem allDocs para filtrar: o cursor abre uma faixa
  // na chave única. Removemos somente a borda repetida, nunca filtramos o dataset.
  const result = await db.find(buildQuery(filters, sort, after, size));
  const key = columns.find(c => c.id === sort.column)!.key;
  const candidates = after !== null && result.docs[0]?.[key] === after ? result.docs.slice(1) : result.docs;
  const rows = candidates.slice(0, size);
  return { rows, hasNext: candidates.length > size, nextCursor: rows.at(-1)?.[key] ?? null };
}
