import { memo } from "react";
import { columns, type Row } from "@/lib/model";
import * as S from "./blotter.styles";
import { display } from "@/utils/table-row";

const TableRow = memo(function TableRow({
  row,
  selected,
  onSelect,
  onContext,
  onEdit,
}: {
  row: Row;
  selected: boolean;
  onSelect: (row: Row, multi: boolean, range: boolean) => void;
  onContext: (row: Row, x: number, y: number) => void;
  onEdit: (row: Row) => void;
}) {
  return (
    <S.OrderRow
      $selected={selected}
      aria-selected={selected}
      tabIndex={0}
      onClick={(e) => onSelect(row, e.ctrlKey || e.metaKey, e.shiftKey)}
      onDoubleClick={() => onEdit(row)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(row, e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
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
        <td key={c.id}>
          {i === 0 && (
            <input
              type="checkbox"
              aria-label={`Selecionar ${row.c01}`}
              checked={selected}
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
