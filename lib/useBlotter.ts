'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase, seedDemo, startSync } from './database';
import { type Filters, type Row, type Sort } from './model';
import { ensureIndexes, fetchPage, type LocalDB } from './query';
import { migrateOrderWorkflow } from './workflow-migration';
type QueryState = { filters: Filters; sort: Sort; revision: number };
type QueryResult = Awaited<ReturnType<typeof fetchPage>>;
const emptyResult = (): QueryResult => ({ rows: [], hasNext: false, nextCursor: null });
export function useBlotter() {
  const dbRef = useRef<LocalDB | null>(null);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Inicializando banco local');
  const [inputs, setInputs] = useState<Filters>({});
  const [query, setQuery] = useState<QueryState>({ filters: {}, sort: { column: 'c02', direction: 'desc' }, revision: 0 });
  const [resolvedQuery, setResolvedQuery] = useState<QueryState | null>(null);
  const [result, setResult] = useState<QueryResult>(emptyResult);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(true);
  const [seedCount, setSeedCount] = useState(0);
  const [queryMs, setQueryMs] = useState(0);
  // Também invalida imediatamente uma consulta em voo quando o feed muda.
  const requestId = useRef(0);
  const initialInputs = useRef(inputs);
  const queryRef = useRef(query);
  const resultRef = useRef(result);
  const loadingMoreRef = useRef<object | null>(null);
  const resolvedRequestId = useRef<number | null>(null);
  // A identidade muda já no render. Uma resposta antiga não pode anexar linhas
  // no intervalo entre mudar filtros/ordenação e executar o efeito seguinte.
  queryRef.current = query;

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
            if (!cancelled) setQuery(q => ({ ...q, revision: q.revision + 1 }));
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
    return () => { cancelled = true; ++requestId.current; loadingMoreRef.current = null; clearTimeout(timer); changes?.cancel(); stopSync(); };
  }, []);

  useEffect(() => {
    if (inputs === initialInputs.current) return;
    const timer = setTimeout(() => {
      setQuery(q => ({ ...q, filters: inputs }));
    }, 250);
    return () => clearTimeout(timer);
  }, [inputs]);

  useEffect(() => {
    if (!ready || !dbRef.current) return;
    const id = ++requestId.current;
    const started = performance.now();
    loadingMoreRef.current = null;
    setLoadingMore(false);
    resultRef.current = emptyResult();
    setResult(resultRef.current);
    setLoading(true); setError('');
    // IndexedDB não fornece AbortSignal aqui; ignoramos respostas antigas.
    void fetchPage(dbRef.current, query.filters, query.sort, null).then(page => {
      if (id === requestId.current && queryRef.current === query) {
        resolvedRequestId.current = id;
        resultRef.current = page;
        setResult(page); setQueryMs(performance.now() - started);
      }
    }).catch(e => {
      if (id === requestId.current && queryRef.current === query) setError(e instanceof Error ? e.message : 'Falha na consulta');
    }).finally(() => {
      if (id === requestId.current && queryRef.current === query) { setResolvedQuery(query); setLoading(false); setSeeding(false); }
    });
    return () => { ++requestId.current; };
  }, [ready, query]);

  const filtersPending = inputs !== query.filters && JSON.stringify(inputs) !== JSON.stringify(query.filters);
  // Marca a navegação como pendente no mesmo render, antes de o efeito iniciar.
  const busy = loading || filtersPending || seeding || (ready && resolvedQuery !== query);
  const loadMore = useCallback(async () => {
    const db = dbRef.current;
    const previous = resultRef.current;
    if (!db || !ready || busy || error || queryRef.current !== query
      || requestId.current !== resolvedRequestId.current
      || !previous.hasNext || !previous.nextCursor || loadingMoreRef.current) return;
    // Trava síncrona: vários eventos de scroll antes do próximo render só abrem
    // uma consulta. Cada chamada busca mais 50 linhas por cursor, sem skip ou
    // leitura de todas as ordens. busy não bloqueia ações nas linhas já exibidas.
    const token = {};
    loadingMoreRef.current = token;
    const id = requestId.current;
    const started = performance.now();
    setLoadingMore(true);
    const isCurrent = () => id === requestId.current && queryRef.current === query
      && loadingMoreRef.current === token;
    try {
      const page = await fetchPage(db, query.filters, query.sort, previous.nextCursor);
      if (!isCurrent()) return;
      const accumulated = { ...page, rows: [...previous.rows, ...page.rows] };
      resultRef.current = accumulated;
      setResult(accumulated);
      setQueryMs(performance.now() - started);
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : 'Falha ao carregar mais ordens');
    } finally {
      // A conclusão de uma consulta obsoleta não libera a trava de outra.
      if (loadingMoreRef.current === token) {
        loadingMoreRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [ready, busy, error, query]);

  const refresh = useCallback(() => {
    ++requestId.current;
    setQuery(q => ({ ...q, revision: q.revision + 1 }));
  }, []);

  // Nem um render reaproveita linhas da consulta anterior com os novos filtros.
  const visibleResult = ready && resolvedQuery !== query ? emptyResult() : result;
  return { dbRef, ready, syncStatus, inputs, setInputs, query, setQuery, result: visibleResult, loadMore, loadingMore, refresh, busy, error, setError, requestId, queryMs, seedCount };
}
