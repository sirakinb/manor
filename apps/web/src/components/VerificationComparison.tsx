import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { VerificationSummaryDto } from "@rakazo/contracts";
import { formatUsd } from "@rakazo/core";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { rpc } from "../lib/rpc";
import { BuiButton, BuiCard, LoadingState } from "./beautiful-ui/primitives";
import { ChartCanvas } from "./ChartCanvas";

type Checkpoint = "action" | "answer";
type Summary = VerificationSummaryDto;
type Disagreement = Summary["disagreements"][number];
type Verdict = Disagreement["verdicts"][number];

const RANGES = [7, 30, 90] as const;

/** Side-by-side results for the checker engines, with Markdown and CSV downloads. */
export function VerificationComparisonOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [days, setDays] = useState<number>(30);
  const [botId, setBotId] = useState("");
  const [checkpoint, setCheckpoint] = useState<Checkpoint>("action");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"markdown" | "csv" | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  // Filtering by a bot narrows the summary's bot list, so keep the unfiltered one for the picker.
  const [bots, setBots] = useState<Summary["bots"]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Capture first so Escape closes this panel without also closing the settings under it.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    rpc.verification
      .summary({ days, botId: botId || undefined })
      .then((next) => {
        if (cancelled) return;
        setSummary(next);
        setExpanded(null);
        if (!botId) setBots(next.bots);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t`Could not load results`);
      });
    return () => {
      cancelled = true;
    };
  }, [days, botId, t]);

  async function download(format: "markdown" | "csv") {
    setDownloading(format);
    setError(null);
    try {
      const file = await rpc.verification.report({ days, botId: botId || undefined, format });
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not download the report`);
    } finally {
      setDownloading(null);
    }
  }

  const label = (engine: string) =>
    summary?.engines.find((candidate) => candidate.id === engine)?.label ?? engine;
  const current = summary?.checkpoints.find((entry) => entry.checkpoint === checkpoint);
  const disagreements = (summary?.disagreements ?? []).filter(
    (entry) => entry.checkpoint === checkpoint,
  );
  const engines = current?.engines.map((stats) => stats.engine) ?? [];
  const daily = useMemo(
    () =>
      (summary?.daily ?? [])
        .filter((point) => point.checkpoint === checkpoint && point.flagRate !== null)
        .map((point) => ({
          day: new Date(`${point.day}T00:00:00Z`),
          checker: summary?.engines.find((e) => e.id === point.engine)?.label ?? point.engine,
          flagRate: point.flagRate,
        })),
    [summary, checkpoint],
  );
  const chartDays = new Set(daily.map((point) => point.day.getTime())).size;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-4 sm:p-10">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checker-comparison-title"
        data-testid="checker-comparison"
        tabIndex={-1}
        className="rk-scroll flex max-h-full w-[980px] max-w-full flex-col overflow-y-auto rounded-[26px] border border-[#232326] bg-[#141416] p-6 shadow-[0_40px_90px_rgba(0,0,0,.55)] outline-none sm:p-8"
      >
        <div className="flex items-start justify-between gap-6">
          <h2 id="checker-comparison-title" className="text-2xl font-medium text-[#F1F1F2]">
            <Trans>Checker comparison</Trans>
          </h2>
          <button
            type="button"
            aria-label={t`Close checker comparison`}
            onClick={onClose}
            className="text-[#85858A]"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t`Check type`} className="flex gap-1">
            {(["action", "answer"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={checkpoint === value}
                onClick={() => {
                  setCheckpoint(value);
                  setExpanded(null);
                }}
                className="rounded-[11px] border border-[#26262A] px-3 py-1.5 text-[14px] text-[#C9C9CE] aria-selected:border-[#5A5A60] aria-selected:bg-[#1C1C1F]"
              >
                {value === "action" ? <Trans>Actions</Trans> : <Trans>Replies</Trans>}
              </button>
            ))}
          </div>
          <select
            aria-label={t`Time range`}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-[11px] border border-[#26262A] bg-[#101012] px-3 py-1.5 text-[14px] text-[#C9C9CE]"
          >
            {RANGES.map((range) => (
              <option key={range} value={range}>
                {t`Last ${range} days`}
              </option>
            ))}
          </select>
          <select
            aria-label={t`Bot`}
            value={botId}
            onChange={(event) => setBotId(event.target.value)}
            className="rounded-[11px] border border-[#26262A] bg-[#101012] px-3 py-1.5 text-[14px] text-[#C9C9CE]"
          >
            <option value="">{t`All bots`}</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
          <div className="ml-auto flex gap-2">
            <BuiButton disabled={downloading !== null} onClick={() => void download("markdown")}>
              {downloading === "markdown" ? t`Preparing…` : t`Report (.md)`}
            </BuiButton>
            <BuiButton disabled={downloading !== null} onClick={() => void download("csv")}>
              {downloading === "csv" ? t`Preparing…` : t`Data (.csv)`}
            </BuiButton>
          </div>
        </div>

        {error ? <p className="mt-4 text-[13px] text-[#EF4444]">{error}</p> : null}

        {!summary && !error ? (
          <div className="mt-8">
            <LoadingState label={t`Loading results`} />
          </div>
        ) : null}

        {summary && !current ? (
          <p className="mt-8 text-[14px] text-[#85858A]">
            <Trans>No checks in this period.</Trans>
          </p>
        ) : null}

        {current ? (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {current.engines.map((stats) => (
                <BuiCard key={stats.engine} className="p-4" data-testid="checker-card">
                  <div className="text-[15px] font-medium text-[#ECECEE]">
                    {label(stats.engine)}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13.5px]">
                    <Stat name={t`Checks`} value={String(stats.checks)} />
                    <Stat
                      name={t`Flagged`}
                      value={stats.flagRate === null ? "–" : percent(stats.flagRate)}
                    />
                    {checkpoint === "action" ? (
                      <Stat
                        name={t`Right when you answered`}
                        value={
                          stats.answered.total
                            ? `${stats.answered.correct} / ${stats.answered.total}`
                            : "–"
                        }
                      />
                    ) : null}
                    <Stat name={t`Errors`} value={String(stats.errors)} />
                    <Stat
                      name={t`Median time`}
                      value={stats.medianLatencyMs === null ? "–" : `${stats.medianLatencyMs} ms`}
                    />
                    <Stat name={t`Cost`} value={formatUsd(stats.costUsd)} />
                  </dl>
                </BuiCard>
              ))}
            </div>
            <p className="mt-3 text-[13.5px] text-[#A6A6AD]" data-testid="checker-agreement">
              {current.compared ? (
                <Trans>
                  Agreed on {current.agreed} of {current.compared} checks (
                  {percent(current.agreed / current.compared)})
                </Trans>
              ) : (
                <Trans>Turn on Compare checkers to see both engines on the same checks.</Trans>
              )}
            </p>

            {chartDays > 1 ? (
              <div className="mt-6">
                <ChartCanvas
                  spec={{
                    title: t`Flag rate by day`,
                    height: 200,
                    y: { domain: [0, 1], tickFormat: "%", grid: true, label: null },
                    x: { label: null },
                    color: { legend: true },
                    marks: [
                      {
                        type: "lineY",
                        options: { x: "day", y: "flagRate", stroke: "checker", tip: true },
                      },
                      { type: "dot", options: { x: "day", y: "flagRate", fill: "checker" } },
                    ],
                  }}
                  data={daily}
                  width={900}
                  height={200}
                />
              </div>
            ) : null}

            <h3 className="mt-7 text-[15px] font-medium text-[#ECECEE]">
              <Trans>Disagreements</Trans>
            </h3>
            {disagreements.length === 0 ? (
              <p className="mt-2 text-[13.5px] text-[#85858A]">
                <Trans>None in this period.</Trans>
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[13.5px]" data-testid="disagreements">
                  <thead className="text-[#85858A]">
                    <tr>
                      <th className="py-2 pr-3 font-normal">
                        <Trans>When</Trans>
                      </th>
                      <th className="py-2 pr-3 font-normal">
                        <Trans>Bot</Trans>
                      </th>
                      <th className="py-2 pr-3 font-normal">
                        {checkpoint === "action" ? <Trans>Action</Trans> : <Trans>Request</Trans>}
                      </th>
                      {engines.map((engine) => (
                        <th key={engine} className="py-2 pr-3 font-normal">
                          {label(engine)}
                        </th>
                      ))}
                      {checkpoint === "action" ? (
                        <th className="py-2 font-normal">
                          <Trans>You</Trans>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {disagreements.map((entry, index) => (
                      <Fragment key={`${entry.createdAt}-${index}`}>
                        <tr
                          className="cursor-pointer border-t border-[#232326] text-[#C9C9CE] hover:bg-[#1A1A1D]"
                          onClick={() => setExpanded(expanded === index ? null : index)}
                        >
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <button
                              type="button"
                              aria-expanded={expanded === index}
                              className="text-left"
                            >
                              {new Date(entry.createdAt).toLocaleString()}
                            </button>
                          </td>
                          <td className="py-2 pr-3">{entry.botName}</td>
                          <td className="max-w-[260px] truncate py-2 pr-3">
                            {checkpoint === "action" ? entry.subject : entry.task}
                          </td>
                          {engines.map((engine) => (
                            <td key={engine} className="py-2 pr-3">
                              <DecisionLabel
                                verdict={entry.verdicts.find((v) => v.engine === engine)}
                                checkpoint={checkpoint}
                              />
                            </td>
                          ))}
                          {checkpoint === "action" ? (
                            <td className="py-2">
                              {entry.userAnswer === "allowed"
                                ? t`Allowed`
                                : entry.userAnswer === "denied"
                                  ? t`Denied`
                                  : "–"}
                            </td>
                          ) : null}
                        </tr>
                        {expanded === index ? (
                          <tr>
                            <td colSpan={engines.length + 4} className="pb-4">
                              <DisagreementDetail entry={entry} label={label} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-[#85858A]">{name}</dt>
      <dd className="text-right text-[#ECECEE] tabular-nums">{value}</dd>
    </>
  );
}

function DecisionLabel({
  verdict,
  checkpoint,
}: {
  verdict: Verdict | undefined;
  checkpoint: Checkpoint;
}) {
  const { t } = useLingui();
  if (!verdict) return <>–</>;
  if (verdict.decision === "pass") return <>{checkpoint === "action" ? t`Pass` : t`Supported`}</>;
  if (verdict.decision === "ask") {
    return (
      <span className="text-[#E8A15A]">{checkpoint === "action" ? t`Ask` : t`Unsupported`}</span>
    );
  }
  return <span className="text-[#85858A]">{t`Error`}</span>;
}

function DisagreementDetail({
  entry,
  label,
}: {
  entry: Disagreement;
  label: (engine: string) => string;
}) {
  return (
    <div className="rounded-[14px] border border-[#26262A] bg-[#101012] p-4 text-[13.5px] text-[#C9C9CE]">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[#A6A6AD]">
          <Trans>Request:</Trans> {entry.task}
        </p>
        <Link to={`/app/${entry.botId}`} className="shrink-0 text-[#9CA3F5] hover:underline">
          <Trans>Open chat</Trans>
        </Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {entry.verdicts.map((verdict) => (
          <div key={verdict.engine}>
            <div className="font-medium text-[#ECECEE]">
              {label(verdict.engine)}{" "}
              <span className="font-normal text-[#85858A]">
                {verdict.role === "primary" ? <Trans>decided</Trans> : <Trans>compared</Trans>}
              </span>
            </div>
            {verdict.reason ? <p className="mt-1">{verdict.reason}</p> : null}
            {verdict.probability !== null || verdict.confidence !== null ? (
              <p className="mt-1 text-[#85858A] tabular-nums">
                {verdict.probability !== null ? `p ${verdict.probability.toFixed(2)}` : null}
                {verdict.probability !== null && verdict.confidence !== null ? " · " : null}
                {verdict.confidence !== null ? (
                  <Trans>confidence {verdict.confidence.toFixed(2)}</Trans>
                ) : null}
              </p>
            ) : null}
            <ClaimList verdict={verdict} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ClaimList({ verdict }: { verdict: Verdict }) {
  const claims = (verdict.details as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(claims) || !claims.length) return null;
  const unsupported = claims.filter((claim) => !claim.supported).length;
  return (
    <div className="mt-2">
      <p className="text-[#85858A]">
        {plural(unsupported, { one: "# unsupported statement", other: "# unsupported statements" })}
      </p>
      <ul className="mt-1 space-y-1">
        {(claims as Array<{ text: string; supported: boolean; probability?: number }>).map(
          (claim, index) => (
            <li key={index} className={claim.supported ? "text-[#85858A]" : "text-[#E8A15A]"}>
              {claim.supported ? "✓" : "✗"} {claim.text}
              {claim.probability === undefined ? null : (
                <span className="text-[#6C6C70] tabular-nums">
                  {" "}
                  ({claim.probability.toFixed(2)})
                </span>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
