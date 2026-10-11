import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import PouchDB from 'pouchdb';
import find from 'pouchdb-find';
import { desks, mockOrder, PENDING_ACCEPTANCE, UNASSIGNED_TRADER, type Row } from '../lib/model';
import { seedDemo } from '../lib/database';
import { ensureIndexes, fetchPage } from '../lib/query';
import { applyAction, runOrderAction, exportOrders, canOrderAction, selectionActionAvailability } from '../lib/orders';
import { migrateOrderWorkflow } from '../lib/workflow-migration';
PouchDB.plugin(find);
test('pendente editável → Nova imutável → trader → execução parcial/total', () => {
  const original = mockOrder(0);
  assert.equal(original.c05, PENDING_ACCEPTANCE);
  assert.equal(original.c10, UNASSIGNED_TRADER);
  assert.equal(canOrderAction(original, 'edit'), true);
  assert.throws(() => applyAction(original, 'execute'), /trader/);
  assert.throws(() => applyAction(original, 'assign', {trader:'Ana Lima'}), /Nova/);
  assert.throws(() => applyAction(original, 'edit', {patch:{c10:'Ana Lima'}}), /Encaminhar/);
  const edited = applyAction(original, 'edit', {patch:{c06:'1e3'}});
  assert.equal(edited.c06,'1000'); assert.equal(edited.c10,UNASSIGNED_TRADER);
  const newDesk = applyAction(original, 'edit', {patch:{c13:'BMF'}});
  assert.equal(newDesk.c13, 'BMF'); assert.ok(newDesk.k13!.startsWith('bmf\u0000'));
  assert.throws(() => applyAction(original, 'edit', {patch:{c13:'Institucional'}}), /Mesa deve ser BOV ou BMF/);
  const rejected = applyAction(original, 'reject', {reason:'Limite de risco'});
  assert.equal(rejected.c05,'Rejeitada');
  assert.throws(() => applyAction(rejected,'accept'),/finalizada/);
  const accepted = applyAction(original, 'accept');
  assert.equal(accepted.c05,'Nova'); assert.equal(accepted.c10,UNASSIGNED_TRADER);
  for (const action of ['accept','reject','edit'] as const) assert.throws(() => applyAction(accepted,action),/Pendente aceite/);
  assert.throws(() => applyAction(accepted, 'execute'), /trader/);
  assert.throws(() => applyAction(accepted, 'assign',{trader:UNASSIGNED_TRADER}), /Selecione/);
  const assigned = applyAction(accepted, 'assign', {trader:'Ana Lima'});
  assert.equal(assigned.c05,'Nova'); assert.equal(assigned.c10,'Ana Lima');
  assert.equal(canOrderAction(assigned,'execute'),true);
  const partial = applyAction(assigned, 'execute', {quantity:40, price:11});
  assert.equal(partial.c05, 'Parcial'); assert.equal(partial.c08, '40');
  assert.equal(canOrderAction(partial,'assign'),false);
  assert.throws(() => applyAction(partial, 'reject', {reason:'teste'}), /Pendente aceite/);
  assert.throws(() => applyAction(partial, 'edit', {patch:{c03:'VALE3'}}), /Pendente aceite/);
  assert.throws(() => applyAction(partial, 'execute', {quantity:61}), /saldo/);
  assert.throws(() => applyAction(assigned, 'execute', {price:13}), /limite/);
  assert.throws(() => applyAction(assigned, 'execute', {price:0.001}), /duas casas/);
  const executed = applyAction(partial, 'execute', {quantity:60, price:12});
  assert.equal(executed.c05, 'Executada'); assert.equal(executed.c09, '11.60');
  assert.throws(() => applyAction(executed, 'cancel'), /finalizada/);
  const cancelled = applyAction(partial, 'cancel'); assert.equal(cancelled.c08, '40');
  const sell = applyAction(applyAction(mockOrder(1), 'accept'), 'assign', {trader:'Ana Lima'});
  assert.throws(() => applyAction(sell, 'execute', {price:1}), /limite/);
});
test('habilitação de ações usa todas as ordens e revisões selecionadas', () => {
  const pending = {...mockOrder(0),_rev:'1-a'};
  const another = {...mockOrder(1),_rev:'1-b'};
  const nova = {...applyAction(another,'accept'),_rev:'2-b'};
  const assigned = {...applyAction(nova,'assign',{trader:'Ana Lima'}),_rev:'3-b'};
  const target = (r:Row) => ({id:r._id,rev:r._rev!});
  const available = selectionActionAvailability([pending],[target(pending)]);
  assert.deepEqual(available,{accept:true,reject:true,assign:false,execute:false,cancel:false,edit:true});
  const twoPending = selectionActionAvailability([pending,another],[target(pending),target(another)]);
  assert.equal(twoPending.accept,true); assert.equal(twoPending.edit,false);
  const mixed = selectionActionAvailability([pending,nova],[target(pending),target(nova)]);
  assert.ok(Object.values(mixed).every(enabled => !enabled));
  assert.equal(selectionActionAvailability([nova],[target(nova)]).execute,false);
  assert.equal(selectionActionAvailability([assigned],[target(assigned)]).execute,true);
  assert.ok(Object.values(selectionActionAvailability([assigned],[target(nova)])).every(enabled => !enabled));
  assert.ok(Object.values(selectionActionAvailability([],[])).every(enabled => !enabled));
  assert.ok(Object.values(selectionActionAvailability([],[target(pending)])).every(enabled => !enabled));
});
test('5.000 ordens persistidas, seed idempotente, ações em lote, conflito e exportação segura', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orders-test-'));
  const db = new PouchDB<Row>(path.join(dir, 'db'));
  try {
    await ensureIndexes(db);
    await seedDemo(db);
    const ids = Array.from({length:5000}, (_,i) => mockOrder(i)._id);
    const seeded = await db.allDocs({keys: ids, include_docs:true});
    assert.equal(seeded.rows.filter(r => !('error' in r)).length, 5000);
    const seededOrders = seeded.rows.flatMap(r => 'doc' in r && r.doc ? [r.doc] : []);
    assert.deepEqual(new Set(seededOrders.map(row => row.c13)), new Set(desks));
    assert.ok(seededOrders.every(row => row.c05 === PENDING_ACCEPTANCE && row.c10 === UNASSIGNED_TRADER));
    assert.equal(seededOrders.find(row => row.c03 === 'WINV26')?.c13, 'BMF');
    assert.equal(seededOrders.find(row => row.c03 === 'PETR4')?.c13, 'BOV');
    const row = await db.get(ids[0]), another = await db.get(ids[1]);
    const edited = applyAction(row, 'edit', {patch:{c06:'9', c07:'99.00', c19:'=HYPERLINK("evil")'}});
    await db.put(edited);
    const fresh = await db.get(row._id);
    assert.equal(fresh.c20, '891.00');
    const outcome = await runOrderAction(db, [{id:row._id,rev:row._rev!},{id:another._id,rev:another._rev!}], 'accept');
    assert.equal(outcome.succeeded, 1); assert.equal(outcome.failures.length, 1);
    assert.match(outcome.failures[0], /outro usuário/);
    assert.deepEqual(outcome.updated, [{id:another._id,rev:(await db.get(another._id))._rev!}]);
    assert.ok(!outcome.updated.some(target => target.id === row._id));
    await seedDemo(db);
    assert.equal((await db.get(ids[0])).c06, '9');
    assert.equal((await db.get(ids[1])).c05, 'Nova');
    assert.equal((await db.get(ids[1])).c10, UNASSIGNED_TRADER);
    const quantity = await fetchPage(db, {}, {column:'c06',direction:'asc'}, null, 10);
    assert.equal(quantity.rows[0]._id, ids[0]); // 9 < 100, sem ordenação lexical.
    const exact = await fetchPage(db, {c06:'9'}, {column:'c06',direction:'asc'}, null);
    assert.deepEqual(exact.rows.map(r => r._id), [ids[0]]);
    const csv = await exportOrders(db, [{id:row._id,rev:fresh._rev!}]);
    assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
    const accepted = await db.get(ids[1]);
    const forwarded = await runOrderAction(db, [{id:accepted._id,rev:accepted._rev!}], 'assign', {trader:'Ana Lima'});
    assert.equal(forwarded.succeeded,1); assert.equal((await db.get(ids[1])).c10,'Ana Lima');
    assert.deepEqual(forwarded.updated, [{id:accepted._id,rev:(await db.get(accepted._id))._rev!}]);
    const executed = await runOrderAction(db, forwarded.updated, 'execute');
    assert.equal(executed.succeeded,1); assert.equal((await db.get(ids[1])).c05,'Executada');
    assert.deepEqual(executed.updated, [{id:accepted._id,rev:(await db.get(accepted._id))._rev!}]);
    const blocked = await runOrderAction(db, [{id:fresh._id,rev:fresh._rev!}], 'assign', {trader:'Ana Lima'});
    assert.equal(blocked.succeeded,0); assert.equal(blocked.failures.length,1); assert.deepEqual(blocked.updated,[]);
    const rejected = await db.get(ids[2]);
    assert.equal((await runOrderAction(db, [{id:rejected._id,rev:rejected._rev!}], 'reject', {reason:'Limite de risco'})).succeeded,1);
    assert.equal((await db.get(ids[2])).c05,'Rejeitada');
  } finally { await db.destroy(); await rm(dir,{recursive:true,force:true}); }
});

