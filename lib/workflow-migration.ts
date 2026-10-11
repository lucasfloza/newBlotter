import { columns, deskForAsset, makeRow, normalize, PENDING_ACCEPTANCE, UNASSIGNED_TRADER, WORKFLOW_VERSION, type Row } from './model';
import type { LocalDB } from './query';

export function upgradeLegacyOrder(row: Row): Row {
  if (row.workflowVersion !== undefined) return row;
  const history = JSON.parse(row.actionHistory ?? '[]') as { action: string }[];
  const values = Object.fromEntries(columns.map(c => [c.id, row[c.id] ?? '']));
  if (values.c05 === 'Nova' && !history.some(item => item.action === 'accept') && Number(values.c08) === 0) {
    values.c05 = PENDING_ACCEPTANCE;
    values.c10 = UNASSIGNED_TRADER;
  } else if (['Aceita', 'Encaminhada'].includes(values.c05)) {
    values.c05 = 'Nova';
    // O trader automático do seed antigo não é uma atribuição feita pelo usuário.
    if (!history.some(item => item.action === 'assign')) values.c10 = UNASSIGNED_TRADER;
  } else if (values.c05 === PENDING_ACCEPTANCE) {
    values.c10 = UNASSIGNED_TRADER;
  }
  return { ...row, ...makeRow(row._id, values), workflowVersion: WORKFLOW_VERSION };
}
async function migrateLegacyWorkflow(db: LocalDB) {
  const markerId = '_local/order-workflow-v2';
  try {
    const marker = await db.get(markerId);
    if (marker.completed === 'true') return;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  let conflicts = 0;
  while (true) {
    // Consultas Mango em lotes só na atualização inicial. Não reinicializa nem
    // apaga o banco e preserva revisões, histórico, edições e ordens finalizadas.
    const { docs } = await db.find({ selector: { kind: 'row', workflowVersion: { $exists: false } }, limit: 250 });
    if (!docs.length) {
      // Metadado local não é replicado. Evita examinar os 5.000 documentos
      // novamente em cada abertura quando a atualização já foi concluída.
      try { await db.put({ _id: markerId, kind: 'row', completed: 'true' }); }
      catch (e) { if ((e as { status?: number }).status !== 409) throw e; }
      return;
    }
    const results = await db.bulkDocs(docs.map(upgradeLegacyOrder));
    const fatal = results.find(result => 'error' in result && result.status !== 409);
    if (fatal) throw new Error('Falha ao atualizar o fluxo das ordens locais');
    if (results.some(result => 'error' in result)) {
      // A próxima consulta lê as revisões novas após um conflito concorrente.
      if (++conflicts > 3) throw new Error('Ordens alteradas durante a atualização. Recarregue para tentar novamente.');
    } else conflicts = 0;
  }
}

const legacyDesks = ['Institucional', 'Varejo', 'Proprietaria'];
export function upgradeLegacyDesk(row: Row): Row {
  if (!legacyDesks.includes(row.c13 ?? '')) return row;
  const desk = deskForAsset(row.c03 ?? '');
  // Esta migração modifica somente a mesa e sua chave de busca. Preserva
  // status, trader, fills, edições, histórico e metadados desconhecidos.
  return { ...row, c13: desk, k13: `${normalize(desk)}\u0000${row._id}` };
}

async function migrateLegacyDesks(db: LocalDB) {
  const markerId = '_local/order-desks-v1';
  try {
    if ((await db.get(markerId)).completed === 'true') return;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  let conflicts = 0;
  while (true) {
    const { docs } = await db.find({
      selector: { kind: 'row', c13: { $in: legacyDesks } }, limit: 250,
    });
    if (!docs.length) {
      try { await db.put({ _id: markerId, kind: 'row', completed: 'true' }); }
      catch (e) { if ((e as { status?: number }).status !== 409) throw e; }
      return;
    }
    const results = await db.bulkDocs(docs.map(upgradeLegacyDesk));
    if (results.some(result => 'error' in result && result.status !== 409)) {
      throw new Error('Falha ao atualizar as mesas das ordens locais');
    }
    if (results.some(result => 'error' in result)) {
      if (++conflicts > 3) throw new Error('Ordens alteradas durante a atualização das mesas. Recarregue para tentar novamente.');
    } else conflicts = 0;
  }
}

export async function migrateOrderWorkflow(db: LocalDB) {
  await migrateLegacyWorkflow(db);
  // Marcador separado: o fluxo v2 pode já ter sido atualizado em uma sessão
  // anterior; isso não deve impedir a migração das mesas antigas.
  await migrateLegacyDesks(db);
}
