"use client";

interface SampleDataTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function SampleDataTable({ columns, rows }: SampleDataTableProps) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No rows returned
      </div>
    );
  }

  return (
    <div className="overflow-auto border rounded-md">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="px-2 py-1.5 text-right text-muted-foreground font-normal border-r w-10">
              #
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="px-3 py-1.5 text-left font-medium whitespace-nowrap border-r last:border-r-0"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t hover:bg-muted/50">
              <td className="px-2 py-1 text-right text-muted-foreground tabular-nums border-r">
                {i + 1}
              </td>
              {columns.map((col) => (
                <CellValue key={col} value={row[col]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <td className="px-3 py-1 border-r last:border-r-0 italic text-muted-foreground/60">
        NULL
      </td>
    );
  }

  const display = typeof value === "object" ? JSON.stringify(value) : String(value);
  const isNumeric = typeof value === "number" || typeof value === "bigint";

  return (
    <td
      className={`px-3 py-1 border-r last:border-r-0 max-w-[300px] truncate ${isNumeric ? "tabular-nums text-right" : ""}`}
      title={display}
    >
      {display}
    </td>
  );
}
