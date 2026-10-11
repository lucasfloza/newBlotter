import { memo, type PointerEvent } from "react";
import { columns, type Row } from "@/lib/model";
import * as S from "./blotter.styles";
import { display } from "@/utils/table-row";

const TableRow = memo(function TableRow({
  row,
  selected,
  disabled,
  onSelect,
  onContext,
  onEdit,
  onDragStart,
  suppressClick,
  rowIndex,
}: {
  row: Row;
  selected: boolean;
  disabled: boolean;
  onSelect: (row: Row, multi: boolean, range: boolean) => void;
  onContext: (row: Row, x: number, y: number) => void;
  onEdit: (row: Row) => void;
  onDragStart: (row: Row, event: PointerEvent<HTMLTableRowElement>) => void;
  suppressClick: () => boolean;
  rowIndex: number;
}) {
  return (
    <S.OrderRow
      $selected={selected}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      aria-rowindex={rowIndex + 2}
      data-order-id={row._id}
      tabIndex={0}
      onPointerDown={(e) => onDragStart(row, e)}
      onClick={(e) => { if (!disabled && !suppressClick()) onSelect(row, e.ctrlKey || e.metaKey, e.shiftKey); }}
      onDoubleClick={() => { if (!disabled) onEdit(row); }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!disabled) onContext(row, e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          onContext(row, rect.left + 40, rect.top);
        } else if (
          e.target === e.currentTarget &&
          (e.key === " " || e.key === "Enter")
        ) {
          e.preventDefault();
          onSelect(row, e.ctrlKey || e.metaKey, e.shiftKey);
        }
      }}
    >
      {columns.map((c, i) => (
        <td key={c.id} title={display(row, c.id, c.numeric)}>
          {i === 0 && (
            <input
              type="checkbox"
              aria-label={`Selecionar ${row.c01}`}
              checked={selected}
              disabled={disabled}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onSelect(row, true, false)}
            />
          )}
          {["c04", "c05"].includes(c.id) ? (
            <S.Badge $value={row[c.id]}>{row[c.id]}</S.Badge>
          ) : (
            display(row, c.id, c.numeric)
          )}
        </td>
      ))}
    </S.OrderRow>
  );
});

export default TableRow;
