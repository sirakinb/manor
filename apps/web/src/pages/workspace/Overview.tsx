import { useLingui } from "@lingui/react/macro";
import type { WorkspaceOverview } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import {
  CLICKABLE,
  formatCompact,
  formatMoney,
  formatNumber,
  formatPct,
  type SectionKey,
  Sparkline,
} from "./bits";
import { PipelineMap } from "./PipelineMap";

type Sparks = { voice?: number[]; social?: number[]; leasing?: number[] };

/**
 * The Overview tab: a stat strip (one tile per channel, with a sparkline
 * where a series exists) and the pipeline map filling the rest of the pane.
 */
export function Overview({
  overview,
  onOpen,
}: {
  overview: WorkspaceOverview;
  onOpen: (section: SectionKey) => void;
}) {
  const { t } = useLingui();
  const [sparks, setSparks] = useState<Sparks>({});

  // Sparklines arrive after the tiles; a failed series just leaves its tile flat.
  useEffect(() => {
    let cancelled = false;
    const { channels } = overview.workspace;
    const loads: Array<Promise<Partial<Sparks>>> = [];
    if (channels.includes("voice"))
      loads.push(
        rpc.workspace.voice
          .stats({ days: 30 })
          .then((stats) => ({ voice: stats.daily.map((day) => day.calls) })),
      );
    if (channels.includes("social"))
      loads.push(
        rpc.workspace.social.snapshot({ days: 30 }).then((snapshot) => ({
          social: snapshot.daily.map((day) => day.followers ?? day.reach ?? 0),
        })),
      );
    if (channels.includes("leasing"))
      loads.push(
        rpc.workspace.leasing.snapshot().then((snapshot) => ({
          leasing: snapshot.applications.monthlySubmissions12m.map((month) => month.applications),
        })),
      );
    Promise.allSettled(loads).then((results) => {
      if (cancelled) return;
      const next: Sparks = {};
      for (const result of results)
        if (result.status === "fulfilled") Object.assign(next, result.value);
      setSparks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [overview.workspace]);

  const { voice, email, social, leasing, utilities } = overview;
  const tiles: Array<{
    section: SectionKey;
    label: string;
    value: string;
    caption: string;
    spark?: number[];
  }> = [];
  if (voice) {
    const rate = voice.calls30d > 0 ? (voice.aiHandled30d / voice.calls30d) * 100 : null;
    tiles.push({
      section: "voice",
      label: t`Calls · 30d`,
      value: formatNumber(voice.calls30d),
      caption: t`${formatPct(rate)} AI handled · ${formatNumber(voice.callbacks30d)} callbacks`,
      spark: sparks.voice,
    });
  }
  if (email) {
    tiles.push({
      section: "email",
      label: t`Open rate`,
      value: formatPct(email.lifetimeOpenRatePct, 1),
      caption: t`${formatNumber(email.campaignsTotal)} campaigns`,
    });
  }
  if (social) {
    tiles.push({
      section: "social",
      label: t`Followers`,
      value: formatCompact(social.followers),
      caption: t`${formatCompact(social.reach28d)} reach · 28d`,
      spark: sparks.social,
    });
  }
  if (leasing) {
    tiles.push({
      section: "leasing",
      label: t`Active leases`,
      value: formatNumber(leasing.activeLeases),
      caption: t`${formatMoney(leasing.monthlyRentRoll)} rent roll · ${formatNumber(leasing.availableListings)} available`,
      spark: sparks.leasing,
    });
  }
  if (utilities) {
    tiles.push({
      section: "utilities",
      label: t`Bills to review`,
      value: formatNumber(utilities.billsNeedingReview),
      caption: t`${formatNumber(utilities.billsThisMonth)} this month · ${formatNumber(utilities.chargesPending)} charges pending`,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-[22px] pt-4 pb-3">
      {tiles.length ? (
        <div
          data-testid="workspace-stats"
          className="grid shrink-0 items-stretch gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, 5)}, minmax(0, 1fr))` }}
        >
          {tiles.map((tile) => (
            <TileButton key={tile.section} onClick={() => onOpen(tile.section)}>
              <StatTile
                label={tile.label}
                value={tile.value}
                caption={tile.caption}
                spark={tile.spark}
              />
            </TileButton>
          ))}
        </div>
      ) : null}
      <div className="mt-3 min-h-0 flex-1">
        <PipelineMap overview={overview} onOpen={onOpen} />
      </div>
    </div>
  );
}

/**
 * One stat tile with a fixed inner layout — label, value, one caption line,
 * and a sparkline row that is always present — so every tile in the strip has
 * the same height and the same baselines.
 */
function StatTile({
  label,
  value,
  caption,
  spark,
}: {
  label: string;
  value: string;
  caption: string;
  spark?: number[];
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-[#202023] bg-[#131315] px-4 pt-3.5 pb-3">
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#6E6975]">
        {label}
      </p>
      <p className="mt-1.5 truncate text-[24px] font-semibold leading-none tracking-tight text-[#ECECEE] tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 truncate text-[12px] text-[#85858A] tabular-nums" title={caption}>
        {caption}
      </p>
      <div className="mt-2 h-8">{spark ? <Sparkline values={spark} /> : null}</div>
    </div>
  );
}

function TileButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl text-left outline-none ${CLICKABLE}`}
    >
      {children}
    </button>
  );
}
