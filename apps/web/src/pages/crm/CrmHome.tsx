import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { CrmOverview } from "@rakazo/contracts";
import { useMemo, useState } from "react";
import { formatMoney, formatMoneyShort, STATUS_COLORS, stageColor, withAlpha } from "./theme";

const ALL = "__all__";

/**
 * The numbers a service business checks every morning: how much is moving,
 * how much has landed, and where the pipeline is thick or thin.
 */
export function CrmHome({ overview }: { overview: CrmOverview }) {
  const { t } = useLingui();
  const [pipelineId, setPipelineId] = useState<string>(ALL);

  const scope = useMemo(() => {
    const pipelines =
      pipelineId === ALL
        ? overview.pipelines
        : overview.pipelines.filter((pipeline) => pipeline.id === pipelineId);
    const stages = pipelines.flatMap((pipeline) => pipeline.stages);
    const stageIds = new Set(stages.map((stage) => stage.id));
    const deals = overview.deals.filter((deal) => stageIds.has(deal.stageId));
    return { pipelines, stages, deals };
  }, [overview, pipelineId]);

  const open = scope.deals.filter((deal) => deal.status === "open");
  const won = scope.deals.filter((deal) => deal.status === "won");
  const lost = scope.deals.filter((deal) => deal.status === "lost");
  const totalValue = scope.deals.reduce((sum, deal) => sum + deal.value, 0);
  const wonValue = won.reduce((sum, deal) => sum + deal.value, 0);
  const openValue = open.reduce((sum, deal) => sum + deal.value, 0);
  const avgDeal = scope.deals.length ? Math.round(totalValue / scope.deals.length) : 0;

  const stageData = scope.stages.map((stage) => {
    const stageDeals = scope.deals.filter((deal) => deal.stageId === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color ?? stageColor(stage.position),
      count: stageDeals.length,
      value: stageDeals.reduce((sum, deal) => sum + deal.value, 0),
    };
  });
  const maxStageValue = Math.max(...stageData.map((stage) => stage.value), 1);

  const donut = stageData.filter((stage) => stage.value > 0);
  const donutTotal = donut.reduce((sum, stage) => sum + stage.value, 0);

  const statusData = [
    { label: t`Open`, count: open.length, color: STATUS_COLORS.open },
    { label: t`Won`, count: won.length, color: STATUS_COLORS.won },
    { label: t`Lost`, count: lost.length, color: STATUS_COLORS.lost },
  ].filter((entry) => entry.count > 0);
  const statusTotal = statusData.reduce((sum, entry) => sum + entry.count, 0);

  const stageById = new Map(scope.stages.map((stage) => [stage.id, stage]));
  const recent = scope.deals.slice(0, 6);

  const dealCount = scope.deals.length;
  const contactCount = overview.contacts.length;
  const wonCount = won.length;
  const openAmount = formatMoney(openValue);

  const cards = [
    {
      label: t`Total pipeline`,
      value: formatMoney(totalValue),
      detail: plural(dealCount, { one: "# deal", other: "# deals" }),
    },
    {
      label: t`Won revenue`,
      value: formatMoney(wonValue),
      detail: t`${wonCount} closed`,
    },
    {
      label: t`Open deals`,
      value: String(open.length),
      detail: t`${openAmount} in play`,
    },
    {
      label: t`Avg deal size`,
      value: formatMoney(avgDeal),
      detail: plural(contactCount, { one: "# contact", other: "# contacts" }),
    },
  ];

  return (
    <div className="px-[22px] py-5">
      {overview.pipelines.length > 1 ? (
        <div className="mb-4 flex justify-end">
          <select
            value={pipelineId}
            onChange={(event) => setPipelineId(event.target.value)}
            className="rounded-lg border border-[#202023] bg-[#131315] px-3 py-1.5 text-[13px] text-[#C9C9CE] outline-none"
          >
            <option value={ALL}>
              <Trans>All pipelines</Trans>
            </option>
            {overview.pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-[#202023] bg-[#131315] p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#6E6975]">
              {card.label}
            </p>
            <p className="mt-2.5 text-[24px] font-semibold tracking-tight text-[#ECECEE] tabular-nums">
              {card.value}
            </p>
            <p className="mt-0.5 text-[12px] text-[#85858A] tabular-nums">{card.detail}</p>
          </div>
        ))}
      </div>

      {scope.deals.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[#2A2A2E] p-12 text-center">
          <p className="text-[14px] font-medium text-[#C9C9CE]">
            <Trans>No deals yet</Trans>
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[#6E6975]">
            <Trans>
              The dashboard comes to life once deals land on the pipeline. Open the Pipeline tab to
              add the first one.
            </Trans>
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="col-span-2 rounded-xl border border-[#202023] bg-[#131315] p-4">
              <h2 className="mb-4 text-[13px] font-semibold text-[#ECECEE]">
                <Trans>Pipeline value by stage</Trans>
              </h2>
              <div className="space-y-3">
                {stageData.map((stage) => (
                  <div key={stage.id}>
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span className="flex items-center gap-1.5 font-medium text-[#C9C9CE]">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </span>
                      <span className="text-[#6E6975] tabular-nums">
                        {formatMoneyShort(stage.value)} · {stage.count}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1C1C1F]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max((stage.value / maxStageValue) * 100, stage.value > 0 ? 2 : 0)}%`,
                          backgroundColor: stage.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Ring
              title={t`Value distribution`}
              center={formatMoneyShort(donutTotal)}
              segments={donut.map((stage) => ({
                label: stage.name,
                value: stage.value,
                color: stage.color,
                display: formatMoneyShort(stage.value),
              }))}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <Ring
              title={t`Deal status`}
              center={String(statusTotal)}
              segments={statusData.map((entry) => ({
                label: entry.label,
                value: entry.count,
                color: entry.color,
                display: String(entry.count),
              }))}
            />

            <div className="col-span-2 rounded-xl border border-[#202023] bg-[#131315] p-4">
              <h2 className="mb-1 text-[13px] font-semibold text-[#ECECEE]">
                <Trans>Recent deals</Trans>
              </h2>
              <div className="divide-y divide-[#1C1C1F]">
                {recent.map((deal) => {
                  const stage = stageById.get(deal.stageId);
                  return (
                    <div key={deal.id} className="flex items-center justify-between py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: stage
                              ? (stage.color ?? stageColor(stage.position))
                              : "#6E6975",
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-[#ECECEE]">
                            {deal.title}
                          </p>
                          <p className="text-[12px] text-[#6E6975]">
                            {stage?.name ?? "—"}
                            {deal.status !== "open" ? (
                              <span
                                className="ml-2 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
                                style={{
                                  backgroundColor: withAlpha(STATUS_COLORS[deal.status], 0.14),
                                  color: STATUS_COLORS[deal.status],
                                }}
                              >
                                {deal.status}
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                      <span className="text-[13px] font-semibold text-[#ECECEE] tabular-nums">
                        {formatMoney(deal.value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A donut with a legend — hand-rolled SVG, no chart library. */
function Ring({
  title,
  center,
  segments,
}: {
  title: string;
  center: string;
  segments: Array<{ label: string; value: number; color: string; display: string }>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 62;
  const cx = 70;
  const cy = 70;
  let cumulative = 0;
  const paths = segments.map((segment) => {
    const start = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += segment.value;
    const end = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + radius * Math.cos(start);
    const y1 = cy + radius * Math.sin(start);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    return {
      d: `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`,
      color: segment.color,
    };
  });

  return (
    <div className="rounded-xl border border-[#202023] bg-[#131315] p-4">
      <h2 className="mb-3 text-[13px] font-semibold text-[#ECECEE]">{title}</h2>
      {segments.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-[#6E6975]">
          <Trans>Nothing to chart yet</Trans>
        </p>
      ) : (
        <>
          <div className="flex justify-center">
            <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
              {paths.map((path) => (
                <path key={path.d} d={path.d} fill={path.color} />
              ))}
              <circle cx={cx} cy={cy} r={38} fill="#131315" />
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fontSize="14"
                fontWeight="600"
                fill="#ECECEE"
              >
                {center}
              </text>
            </svg>
          </div>
          <div className="mt-3 space-y-1.5">
            {segments.map((segment) => (
              <div key={segment.label} className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="flex-1 truncate text-[#85858A]">{segment.label}</span>
                <span className="font-medium text-[#C9C9CE] tabular-nums">{segment.display}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
