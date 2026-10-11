'use client';
import { useEffect, useRef, useState } from 'react';
import { desks, traders, type Row } from '@/lib/model';
import { type OrderAction, type ActionOptions } from '@/lib/orders';
import { Button, Dialog, Footer, Message, Overlay } from './blotter.styles';
export const actionNames: Record<OrderAction, string> = { accept: 'Aceitar', reject: 'Rejeitar', assign: 'Encaminhar', execute: 'Executar', cancel: 'Cancelar', edit: 'Editar' };
export default function OrderDialog({ action, row, count, onClose, onSubmit }: {
  action: OrderAction; row?: Row; count: number; onClose: () => void; onSubmit: (options: ActionOptions) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus();
    return () => previous?.focus();
  }, []);
  return <Overlay onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <Dialog ref={ref} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={e => {
      if (e.key === 'Escape' && !saving) onClose();
      if (e.key === 'Tab') {
        const elements = Array.from(ref.current!.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled),textarea'));
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <h2 id="dialog-title">{actionNames[action]} {count === 1 ? `ordem ${row?.c01 ?? ''}` : `${count} ordens`}</h2>
      <p>{action === 'execute' ? 'Execução simulada. Valores em branco usam o saldo e o preço limite de cada ordem.' : 'As alterações serão gravadas no PouchDB e replicadas quando a conexão estiver disponível.'}</p>
      {error && <Message $error role="alert">{error}</Message>}
      <form onSubmit={async e => {
        e.preventDefault(); const data = new FormData(e.currentTarget);
        const text = (name: string) => String(data.get(name) ?? '').trim();
        const options: ActionOptions = { reason: text('reason'), trader: text('trader') };
        if (action === 'execute') { if (text('quantity')) options.quantity = Number(text('quantity')); if (text('price')) options.price = Number(text('price')); }
        if (action === 'edit') options.patch = Object.fromEntries(['c03','c04','c06','c07','c11','c13','c19'].filter(k => data.has(k)).map(k => [k, text(k)]));
        setSaving(true); setError('');
        try { await onSubmit(options); }
        catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar'); }
        finally { setSaving(false); }
      }}>
        {action === 'edit' && <>
          <label>Ativo<input name="c03" defaultValue={row?.c03} required pattern="[A-Z0-9]{3,12}" disabled={Number(row?.c08) > 0} /></label>
          <label>Lado<select name="c04" defaultValue={row?.c04} disabled={Number(row?.c08) > 0}><option>Compra</option><option>Venda</option></select></label>
          <label>Quantidade<input name="c06" type="number" min={Number(row?.c08) + 1} max="1000000000" step="1" defaultValue={row?.c06} required /></label>
          <label>Preço limite<input name="c07" type="number" min="0.01" step="0.01" max="1000000000" defaultValue={row?.c07} required disabled={Number(row?.c08) > 0} /></label>
          <label>Cliente<input name="c11" defaultValue={row?.c11} required maxLength={100} /></label>
          <label>Mesa<select name="c13" defaultValue={row?.c13} required>{desks.map(desk => <option key={desk}>{desk}</option>)}</select></label>
          <label>Observações<input name="c19" defaultValue={row?.c19} maxLength={500} /></label>
        </>}
        {action === 'assign' && <label>Trader de destino<select name="trader" required>{traders.filter(t => t !== 'Sem trader').map(t => <option key={t}>{t}</option>)}</select></label>}
        {action === 'execute' && <>
          <label>Quantidade por ordem<input name="quantity" type="number" min="1" step="1" placeholder="Vazio = todo o saldo" /></label>
          <label>Preço de execução<input name="price" type="number" min="0.01" step="0.01" placeholder="Vazio = preço limite" /></label>
        </>}
        {(action === 'reject' || action === 'cancel') && <label>Motivo{action === 'cancel' && ' (opcional)'}<input name="reason" required={action === 'reject'} maxLength={500} /></label>}
        <Footer><Button type="button" disabled={saving} onClick={onClose}>Voltar</Button><Button $primary type="submit" disabled={saving}>{saving ? 'Salvando…' : `Confirmar ${actionNames[action].toLowerCase()}`}</Button></Footer>
      </form>
    </Dialog>
  </Overlay>;
}