test('migração das mesas é independente do fluxo e preserva ordens e mesas válidas', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'desks-test-'));
  const db = new PouchDB<Row>(path.join(dir, 'db'));
  try {
    await db.put({ _id:'_local/order-workflow-v2', kind:'row', completed:'true' });
    const assigned = applyAction(applyAction(mockOrder(0), 'accept'), 'assign', {trader:'Ana Lima'});
    const partial = applyAction(applyAction(applyAction(mockOrder(8), 'accept'), 'assign', {trader:'Bruno Costa'}), 'execute', {quantity:30});
    const rejected = applyAction(mockOrder(1), 'reject', {reason:'Limite de risco'});
    assigned.c13 = 'Institucional'; partial.c13 = 'Proprietaria'; rejected.c13 = 'Varejo';
    assigned.c19 = 'Edição preservada'; assigned.externalReference = 'oms-42';
    const valid = {...mockOrder(2), c13:'BMF', k13:`bmf\u0000${mockOrder(2)._id}`};
    await db.bulkDocs([assigned, partial, rejected, valid]);
    const before = await Promise.all([assigned, partial, rejected, valid].map(row => db.get(row._id)));
    await migrateOrderWorkflow(db);
    const after = await Promise.all(before.map(row => db.get(row._id)));
    assert.deepEqual(after.map(row => row.c13), ['BOV','BMF','BOV','BMF']);
    for (let i = 0; i < 3; i++) {
      assert.deepEqual({...after[i], _rev:before[i]._rev, c13:before[i].c13, k13:before[i].k13}, before[i]);
      assert.equal(after[i].k13, `${after[i].c13!.toLowerCase()}\u0000${after[i]._id}`);
    }
    assert.deepEqual(after[3], before[3]);
    assert.equal((await db.get('_local/order-desks-v1')).completed, 'true');
    await migrateOrderWorkflow(db);
    assert.deepEqual(await Promise.all(after.map(row => db.get(row._id))), after);
  } finally { await db.destroy(); await rm(dir, {recursive:true, force:true}); }
});

