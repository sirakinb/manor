import { Trans, useLingui } from "@lingui/react/macro";
import { ExternalLink } from "lucide-react";
import { rpc } from "../../../lib/rpc";
import {
  Empty,
  ErrorLine,
  formatDate,
  formatNumber,
  KpiTile,
  LineChart,
  Loading,
  PanelHeader,
  Section,
  useSectionData,
} from "../bits";

export function SocialPanel() {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData(
    () => rpc.workspace.social.snapshot({ days: 30 }),
    "social",
  );

  return (
    <div>
      <PanelHeader title={t`Social`} />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          {data.account ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[15px] font-medium text-[#ECECEE]">
                {data.account.username ? `@${data.account.username}` : t`Instagram`}
              </h3>
              <span className="text-[12px] text-[#6E6975]">
                {t`Captured ${formatDate(data.account.capturedAt)}`}
              </span>
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile label={t`Followers`} value={formatNumber(data.account?.followers)} />
            <KpiTile label={t`Reach 28d`} value={formatNumber(data.account?.reach28d)} />
            <KpiTile
              label={t`Engaged 28d`}
              value={formatNumber(data.account?.accountsEngaged28d)}
            />
            <KpiTile
              label={t`Profile views 28d`}
              value={formatNumber(data.account?.profileViews28d)}
              detail={
                data.account?.mediaCount !== null && data.account?.mediaCount !== undefined
                  ? t`${formatNumber(data.account.mediaCount)} posts`
                  : undefined
              }
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Section title={t`Daily reach`}>
              <LineChart
                height={130}
                labels={data.daily.map((day) => day.day.slice(5))}
                series={[
                  { name: t`Reach`, values: data.daily.map((day) => day.reach), area: true },
                ]}
              />
            </Section>
            <Section title={t`Followers`}>
              <LineChart
                height={130}
                labels={data.daily.map((day) => day.day.slice(5))}
                series={[
                  {
                    name: t`Followers`,
                    values: data.daily.map((day) => day.followers),
                    color: "#4ADE80",
                  },
                ]}
              />
            </Section>
          </div>
          <h3 className="mt-4 mb-2 text-[13px] font-semibold text-[#ECECEE]">
            <Trans>Top posts</Trans>
          </h3>
          {data.topPosts.length === 0 ? (
            <Empty>
              <Trans>No posts in this window</Trans>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.topPosts.map((post) => (
                <div
                  key={post.mediaId}
                  className="rounded-xl border border-[#202023] bg-[#131315] p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-3 text-[12.5px] leading-relaxed text-[#C9C9CE]">
                      {post.caption || "—"}
                    </p>
                    {post.permalink ? (
                      <a
                        href={post.permalink}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t`Open post`}
                        className="shrink-0 text-[#6E6975] hover:text-[#ECECEE]"
                      >
                        <ExternalLink size={14} strokeWidth={1.8} />
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-3 text-[11.5px] text-[#6E6975] tabular-nums">
                    <span>{post.mediaType ?? ""}</span>
                    <span>{formatDate(post.postedAt)}</span>
                  </p>
                  <p className="mt-1.5 flex gap-4 text-[12px] text-[#85858A] tabular-nums">
                    <span>{t`${formatNumber(post.reach)} reach`}</span>
                    <span>{t`${formatNumber(post.likes)} likes`}</span>
                    <span>{t`${formatNumber(post.comments)} comments`}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
