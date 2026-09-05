import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceSummary } from "@rakazo/contracts";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  Card,
  ColumnBars,
  ErrorLine,
  formatCompact,
  formatDate,
  formatNumber,
  formatPct,
  KpiTile,
  LineChart,
  Loading,
  PageHeader,
  Segmented,
  useSectionData,
} from "../bits";

type Range = "7" | "30" | "90";

export function SocialSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const [range, setRange] = useState<Range>("30");
  const days = Number(range);
  const { data, error, loading } = useSectionData(
    () => rpc.workspace.social.snapshot({ days }),
    range,
  );
  const rangeLabel: Record<Range, string> = {
    "7": t`Last 7 days`,
    "30": t`Last 30 days`,
    "90": t`Last 90 days`,
  };
  const account = data?.account;
  const followersNow =
    account?.followers ??
    [...(data?.daily ?? [])].reverse().find((day) => day.followers !== null)?.followers ??
    null;
  const engagement =
    account?.totalInteractions28d != null && account.reach28d
      ? (account.totalInteractions28d / account.reach28d) * 100
      : null;

  return (
    <div className="ws-refined">
      <PageHeader
        eyebrow={eyebrow}
        title={t`Instagram performance`}
        subtitle={
          account?.username
            ? `@${account.username} · ${rangeLabel[range]}`
            : `${workspace.name} · ${rangeLabel[range]}`
        }
      >
        <Segmented
          label={t`Range`}
          value={range}
          onChange={setRange}
          options={[
            { key: "7", label: t`7D` },
            { key: "30", label: t`30D` },
            { key: "90", label: t`90D` },
          ]}
        />
      </PageHeader>
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile
              label={t`Followers`}
              value={formatCompact(followersNow)}
              caption={t`${formatNumber(account?.mediaCount)} posts`}
            />
            <KpiTile
              label={t`Reach`}
              value={formatCompact(account?.reach28d)}
              caption={t`last 28 days`}
            />
            <KpiTile
              label={t`Engagement rate`}
              value={formatPct(engagement, 1)}
              caption={t`${formatCompact(account?.totalInteractions28d)} interactions`}
            />
            <KpiTile
              label={t`Profile views`}
              value={formatCompact(account?.profileViews28d)}
              caption={t`${formatCompact(account?.accountsEngaged28d)} accounts engaged`}
            />
          </div>
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            <Card title={t`Daily reach`} subtitle={rangeLabel[range]} className="ws-chart">
              <LineChart
                height={180}
                labels={data.daily.map((day) => day.day.slice(5))}
                series={[
                  {
                    name: t`Reach`,
                    values: data.daily.map((day) => day.reach),
                    area: true,
                    color: "#83BFB1",
                  },
                ]}
              />
            </Card>
            <Card
              className="ws-chart"
              title={t`New followers`}
              subtitle={rangeLabel[range]}
              right={
                <span className="text-right">
                  <span className="block text-[20px] font-semibold leading-none text-[#ECECEE] tabular-nums">
                    {formatNumber(followersNow)}
                  </span>
                  <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ws-muted,#6E6975)]">
                    <Trans>followers now</Trans>
                  </span>
                </span>
              }
            >
              <ColumnBars
                height={180}
                color="#83BFB1"
                label={t`New followers by day`}
                bars={data.daily.map((day) => ({
                  label: day.day.slice(5),
                  value: day.newFollowers,
                }))}
              />
            </Card>
          </div>
          <Card title={t`Top posts`} subtitle={t`By reach`} className="mt-4">
            {data.topPosts.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[var(--ws-muted,#6E6975)]">
                <Trans>No posts in this range</Trans>
              </p>
            ) : (
              <ul className="divide-y divide-[#1C1C1F]">
                {data.topPosts.map((post) => (
                  <li key={post.mediaId} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[12.5px] leading-snug text-[#C9C9CE]">
                        {post.caption || "—"}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--ws-muted,#6E6975)] tabular-nums">
                        <span>{formatDate(post.postedAt)}</span>
                        <span>{t`${formatNumber(post.likes)} likes`}</span>
                        <span>{t`${formatNumber(post.comments)} comments`}</span>
                        {post.permalink ? (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t`Open post`}
                            className="text-[#85858A] hover:text-[#ECECEE]"
                          >
                            <ExternalLink size={11} strokeWidth={1.8} />
                          </a>
                        ) : null}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[14px] font-semibold text-[#ECECEE] tabular-nums">
                        {formatNumber(post.reach)}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--ws-muted,#6E6975)]">
                        <Trans>Reach</Trans>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