test('migração idempotente preserva edições, atribuições e execuções antigas', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workflow-test-'));
  const db = new PouchDB<Row>(path.join(dir,'db'));
  try {
    const legacy = (i:number, status:string, actions:string[] = []) => {
      const doc=mockOrder(i); delete doc.workflowVersion;
      doc.c05=status; doc.c10='Ana Lima';
      doc.actionHistory=JSON.stringify(actions.map(action => ({action,at:doc.c18})));
      return doc;
    };
    const untouched=legacy(0,'Nova'); untouched.c19='Edicao preservada';
    const accepted=legacy(1,'Aceita',['accept']);
    const assigned=legacy(2,'Encaminhada',['accept','assign']);
    const partial=legacy(3,'Parcial',['accept','execute']); partial.c08='30';
    const rejected=legacy(4,'Rejeitada',['reject']);
    await db.bulkDocs([untouched,accepted,assigned,partial,rejected]);
    await migrateOrderWorkflow(db);
    const migrated=await db.get(untouched._id);
    assert.equal(migrated.c05,PENDING_ACCEPTANCE); assert.equal(migrated.c10,UNASSIGNED_TRADER);
    assert.equal(migrated.c19,'Edicao preservada'); assert.ok(migrated.k05!.startsWith('pendente aceite'));
    const newAccepted=await db.get(accepted._id);
    assert.equal(newAccepted.c05,'Nova'); assert.equal(newAccepted.c10,UNASSIGNED_TRADER);
    const newAssigned=await db.get(assigned._id);
    assert.equal(newAssigned.c05,'Nova'); assert.equal(newAssigned.c10,'Ana Lima');
    assert.equal((await db.get(partial._id)).c08,'30'); assert.equal((await db.get(partial._id)).c05,'Parcial');
    assert.equal((await db.get(rejected._id)).c05,'Rejeitada');
    await migrateOrderWorkflow(db);
    assert.equal((await db.get(untouched._id))._rev,migrated._rev);
  } finally { await db.destroy(); await rm(dir,{recursive:true,force:true}); }
});
