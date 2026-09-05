import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspacePipeStatus } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { LoadingState } from "../../components/beautiful-ui/primitives";
import { accentColor } from "../../lib/brand";
import { formatMoney, formatMoneyShort, withAlpha } from "../crm/theme";

/* Small shared pieces for the Workspace place: section keys, number and time
   formatting, KPI tiles, status pills, a hand-rolled line chart, a plain
   table, and the panel header every section shares. */

export const SECTION_KEYS = [
  "voice",
  "reports",
  "email",
  "social",
  "leasing",
  "utilities",
  "team",
  "skills",
  "system",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(value: string | null): value is SectionKey {
  return value !== null && (SECTION_KEYS as readonly string[]).includes(value);
}

/** Affordance for anything that navigates or expands: pointer, accent glow, focus ring. */
export const CLICKABLE =
  "cursor-pointer transition-[box-shadow,background-color] duration-150 hover:bg-[#17171A] hover:ring-1 hover:ring-[color-mix(in_srgb,var(--rk-accent)_40%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rk-accent)]";
export const CLICKABLE_ROW =
  "cursor-pointer transition-colors hover:bg-[#17171A] hover:shadow-[inset_2px_0_0_var(--rk-accent)] focus:bg-[#17171A] focus:shadow-[inset_2px_0_0_var(--rk-accent)] focus:outline-none";
export const CLICKABLE_TEXT =
  "cursor-pointer rounded transition-colors hover:text-[#ECECEE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rk-accent)]";

export const PIPE_COLORS: Record<WorkspacePipeStatus, string> = {
  flowing: accentColor,
  overdue: "#E8A33C",
  failing: "#F87171",
  idle: "#3A3A40",
};

export { formatMoney, withAlpha };

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Bare days (YYYY-MM-DD) parse as UTC midnight, so they are printed in UTC to
 * keep the calendar date; full timestamps print in the viewer's zone.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(DAY_ONLY.test(iso) ? { timeZone: "UTC" } : {}),
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "2h ago", "3d ago": a coarse, locale-aware relative time for freshness. */
export function formatAgo(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((Date.now() - then) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "narrow" });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 60) return rtf.format(-days, "day");
  return rtf.format(-Math.round(days / 30), "month");
}

export function useFormatAgeHours(): (ageHours: number | null) => string {
  const { t } = useLingui();
  return (ageHours) => {
    if (ageHours === null) return "—";
    if (ageHours < 1) {
      const minutes = Math.round(ageHours * 60);
      return t`${minutes}m`;
    }
    if (ageHours < 48) {
      const hours = Math.round(ageHours);
      return t`${hours}h`;
    }
    const days = Math.round(ageHours / 24);
    return t`${days}d`;
  };
}

/** Loads one section's data; a new `key` restarts the load. */
export function useSectionData<T>(
  load: () => Promise<T>,
  key: string,
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({
    key: "",
    data: null,
    error: null,
  });
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ key, data, error: null });
      },
      (cause: unknown) => {
        if (!cancelled)
          setState({
            key,
            data: null,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, epoch]);
  const fresh = state.key === key;
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    loading: !fresh,
    reload: () => setEpoch((value) => value + 1),
  };
}

export function Loading() {
  const { t } = useLingui();
  return (
    <div className="px-1 py-8 text-[#ECECEE]">
      <LoadingState label={t`Loading`} />
    </div>
  );
}

export function ErrorLine({ message }: { message: string }) {
  return <p className="py-4 text-[13px] text-[#E8A33C]">{message}</p>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-[#2A2A2E] px-4 py-8 text-center text-[13px] text-[#6E6975]">
      {children}
    </p>
  );
}

/** Up/down chip for a percentage change, like the originals' "↓ 71%". */
export function DeltaChip({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  const color = up ? "#4ADE80" : "#F87171";
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
      style={{ backgroundColor: withAlpha(color, 0.14), color }}
    >
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      {Math.abs(Math.round(value))}%
    </span>
  );
}

