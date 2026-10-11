import type { LocalDB } from './query';
import { mockOrder } from './model';
let promise: Promise<LocalDB> | undefined;
export function getDatabase() {
  if (typeof window === 'undefined') throw new Error('PouchDB só é inicializado no navegador');
  return promise ??= Promise.all([import('pouchdb-browser'), import('pouchdb-find')]).then(([pouch, find]) => {
    const PouchDB = pouch.default;
    PouchDB.plugin(find.default);
    // Novo namespace preserva os dados genéricos da primeira versão.
    return new PouchDB('blotter-orders-v2') as LocalDB;
  }).catch(error => { promise = undefined; throw error; });
}
export function startSync(db: LocalDB, report: (status: string) => void) {
  const remote = process.env.NEXT_PUBLIC_COUCHDB_URL;
  if (!remote) { report('Local — CouchDB não configurado'); return () => {}; }
  // URL pública, sem senha embutida. Use sessão CouchDB e CORS explícito.
  const sync = db.sync(remote, { live: true, retry: true });
  sync.on('active', () => report('Sincronizando'));
  sync.on('paused', (error: unknown) => report(error ? 'Offline — aguardando reconexão' : 'Sincronizado'));
  sync.on('denied', () => report('CouchDB negou acesso a um documento'));
  sync.on('error', () => report('Falha de sincronização — verifique sessão e CORS'));
  return () => sync.cancel();
}
export async function seedDemo(db: LocalDB, count = 5000, progress?: (count: number) => void) {
  // IDs determinísticos tornam a ação repetível, sem sobrescrever documentos existentes.
  // allDocs aqui só verifica IDs em lotes na geração; consultas da tabela usam find.
  for (let offset = 0; offset < count; offset += 250) {
    const batch = Array.from({ length: Math.min(250, count - offset) }, (_, j) => mockOrder(offset + j));
    const existing = await db.allDocs({ keys: batch.map(row => row._id) });
    const missing = batch.filter((_, i) => 'error' in existing.rows[i]);
    const result = await db.bulkDocs(missing);
    if (result.some(item => 'error' in item && item.status !== 409)) throw new Error('Falha ao gravar dados de demonstração');
    progress?.(Math.min(offset + 250, count));
  }
}
