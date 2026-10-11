"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { columns, mockOrder, type Row } from "@/lib/model";
import { PAGE_SIZE } from "@/lib/query";
import { useBlotter } from "@/lib/useBlotter";
import {
  exportOrders,
  runOrderAction,
  type OrderAction,
  type ActionOptions,
  type Selection,
} from "@/lib/orders";
import OrderDialog, { actionNames } from "./OrderDialog";
import * as S from "./blotter.styles";
import TableRow from "./TableRow";

export default function DataTable() {
  const {
    dbRef,
    ready,
    syncStatus,
    inputs,
    setInputs,
    query,
    setQuery,
    result,
    busy,
    error: queryError,
    requestId,
    queryMs,
    seedCount,
  } = useBlotter();
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const visibleRef = useRef(result.rows);
  visibleRef.current = result.rows;
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    targets: Selection;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<{
    action: OrderAction;
    targets: Selection;
    row?: Row;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const disabled = !ready || busy || working;
  const pageSelected =
    result.rows.length > 0 && result.rows.every((row) => selected.has(row._id));

  const onSelect = useCallback((row: Row, multi: boolean, range: boolean) => {
    setSelected((previous) => {
      const next = new Map(multi || range ? previous : []);
      if (range && anchor.current) {
        const rows = visibleRef.current;
        const a = rows.findIndex((r) => r._id === anchor.current),
          b = rows.findIndex((r) => r._id === row._id);
        if (a >= 0)
          rows
            .slice(Math.min(a, b), Math.max(a, b) + 1)
            .forEach((r) => next.set(r._id, r._rev!));
        else next.set(row._id, row._rev!);
      } else if (multi && next.has(row._id)) next.delete(row._id);
      else next.set(row._id, row._rev!);
      anchor.current = row._id;
      return next;
    });
  }, []);

  const onContext = useCallback((row: Row, x: number, y: number) => {
    const chosen = selectedRef.current.has(row._id)
      ? Array.from(selectedRef.current, ([id, rev]) => ({ id, rev }))
      : [{ id: row._id, rev: row._rev! }];
    if (!selectedRef.current.has(row._id))
      setSelected(new Map([[row._id, row._rev!]]));
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 248)),
      y: Math.max(8, Math.min(y, window.innerHeight - 350)),
      targets: chosen,
    });
  }, []);

  async function perform(
    action: OrderAction,
    chosen: Selection,
    options: ActionOptions = {},
  ) {
    if (!dbRef.current || !chosen.length) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const outcome = await runOrderAction(
        dbRef.current,
        chosen,
        action,
        options,
      );
      setSelected(new Map());
      setQuery((q) => ({ ...q, cursors: [null], revision: q.revision + 1 }));
      if (!outcome.succeeded && outcome.failures.length)
        throw new Error(outcome.failures.slice(0, 5).join("\n"));
      setNotice(
        `${outcome.succeeded} ordem(ns) alterada(s).${outcome.failures.length ? ` ${outcome.failures.length} falha(s):\n${outcome.failures.slice(0, 5).join("\n")}` : ""}`,
      );
      setDialog(null);
    } finally {
      setWorking(false);
    }
  }

  async function openAction(action: OrderAction, chosen: Selection) {
    setMenu(null);
    if (!chosen.length || working) return;
    try {
      if (action === "accept") {
        await perform(action, chosen);
        return;
      }
      let row: Row | undefined;
      if (chosen.length === 1) {
        row = await dbRef.current!.get(chosen[0].id);
        if (row._rev !== chosen[0].rev)
          throw new Error(
            "A ordem foi alterada. Selecione novamente antes de agir.",
          );
      }
      setDialog({ action, targets: chosen, row });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na ação");
    }
  }

  const onEdit = useCallback((row: Row) => {
    setDialog({
      action: "edit",
      targets: [{ id: row._id, rev: row._rev! }],
      row,
    });
  }, []);

  async function download(chosen: Selection) {
    if (!dbRef.current || !chosen.length) return;
    setMenu(null);
    setWorking(true);
    try {
      const csv = await exportOrders(dbRef.current, chosen);
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `ordens-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `${chosen.length} ordem(ns) exportada(s) em CSV compatível com Excel.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao exportar");
    } finally {
      setWorking(false);
    }
  }

  async function incoming() {
    setWorking(true);
    try {
      const i = Math.floor(Math.random() * 100000);
      const row = mockOrder(i, `row:live:${crypto.randomUUID()}`);
      row.c01 = `SIM-${crypto.randomUUID().slice(0, 8)}`;
      row.c02 = row.c18 = new Date().toISOString();
      const { makeRow } = await import("@/lib/model");
      await dbRef.current!.put(
        makeRow(
          row._id,
          Object.fromEntries(columns.map((c) => [c.id, row[c.id]!])),
        ),
      );
      setNotice("Nova ordem simulada recebida. O feed atualizará a tabela.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao criar ordem");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const dismiss = () => setMenu(null);
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [menu]);

  return (
    <S.Page>
      <S.Header>
        <div>
          <small>TRADING DESK · DEMONSTRAÇÃO</small>
          <h1>Blotter de ordens</h1>
          <p>Offline-first · PouchDB + CouchDB · ações e execuções simuladas</p>
        </div>
        <S.Badge $value="Aceita">{syncStatus}</S.Badge>
      </S.Header>
      <S.Metrics>
        <div>
          <span>Base de demonstração</span>
          <strong>{seedCount.toLocaleString("pt-BR")} / 5.000</strong>
        </div>
        <div>
          <span>Linhas nesta página</span>
          <strong>
            {result.rows.length} / {PAGE_SIZE}
          </strong>
        </div>
        <div>
          <span>Ordens selecionadas</span>
          <strong>{selected.size}</strong>
        </div>
        <div>
          <span>Última consulta local · inclui atualização do índice</span>
          <strong>{queryMs.toFixed(1)} ms</strong>
        </div>
      </S.Metrics>
      <p role="status">
        {ready
          ? "Índices prontos · base local carregada"
          : `Preparando banco e 5.000 ordens… ${seedCount}/5000`}
      </p>
      <S.Toolbar>
        <S.Button $primary disabled={disabled} onClick={incoming}>
          + Simular chegada
        </S.Button>
      </S.Toolbar>
      {notice && <S.Message role="status">{notice}</S.Message>}
      {(error || queryError) && (
        <S.Message $error role="alert">
          {error || queryError}
          {!ready && (
            <S.Button onClick={() => window.location.reload()}>
              Tentar novamente
            </S.Button>
          )}
        </S.Message>
      )}
      <S.Grid aria-busy={busy || working}>
        <table>
          <caption>
            20 colunas · 10 filtros · Ctrl/Cmd para seleção múltipla · Shift
            para intervalo · botão direito para ações · duplo clique para editar
          </caption>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={
                    query.sort.column === c.id
                      ? query.sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    aria-label={`Ordenar ${c.label}`}
                    onClick={() => {
                      ++requestId.current;
                      setQuery((q) => ({
                        ...q,
                        cursors: [null],
                        sort: {
                          column: c.id,
                          direction:
                            q.sort.column === c.id && q.sort.direction === "asc"
                              ? "desc"
                              : "asc",
                        },
                      }));
                    }}
                  >
                    {c.label}
                    <span>
                      {query.sort.column === c.id
                        ? query.sort.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                  {i === 0 && (
                    <label>
                      <input
                        type="checkbox"
                        aria-label="Selecionar página atual"
                        checked={pageSelected}
                        disabled={disabled}
                        onChange={() =>
                          setSelected((previous) => {
                            const next = new Map(previous);
                            result.rows.forEach((r) =>
                              pageSelected
                                ? next.delete(r._id)
                                : next.set(r._id, r._rev!),
                            );
                            return next;
                          })
                        }
                      />
                      Página
                    </label>
                  )}
                  {c.filterable && (
                    <input
                      aria-label={`Filtrar ${c.label}`}
                      type="text"
                      inputMode={c.numeric ? "decimal" : undefined}
                      value={inputs[c.id] ?? ""}
                      placeholder={c.numeric ? "Valor exato" : "Prefixo…"}
                      onChange={(e) => {
                        ++requestId.current;
                        setInputs((f) => ({ ...f, [c.id]: e.target.value }));
                      }}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <TableRow
                key={`${row._id}:${row._rev}`}
                row={row}
                selected={selected.has(row._id)}
                onSelect={onSelect}
                onContext={onContext}
                onEdit={onEdit}
              />
            ))}
            {!result.rows.length && (
              <tr>
                <td colSpan={20}>
                  {busy ? "Carregando…" : "Nenhuma ordem encontrada."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </S.Grid>
      <S.Footer>
        <S.Button
          disabled={disabled || query.cursors.length === 1}
          onClick={() =>
            setQuery((q) => ({ ...q, cursors: q.cursors.slice(0, -1) }))
          }
        >
          Anterior
        </S.Button>
        <span aria-live="polite">
          Página {query.cursors.length}
          {busy && " · Consultando…"}
          {working && " · Gravando…"}
        </span>
        <S.Button
          disabled={disabled || !!queryError || !result.hasNext}
          onClick={() =>
            setQuery((q) => ({
              ...q,
              cursors: [...q.cursors, result.nextCursor],
            }))
          }
        >
          Próxima
        </S.Button>
        <span>
          Seleção persiste entre páginas. Mudanças realtime reiniciam a
          paginação; revisões antigas precisam ser selecionadas novamente.
        </span>
      </S.Footer>
      {menu && (
        <S.Menu
          ref={menuRef}
          role="menu"
          aria-label="Ações das ordens"
          $x={menu.x}
          $y={menu.y}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMenu(null);
              document
                .querySelector<HTMLElement>('tr[aria-selected="true"]')
                ?.focus();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const buttons = Array.from(
                menuRef.current!.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const i = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          <strong>{menu.targets.length} ordem(ns) selecionada(s)</strong>
          {(
            [
              "accept",
              "reject",
              "assign",
              "execute",
              "cancel",
              "edit",
            ] as OrderAction[]
          ).map((action) => (
            <button
              key={action}
              role="menuitem"
              disabled={
                disabled || (action === "edit" && menu.targets.length !== 1)
              }
              onClick={() => void openAction(action, menu.targets)}
            >
              {actionNames[action]}
            </button>
          ))}
          <button
            role="menuitem"
            disabled={disabled}
            onClick={() => void download(menu.targets)}
          >
            Exportar para planilha (CSV)
          </button>
        </S.Menu>
      )}
      {dialog && (
        <OrderDialog
          action={dialog.action}
          row={dialog.row}
          count={dialog.targets.length}
          onClose={() => setDialog(null)}
          onSubmit={(options) =>
            perform(dialog.action, dialog.targets, options)
          }
        />
      )}
    </S.Page>
  );
}