export function KpiTile({
  label,
  value,
  caption,
  delta,
  children,
}: {
  label: string;
  value: string;
  /** One short line under the value: "7/day avg", "62% of calls". */
  caption?: React.ReactNode;
  delta?: number | null;
  /** Optional trailing visual, e.g. a sparkline. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-stretch justify-between gap-3 rounded-xl border border-[#202023] bg-[#131315] p-4">
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#6E6975]">
          {label}
        </p>
        <p className="mt-2 flex items-baseline gap-2 text-[24px] font-semibold tracking-tight text-[#ECECEE] tabular-nums">
          {value}
          <DeltaChip value={delta} />
        </p>
        {caption ? (
          <p className="mt-0.5 text-[12px] text-[#85858A] tabular-nums">{caption}</p>
        ) : null}
      </div>
      {children ? <div className="flex w-[96px] shrink-0 items-end">{children}</div> : null}
    </div>
  );
}

/** "6 flowing" style count pill; `tone` lights up only when the count is non-zero. */
export function CountPill({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: PillTone;
}) {
  const color = count > 0 ? PILL_COLORS[tone] : "#6E6975";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums"
      style={{ backgroundColor: withAlpha(color, count > 0 ? 0.14 : 0.08), color }}
    >
      <span className="font-semibold">{formatNumber(count)}</span>
      {label}
    </span>
  );
}

export type PillTone = "good" | "warn" | "bad" | "dim" | "accent";

const PILL_COLORS: Record<PillTone, string> = {
  good: "#4ADE80",
  warn: "#E8A33C",
  bad: "#F87171",
  dim: "#85858A",
  accent: accentColor,
};

export function StatusPill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  const color = PILL_COLORS[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: withAlpha(color, 0.14), color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

export function pipeTone(status: WorkspacePipeStatus): PillTone {
  return status === "flowing"
    ? "accent"
    : status === "overdue"
      ? "warn"
      : status === "failing"
        ? "bad"
        : "dim";
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 items-center gap-0.5 rounded-full border border-[#202023] bg-[#131315] p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={`cursor-pointer rounded-full px-3 py-1 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rk-accent)] ${
            value === option.key
              ? "bg-[#232326] text-[#ECECEE]"
              : "text-[#85858A] hover:text-[#C9C9CE]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#202023] bg-[#131315] p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-[#ECECEE]">{title}</h3>
      {children}
    </div>
  );
}

/** A hand-rolled line/area chart; every series shares one y scale. */
export function LineChart({
  series,
  labels,
  height = 150,
  formatValue = formatNumber,
}: {
  series: Array<{ name: string; values: Array<number | null>; color?: string; area?: boolean }>;
  labels: string[];
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const width = 600;
  const padX = 8;
  const padTop = 10;
  const padBottom = 22;
  const count = Math.max(labels.length, ...series.map((entry) => entry.values.length));
  const all = series.flatMap((entry) => entry.values.filter((v): v is number => v !== null));
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const x = (index: number) =>
    count <= 1 ? width / 2 : padX + (index / (count - 1)) * (width - padX * 2);
  const y = (value: number) =>
    padTop + (1 - (value - min) / (max - min || 1)) * (height - padTop - padBottom);
  const baseline = y(min);

  if (count === 0 || all.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6E6975]">
        <Trans>Nothing to chart yet</Trans>
      </p>
    );
  }

  const paths = series.map((entry, index) => {
    const color = entry.color ?? accentColor;
    const points: Array<[number, number]> = [];
    entry.values.forEach((value, i) => {
      if (value !== null) points.push([x(i), y(value)]);
    });
    const line = points
      .map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`)
      .join(" ");
    const first = points[0];
    const last = points[points.length - 1];
    const area =
      entry.area && first && last
        ? `${line} L ${last[0].toFixed(1)} ${baseline.toFixed(1)} L ${first[0].toFixed(1)} ${baseline.toFixed(1)} Z`
        : null;
    return { key: `${entry.name}-${index}`, color, line, area, lastPoint: last };
  });

  const ticks =
    labels.length > 1 ? [0, Math.floor((labels.length - 1) / 2), labels.length - 1] : [0];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={series.map((entry) => entry.name).join(", ")}
      >
        <line x1={padX} x2={width - padX} y1={baseline} y2={baseline} stroke="#26262A" />
        <text x={padX} y={padTop + 4} fontSize="10" fill="#6E6975">
          {formatValue(max)}
        </text>
        {paths.map((path) => (
          <g key={path.key}>
            {path.area ? <path d={path.area} fill={withAlpha(path.color, 0.14)} /> : null}
            <path
              d={path.line}
              fill="none"
              stroke={path.color}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {path.lastPoint ? (
              <circle cx={path.lastPoint[0]} cy={path.lastPoint[1]} r="2.5" fill={path.color} />
            ) : null}
          </g>
        ))}
        {ticks.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={height - 6}
            fontSize="10"
            fill="#6E6975"
            textAnchor={index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle"}
          >
            {labels[index]}
          </text>
        ))}
      </svg>
      {series.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {series.map((entry, index) => (
            <span
              key={`${entry.name}-${index}`}
              className="flex items-center gap-1.5 text-[12px] text-[#85858A]"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: entry.color ?? accentColor }}
              />
              {entry.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal bars, one per row, scaled to the largest value. */
export function BarRows({
  rows,
  color = accentColor,
  formatValue = formatNumber,
}: {
  rows: Array<{ label: string; value: number }>;
  color?: string;
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-[#6E6975]">
        <Trans>Nothing to chart yet</Trans>
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className="truncate font-medium text-[#C9C9CE]">{row.label}</span>
            <span className="text-[#6E6975] tabular-nums">{formatValue(row.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1C1C1F]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%`,
                backgroundColor: color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
  /** Dates and times never wrap onto several lines. */
  nowrap?: boolean;
};

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyLabel,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyLabel: string;
}) {
  if (rows.length === 0) return <Empty>{emptyLabel}</Empty>;
  return (
    <div className="rk-scroll overflow-x-auto rounded-xl border border-[#202023]">
      <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-[#131315] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6E6975]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{ width: column.width }}
                className={`px-3 py-2 font-semibold ${column.align === "right" ? "text-right" : "text-left"}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter") onRowClick(row);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={`border-t border-[#1C1C1F] text-[#C9C9CE] ${
                onRowClick ? CLICKABLE_ROW : ""
              }`}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-2 align-top ${column.align === "right" ? "text-right tabular-nums" : "text-left"}${
                    column.nowrap ? " whitespace-nowrap" : ""
                  }`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LONG_TEXT = 48;
const PROSE_FIRST = ["narrative", "summary", "synthesis", "executive_assessment"];

/** Renders unknown JSON as a readable key/value tree; never a raw dump. */
export function KeyValueTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-[#6E6975]">—</span>;
  if (typeof value !== "object") return <Scalar value={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[#6E6975]">—</span>;
    if (value.every(isScalar)) {
      const long = value.some((item) => typeof item === "string" && item.length > LONG_TEXT);
      if (!long) {
        return (
          <span className="text-[#C9C9CE]">
            {value.map((item, index) => (
              <span key={index}>
                {index > 0 ? ", " : ""}
                <Scalar value={item} />
              </span>
            ))}
          </span>
        );
      }
      return (
        <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-[#C9C9CE]">
          {value.map((item, index) => (
            <li key={index}>
              <Scalar value={item} />
            </li>
          ))}
        </ul>
      );
    }
    // A list of flat records reads best as a small table, unless it carries prose.
    if (value.every((item) => isRecord(item) && Object.values(item).every(isScalar))) {
      const records = value as Array<Record<string, unknown>>;
      const prose = records.some((item) =>
        Object.values(item).some((entry) => typeof entry === "string" && entry.length > LONG_TEXT),
      );
      if (!prose) {
        let keys = [...new Set(records.flatMap((item) => Object.keys(item)))];
        if (keys.includes("label") && keys.includes("key"))
          keys = keys.filter((key) => key !== "key");
        return (
          <div className="rk-scroll overflow-x-auto rounded-lg border border-[#1C1C1F]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6E6975]">
                  {keys.map((key) => (
                    <th key={key} scope="col" className="px-2.5 py-1.5 text-left font-semibold">
                      {humanizeKey(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((item, index) => (
                  <tr key={index} className="border-t border-[#1C1C1F] text-[#C9C9CE]">
                    {keys.map((key) => (
                      <td key={key} className="px-2.5 py-1.5 align-top tabular-nums">
                        <Scalar
                          value={item[key]}
                          unit={unitForKey(key)}
                          plain={isPlainNumberKey(key)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      return (
        <ol className="space-y-2">
          {records.map((item, index) => (
            <li key={index} className="rounded-lg border border-[#1C1C1F] p-2.5">
              {"title" in item ? (
                <p className="mb-1 text-[13px] font-medium text-[#ECECEE]">
                  {scalarText(item.title)}
                </p>
              ) : null}
              <KeyValueTree
                value={Object.fromEntries(Object.entries(item).filter(([key]) => key !== "title"))}
                depth={depth + 1}
              />
            </li>
          ))}
        </ol>
      );
    }
    return (
      <ol className="space-y-2">
        {value.map((item, index) => (
          <li key={index} className="rounded-lg border border-[#1C1C1F] p-2">
            <KeyValueTree value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => rank(a) - rank(b),
  );
  if (entries.length === 0) return <span className="text-[#6E6975]">—</span>;
  // Short scalars sit label/value on one line, in two columns when there are
  // several; prose and nested values stack under their label.
  const inline = (entry: unknown) => isScalar(entry) && scalarText(entry).length <= LONG_TEXT;
  const allInline = entries.every(([, entry]) => inline(entry));
  return (
    <dl
      className={
        allInline && entries.length > 3
          ? "grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2"
          : depth === 0
            ? "space-y-3"
            : "space-y-2"
      }
    >
      {entries.map(([key, entry]) => {
        const oneLine = inline(entry);
        // Single-key prose (e.g. a lone "detail") needs no label.
        const bare = entries.length === 1 && !oneLine && isScalar(entry);
        return (
          <div key={key} className={oneLine ? "flex items-baseline justify-between gap-3" : ""}>
            {bare ? null : (
              <dt
                className={
                  oneLine
                    ? "shrink-0 text-[12px] text-[#85858A]"
                    : "mb-1 text-[12px] font-medium text-[#A6A6AD]"
                }
              >
                {humanizeKey(key)}
              </dt>
            )}
            <dd
              className={`min-w-0 text-[13px] ${
                oneLine
                  ? "text-right tabular-nums"
                  : isScalar(entry)
                    ? ""
                    : "border-l border-[#1C1C1F] pl-3"
              }`}
            >
              {isScalar(entry) ? (
                <Scalar value={entry} unit={unitForKey(key)} plain={isPlainNumberKey(key)} />
              ) : (
                <KeyValueTree value={entry} depth={depth + 1} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function rank(key: string): number {
  const index = PROSE_FIRST.indexOf(key);
  return index === -1 ? PROSE_FIRST.length : index;
}

function unitForKey(key: string): string | undefined {
  return key === "pct" || key.endsWith("_pct") ? "%" : undefined;
}

/** Years, months, and days are labels, not quantities: no digit grouping. */
function isPlainNumberKey(key: string): boolean {
  return /(^|_)(year|month|day|hour|hours|id)$/.test(key);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== "object";
}

function scalarText(value: unknown, plain = false): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return plain ? String(value) : formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function Scalar({ value, unit, plain }: { value: unknown; unit?: string; plain?: boolean }) {
  const { t } = useLingui();
  if (value === null || value === undefined) return <span className="text-[#6E6975]">—</span>;
  if (typeof value === "boolean")
    return <span className="text-[#C9C9CE]">{value ? t`Yes` : t`No`}</span>;
  // A fraction under a "pct" key is ambiguous; only whole percentages get the sign.
  const suffix = typeof value === "number" && unit && Math.abs(value) >= 1 ? unit : "";
  return (
    <span className="whitespace-pre-wrap break-words leading-relaxed text-[#C9C9CE]">
      {scalarText(value, plain)}
      {suffix}
    </span>
  );
}

export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Section screen header: eyebrow, title, one-line subtitle, controls on the right. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6E6975]">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-[#ECECEE]">{title}</h2>
        {subtitle ? <p className="mt-1 text-[13px] text-[#85858A]">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Card with a title row (title, optional subtitle, optional right slot). */
export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-[#202023] bg-[#131315] p-4 ${className}`}>
      {title || right ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title ? <h3 className="text-[13.5px] font-semibold text-[#ECECEE]">{title}</h3> : null}
            {subtitle ? <p className="mt-0.5 text-[12px] text-[#6E6975]">{subtitle}</p> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Tiny area sparkline for stat tiles. */
export function Sparkline({
  values,
  color = accentColor,
  height = 32,
}: {
  values: Array<number | null>;
  color?: string;
  height?: number;
}) {
  const width = 96;
  const points = values
    .map((value, index) => (value === null ? null : { index, value }))
    .filter((point): point is { index: number; value: number } => point !== null);
  if (points.length < 2) return null;
  const max = Math.max(...points.map((point) => point.value));
  const min = Math.min(...points.map((point) => point.value));
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => 2 + (1 - (value - min) / (max - min || 1)) * (height - 4);
  const line = points
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"} ${x(point.index).toFixed(1)} ${y(point.value).toFixed(1)}`,
    )
    .join(" ");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `${line} L ${x(last.index).toFixed(1)} ${height} L ${x(first.index).toFixed(1)} ${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" aria-hidden="true">
      <path d={area} fill={withAlpha(color, 0.16)} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Daily stacked bars: the accent segment sits on a dim "other" segment. */
export function StackedBars({
  bars,
  height = 180,
  legend,
}: {
  bars: Array<{ label: string; primary: number; secondary: number; title?: string }>;
  height?: number;
  legend: { primary: string; secondary: string };
}) {
  const width = 720;
  const padBottom = 20;
  const gap = bars.length > 40 ? 1 : 3;
  const max = Math.max(1, ...bars.map((bar) => bar.primary + bar.secondary));
  if (bars.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6E6975]">
        <Trans>Nothing to chart yet</Trans>
      </p>
    );
  }
  const slot = width / bars.length;
  const barW = Math.max(2, slot - gap);
  const plotH = height - padBottom;
  const scale = (value: number) => (value / max) * plotH;
  return (
    <div>
      <div className="mb-2 flex justify-end gap-3 text-[12px] text-[#85858A]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: accentColor }} />
          {legend.primary}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#2A2A2F]" />
          {legend.secondary}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {bars.map((bar, index) => {
          const x = index * slot + gap / 2;
          const primaryH = scale(bar.primary);
          const secondaryH = scale(bar.secondary);
          return (
            <g key={bar.label}>
              <title>{bar.title ?? bar.label}</title>
              <rect
                x={x}
                y={plotH - primaryH - secondaryH}
                width={barW}
                height={secondaryH}
                fill="#2A2A2F"
                rx={1.5}
              />
              <rect
                x={x}
                y={plotH - primaryH}
                width={barW}
                height={primaryH}
                fill={accentColor}
                rx={1.5}
              />
            </g>
          );
        })}
        <line x1={0} x2={width} y1={plotH + 0.5} y2={plotH + 0.5} stroke="#26262A" />
        <text x={0} y={height - 4} fontSize="10" fill="#6E6975">
          {bars[0]!.label}
        </text>
        {bars.length > 1 ? (
          <text x={width} y={height - 4} fontSize="10" fill="#6E6975" textAnchor="end">
            {bars[bars.length - 1]!.label}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

/** Plain vertical bars with a label under each (months, funnel stages). */
export function ColumnBars({
  bars,
  height = 160,
  formatValue = formatNumber,
  color = accentColor,
}: {
  bars: Array<{ label: string; value: number }>;
  height?: number;
  formatValue?: (value: number) => string;
  color?: string;
}) {
  if (bars.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6E6975]">
        <Trans>Nothing to chart yet</Trans>
      </p>
    );
  }
  const width = 720;
  const padBottom = 20;
  const padTop = 14;
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const slot = width / bars.length;
  const barW = Math.min(48, slot * 0.6);
  const plotH = height - padBottom - padTop;
  // Dense series: label every nth bar and skip the per-bar value.
  const labelEvery = Math.max(1, Math.ceil(bars.length / 8));
  const showValues = bars.length <= 14;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden="true">
      {bars.map((bar, index) => {
        const h = (bar.value / max) * plotH;
        const x = index * slot + (slot - barW) / 2;
        return (
          <g key={bar.label}>
            <title>{`${bar.label} · ${formatValue(bar.value)}`}</title>
            <rect x={x} y={padTop + plotH - h} width={barW} height={h} fill={color} rx={3} />
            {showValues ? (
              <text
                x={x + barW / 2}
                y={padTop + plotH - h - 4}
                fontSize="10"
                fill="#85858A"
                textAnchor="middle"
              >
                {formatValue(bar.value)}
              </text>
            ) : null}
            {index % labelEvery === 0 || index === bars.length - 1 ? (
              <text
                x={x + barW / 2}
                y={height - 5}
                fontSize="10"
                fill="#6E6975"
                textAnchor="middle"
              >
                {bar.label}
              </text>
            ) : null}
          </g>
        );
      })}
      <line
        x1={0}
        x2={width}
        y1={padTop + plotH + 0.5}
        y2={padTop + plotH + 0.5}
        stroke="#26262A"
      />
    </svg>
  );
}

/** Full dollars below $100k, compact ($478K, $1.2M) above. */
export function formatMoneyAuto(value: number): string {
  return Math.abs(value) >= 100_000 ? formatMoneyShort(value) : formatMoney(value);
}

/** 1.7M, 66K, 998 — for tile captions. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return formatNumber(value);
}
