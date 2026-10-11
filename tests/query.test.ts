import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import PouchDB from 'pouchdb';
import find from 'pouchdb-find';
import { columns, mockRow, type Row } from '../lib/model';
import { ensureIndexes, fetchPage } from '../lib/query';
PouchDB.plugin(find);
test('Mango: todas as colunas, direções, cursores exclusivos e filtros combinados', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'blotter-test-'));
  const db = new PouchDB<Row>(path.join(dir, 'db'));
  try {
    const docs = Array.from({ length: 230 }, (_, i) => mockRow(i));
    await db.bulkDocs(docs);
    await ensureIndexes(db);
    await ensureIndexes(db);
    for (const column of columns) {
      for (const direction of ['asc', 'desc'] as const) {
        let after: string | null = null;
        const ids: string[] = [];
        do {
          const page = await fetchPage(db, {}, { column: column.id, direction }, after, 23);
          ids.push(...page.rows.map(r => r._id));
          if (!page.hasNext) break;
          assert.notEqual(page.nextCursor, after);
          after = page.nextCursor;
        } while (true);
        // JS sort só é usado no teste como oráculo, nunca no fluxo da tabela.
        const expected = [...docs].sort((a, b) => a[column.key]! < b[column.key]! ? -1 : 1);
        if (direction === 'desc') expected.reverse();
        assert.deepEqual(ids, expected.map(r => r._id));
        assert.equal(new Set(ids).size, docs.length);
      }
    }
    for (const direction of ['asc', 'desc'] as const) {
      let after: string | null = null;
      const ids: string[] = [];
      do {
        const page = await fetchPage(db, { c01: ' GRUPO-00 ', c02: 'grupo-0' }, { column: 'c01', direction }, after, 3);
        ids.push(...page.rows.map(r => r._id));
        if (!page.hasNext) break;
        after = page.nextCursor;
      } while (true);
      const expected = docs.filter(r => r.c01!.startsWith('grupo-00') && r.c02!.startsWith('grupo-0')).sort((a,b) => a.k01! < b.k01! ? -1 : 1);
      if (direction === 'desc') expected.reverse();
      assert.deepEqual(ids, expected.map(r => r._id));
    }
    const feed = db.changes({ since: 'now', live: true, include_docs: true });
    const change = new Promise<PouchDB.Core.ChangesResponseChange<Row>>((resolve, reject) => { feed.on('change', resolve); feed.on('error', reject); });
    await db.put(mockRow(999));
    assert.equal((await change).doc?._id, 'row:00000999');
    feed.cancel();
    const inserted = await fetchPage(db, { c01: 'grupo-097' }, { column: 'c01', direction: 'asc' }, null);
    assert.ok(inserted.rows.some(r => r._id === 'row:00000999'));
    // Cursor removido entre páginas não deve descartar a primeira linha válida.
    const first = await fetchPage(db, {}, { column: 'c01', direction: 'asc' }, null, 7);
    const boundary = await db.get(first.rows.at(-1)!._id);
    await db.remove(boundary);
    const second = await fetchPage(db, {}, { column: 'c01', direction: 'asc' }, first.nextCursor, 7);
    assert.equal(second.rows.length, 7);
    assert.ok(second.rows.every(r => r.k01! > first.nextCursor!));
    // Filtros residuais em colunas diferentes da ordenação também ficam no Mango.
    const combined = await fetchPage(db, { c01: 'grupo-00', c02: 'grupo-00' }, { column: 'c20', direction: 'desc' }, null, 50);
    const expectedCombined = docs.filter(r => r._id !== boundary._id && r.c01!.startsWith('grupo-00') && r.c02!.startsWith('grupo-00')).sort((a,b) => a.k20! > b.k20! ? -1 : 1);
    assert.deepEqual(combined.rows.map(r => r._id), expectedCombined.map(r => r._id));
  } finally { await db.destroy(); await rm(dir, { recursive: true, force: true }); }
});
