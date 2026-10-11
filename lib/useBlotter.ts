'use client';
import { useEffect, useRef, useState } from 'react';
import { getDatabase, seedDemo, startSync } from './database';
import { type Filters, type Row, type Sort } from './model';
import { ensureIndexes, fetchPage, type LocalDB } from './query';
import { migrateOrderWorkflow } from './workflow-migration';
type QueryState = { filters: Filters; sort: Sort; cursors: (string | null)[]; revision: number };
export function useBlotter() {
  const dbRef = useRef<LocalDB | null>(null);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Inicializando banco local');
  const [inputs, setInputs] = useState<Filters>({});
  const [query, setQuery] = useState<QueryState>({ filters: {}, sort: { column: 'c02', direction: 'desc' }, cursors: [null], revision: 0 });
  const [resolvedQuery, setResolvedQuery] = useState<QueryState | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof fetchPage>>>({ rows: [], hasNext: false, nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(true);
  const [seedCount, setSeedCount] = useState(0);
  const [queryMs, setQueryMs] = useState(0);
  // Também invalida imediatamente uma consulta em voo quando o feed muda.
  const requestId = useRef(0);
  const initialInputs = useRef(inputs);

  useEffect(() => {
    let cancelled = false;
    let stopSync = () => {};
    let changes: PouchDB.Core.Changes<Row> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const db = await getDatabase();
        if (cancelled) return;
        dbRef.current = db;
        changes = db.changes({ since: 'now', live: true, include_docs: true });
        changes.on('change', change => {
          if (!change.id.startsWith('row:') && change.doc?.kind !== 'row') return;
          ++requestId.current;
          // Coalesce bursts de replicação. Reset evita usar um cursor deslocado por
          // inserção/remoção/alteração da chave de ordenação; sem cache de todas as linhas.
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (!cancelled) setQuery(q => ({ ...q, cursors: [null], revision: q.revision + 1 }));
          }, 120);
        });
        changes.on('error', () => { if (!cancelled) setError('Falha no feed local de alterações'); });
        await ensureIndexes(db);
        if (cancelled) return;
        await migrateOrderWorkflow(db);
        if (cancelled) return;
        setSeeding(true);
        await seedDemo(db, 5000, count => { if (!cancelled) setSeedCount(count); });
        if (cancelled) return;
        setSeeding(false);
        stopSync = startSync(db, status => { if (!cancelled) setSyncStatus(status); });
        setReady(true);
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Falha ao iniciar banco'); setLoading(false); setSeeding(false); }
      }
    })();
    return () => { cancelled = true; ++requestId.current; clearTimeout(timer); changes?.cancel(); stopSync(); };
  }, []);

  useEffect(() => {
    if (inputs === initialInputs.current) return;
    const timer = setTimeout(() => {
      setQuery(q => ({ ...q, filters: inputs, cursors: [null] }));
    }, 250);
    return () => clearTimeout(timer);
  }, [inputs]);

  useEffect(() => {
    if (!ready || !dbRef.current) return;
    const id = ++requestId.current;
    const started = performance.now();
    setLoading(true); setError('');
    // IndexedDB não fornece AbortSignal aqui; ignoramos respostas antigas.
    void fetchPage(dbRef.current, query.filters, query.sort, query.cursors.at(-1)!).then(page => {
      if (id === requestId.current) { setResult(page); setQueryMs(performance.now() - started); }
    }).catch(e => {
      if (id === requestId.current) setError(e instanceof Error ? e.message : 'Falha na consulta');
    }).finally(() => {
      if (id === requestId.current) { setResolvedQuery(query); setLoading(false); setSeeding(false); }
    });
    return () => { ++requestId.current; };
  }, [ready, query]);

  const filtersPending = inputs !== query.filters && JSON.stringify(inputs) !== JSON.stringify(query.filters);
  // Marca a navegação como pendente no mesmo render, antes de o efeito iniciar.
  const busy = loading || filtersPending || seeding || (ready && resolvedQuery !== query);
  return { dbRef, ready, syncStatus, inputs, setInputs, query, setQuery, result, busy, error, setError, requestId, queryMs, seedCount };
}
