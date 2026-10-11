import { Row } from "@/lib/model";

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

export const display = (row: Row, id: string, numeric: boolean) => {
  if (id === "c02" || id === "c18")
    return new Date(row[id]!).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
  return numeric ? numberFormatter.format(Number(row[id])) : row[id] || "—";
};
