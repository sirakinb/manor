import { useLingui } from "@lingui/react/macro";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Spreadsheet-feel grid: full gridlines, a single active cell, inline editing
 * in place, in-cell selects, and arrow/Tab/Enter keyboard travel. Headless
 * about data — contacts and custom modules both render through it.
 */

export type SheetColumn<Row> = {
  id: string;
  label: string;
  width?: number;
  editable?: boolean;
  /// Present → editing shows an in-cell select with these choices.
  options?: string[];
  getValue: (row: Row) => string;
  render?: (row: Row) => ReactNode;
};

type CellRef = { r: number; c: number };

export function SheetGrid<Row extends { id: string }>({
  columns,
  rows,
  onCommit,
  onOpenRow,
  quickAddPlaceholder,
  onQuickAdd,
}: {
  columns: SheetColumn<Row>[];
  rows: Row[];
  onCommit?: (row: Row, column: SheetColumn<Row>, value: string) => Promise<void>;
  onOpenRow?: (row: Row) => void;
  quickAddPlaceholder?: string;
  onQuickAdd?: (value: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<CellRef | null>(null);
  const [editing, setEditing] = useState<(CellRef & { seed: string }) | null>(null);
  const [failedCell, setFailedCell] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState("");
  const [busyQuickAdd, setBusyQuickAdd] = useState(false);

  const clamp = useCallback(
    (cell: CellRef): CellRef => ({
      r: Math.max(0, Math.min(rows.length - 1, cell.r)),
      c: Math.max(0, Math.min(columns.length - 1, cell.c)),
    }),
    [rows.length, columns.length],
  );

  useEffect(() => {
    if (active && rows.length && (active.r >= rows.length || active.c >= columns.length)) {
      setActive(clamp(active));
    }
    if (!rows.length && active) setActive(null);
  }, [active, rows.length, columns.length, clamp]);

  const commit = useCallback(
    async (cell: CellRef, value: string) => {
      const row = rows[cell.r];
      const column = columns[cell.c];
      if (!row || !column || !onCommit) return;
      if (value === column.getValue(row)) return;
      try {
        await onCommit(row, column, value);
      } catch {
        const key = `${row.id}:${column.id}`;
        setFailedCell(key);
        setTimeout(() => setFailedCell((current) => (current === key ? null : current)), 2500);
      }
    },
    [rows, columns, onCommit],
  );

  const startEdit = useCallback(
    (cell: CellRef, seed?: string) => {
      const column = columns[cell.c];
      const row = rows[cell.r];
      if (!column?.editable || !row) return;
      setEditing({ ...cell, seed: seed ?? column.getValue(row) });
    },
    [columns, rows],
  );

  const stopEdit = useCallback((next?: CellRef) => {
    setEditing(null);
    if (next) setActive(next);
    containerRef.current?.focus();
  }, []);

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editing || !active) return;
    const move = (dr: number, dc: number) => {
      event.preventDefault();
      setActive(clamp({ r: active.r + dr, c: active.c + dc }));
    };
    if (event.key === "ArrowDown") return move(1, 0);
    if (event.key === "ArrowUp") return move(-1, 0);
    if (event.key === "ArrowLeft") return move(0, -1);
    if (event.key === "ArrowRight") return move(0, 1);
    if (event.key === "Tab") return move(0, event.shiftKey ? -1 : 1);
    if (event.key === "Enter") {
      event.preventDefault();
      startEdit(active);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      const row = rows[active.r];
      const column = columns[active.c];
      if (row && column) void navigator.clipboard?.writeText(column.getValue(row));
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      startEdit(active, event.key);
    }
  }

  async function submitQuickAdd() {
    const value = quickAdd.trim();
    if (!value || !onQuickAdd || busyQuickAdd) return;
    setBusyQuickAdd(true);
    try {
      await onQuickAdd(value);
      setQuickAdd("");
    } finally {
      setBusyQuickAdd(false);
    }
  }

  return (
    <div className="overflow-auto rounded-xl border border-[#1C1C1F]">
      {/** biome-ignore lint/a11y/useSemanticElements: the focusable wrapper owns keyboard travel; the semantic table is inside */}
      <div
        ref={containerRef}
        tabIndex={0}
        role="grid"
        aria-rowcount={rows.length}
        className="min-w-full outline-none"
        onKeyDown={onGridKeyDown}
      >
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={{ width: column.width ?? 160 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className="sticky top-0 z-10 border-b border-r border-[#1C1C1F] bg-[#111113] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5F5B69] last:border-r-0"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id} className="group">
                {columns.map((column, c) => {
                  const isActive = active?.r === r && active?.c === c;
                  const isEditing = editing?.r === r && editing?.c === c;
                  const failed = failedCell === `${row.id}:${column.id}`;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard travel is handled at the grid level
                    <td
                      key={column.id}
                      onClick={() => {
                        setActive({ r, c });
                        if (isActive) startEdit({ r, c });
                        else setEditing(null);
                        containerRef.current?.focus();
                      }}
                      onDoubleClick={() => startEdit({ r, c })}
                      className={`relative h-[33px] border-b border-r border-[#161618] px-2.5 text-[12.5px] text-[#C9C9CE] last:border-r-0 ${
                        failed
                          ? "shadow-[inset_0_0_0_1.5px_#F87171]"
                          : isActive
                            ? "shadow-[inset_0_0_0_1.5px_var(--rk-accent)]"
                            : ""
                      } ${column.editable ? "cursor-text" : "cursor-default"}`}
                    >
                      {isEditing ? (
                        <CellEditor
                          column={column}
                          seed={editing.seed}
                          onCommit={(value, direction) => {
                            void commit({ r, c }, value);
                            stopEdit(
                              direction === "down"
                                ? clamp({ r: r + 1, c })
                                : direction === "right"
                                  ? clamp({ r, c: c + 1 })
                                  : { r, c },
                            );
                          }}
                          onCancel={() => stopEdit({ r, c })}
                        />
                      ) : (
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {c === 0 && onOpenRow ? (
                            <button
                              type="button"
                              aria-label={t`Open row`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenRow(row);
                              }}
                              className="hidden shrink-0 rounded px-0.5 text-[11px] text-[#5F5B69] hover:text-[#ECECEE] group-hover:inline"
                            >
                              ⤢
                            </button>
                          ) : null}
                          <span className="truncate">
                            {column.render ? column.render(row) : column.getValue(row) || ""}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {onQuickAdd ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-[33px] border-b border-[#161618] px-2.5 last:border-b-0"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] text-[#5F5B69]">+</span>
                    <input
                      value={quickAdd}
                      disabled={busyQuickAdd}
                      onChange={(event) => setQuickAdd(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void submitQuickAdd();
                      }}
                      onBlur={() => void submitQuickAdd()}
                      placeholder={quickAddPlaceholder}
                      className="w-full bg-transparent text-[12.5px] text-[#ECECEE] outline-none placeholder:text-[#5F5B69]"
                    />
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellEditor<Row>({
  column,
  seed,
  onCommit,
  onCancel,
}: {
  column: SheetColumn<Row>;
  seed: string;
  onCommit: (value: string, direction: "down" | "right" | "stay") => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(seed);
  if (column.options) {
    return (
      <select
        // biome-ignore lint/a11y/noAutofocus: the user just asked to edit this cell
        autoFocus
        value={value}
        onChange={(event) => onCommit(event.target.value, "stay")}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        className="absolute inset-0 w-full border-0 bg-[#131315] px-2 text-[12.5px] text-[#ECECEE] outline-none"
      >
        {!column.options.includes(value) ? <option value={value}>{value || "—"}</option> : null}
        {column.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the user just asked to edit this cell
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => {
        if (seed.length <= 1) event.target.setSelectionRange(seed.length, seed.length);
        else event.target.select();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value, "down");
        else if (event.key === "Tab") {
          event.preventDefault();
          onCommit(value, "right");
        } else if (event.key === "Escape") onCancel();
        event.stopPropagation();
      }}
      onBlur={() => onCommit(value, "stay")}
      className="absolute inset-0 w-full bg-[#131315] px-2.5 text-[12.5px] text-[#ECECEE] outline-none ring-0"
    />
  );
}
