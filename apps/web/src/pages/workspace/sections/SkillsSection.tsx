import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceContextEntry, WorkspaceSummary } from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import {
  CLICKABLE_TEXT,
  Empty,
  ErrorLine,
  formatDateTime,
  formatNumber,
  Loading,
  PageHeader,
  StatusPill,
  useSectionData,
} from "../bits";

type SkillRow = Awaited<ReturnType<typeof rpc.workspace.skills.list>>[number];

export function SkillsSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const { data, error, loading } = useSectionData(
    () =>
      Promise.all([rpc.workspace.skills.list(), rpc.workspace.context.list()]).then(
        ([skills, context]) => ({ skills, context }),
      ),
    "skills",
  );

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t`What your AI has learned`}
        subtitle={t`${workspace.name} · reusable playbooks and scripts agents saved, so the next run starts from the last one`}
      />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <>
          {data.skills.length === 0 ? (
            <Empty>
              <Trans>No skills saved yet</Trans>
            </Empty>
          ) : (
            <div className="space-y-3">
              {data.skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          )}
          <h3 className="mt-8 text-[17px] font-semibold text-[#ECECEE]">
            <Trans>Workspace context</Trans>
          </h3>
          <p className="mt-1 mb-3 text-[13px] text-[#85858A]">
            <Trans>Durable facts and conventions agents read before acting.</Trans>
          </p>
          {data.context.length === 0 ? (
            <Empty>
              <Trans>No context saved yet</Trans>
            </Empty>
          ) : (
            <div className="space-y-3">
              {data.context.map((entry) => (
                <ContextCard key={entry.key} entry={entry} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillRow }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[#202023] bg-[#131315] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusPill tone="accent">{skill.kind}</StatusPill>
          <span className="truncate font-mono text-[13.5px] text-[#ECECEE]">{skill.name}</span>
        </span>
        <span className="rounded-full bg-[#1A1A1D] px-2 py-0.5 text-[11px] text-[#A6A6AD]">
          v{skill.version}
        </span>
      </div>
      {skill.notes ? (
        <p className="mt-2 text-[13px] leading-relaxed text-[#C9C9CE]">{skill.notes}</p>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`mt-2 text-[12.5px] text-[#85858A] ${CLICKABLE_TEXT}`}
      >
        {open ? `▾ ${t`Hide content`}` : `▸ ${t`View content`}`}
      </button>
      {open ? <SkillContent name={skill.name} version={skill.version} /> : null}
      <p className="mt-2 text-[11.5px] text-[#6E6975]">
        <span className="font-mono">{skill.createdBy}</span> · {formatDateTime(skill.createdAt)}
      </p>
    </div>
  );
}

function SkillContent({ name, version }: { name: string; version: number }) {
  const { data, error, loading } = useSectionData(
    () => rpc.workspace.skills.get({ name, version }),
    `${name}:${version}`,
  );
  if (error) return <ErrorLine message={error} />;
  if (loading || !data) return <Loading />;
  return <ContentBlock content={data.content} />;
}

function ContextCard({ entry }: { entry: WorkspaceContextEntry }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[#202023] bg-[#131315] p-4">
      <p className="font-mono text-[13.5px] text-[#ECECEE]">{entry.key}</p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`mt-2 text-[12.5px] text-[#85858A] ${CLICKABLE_TEXT}`}
      >
        {open
          ? `▾ ${t`Hide content`}`
          : `▸ ${t`View content (${formatNumber(entry.content.length)} chars)`}`}
      </button>
      {open ? <ContentBlock content={entry.content} /> : null}
      <p className="mt-2 text-[11.5px] text-[#6E6975]">
        <span className="font-mono">{entry.updatedBy}</span> ·{" "}
        {t`Updated ${formatDateTime(entry.updatedAt)}`}
      </p>
    </div>
  );
}

function ContentBlock({ content }: { content: string }) {
  return (
    <pre className="rk-scroll mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[#1C1C1F] bg-[#0D0D0E] p-3 font-mono text-[12px] leading-relaxed text-[#C9C9CE]">
      {content}
    </pre>
  );
}
