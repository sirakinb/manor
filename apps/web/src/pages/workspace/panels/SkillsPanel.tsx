import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceSkill } from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../../lib/rpc";
import { Empty, ErrorLine, formatDate, Loading, PanelHeader, useSectionData } from "../bits";

type SkillRow = Awaited<ReturnType<typeof rpc.workspace.skills.list>>[number];

export function SkillsPanel() {
  const { t } = useLingui();
  const [selected, setSelected] = useState<SkillRow | null>(null);
  const { data, error, loading } = useSectionData(() => rpc.workspace.skills.list(), "skills");

  return (
    <div>
      <PanelHeader title={t`Skills`} />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        selected ? (
          <SkillDetail row={selected} onBack={() => setSelected(null)} />
        ) : data.length === 0 ? (
          <Empty>
            <Trans>No skills saved yet</Trans>
          </Empty>
        ) : (
          <ul className="divide-y divide-[#1C1C1F] rounded-xl border border-[#202023]">
            {data.map((skill) => (
              <li key={skill.id}>
                <button
                  type="button"
                  onClick={() => setSelected(skill)}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-[#131315]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-[#ECECEE]">
                      {skill.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-[#6E6975]">
                      {skill.kind} · v{skill.version} · {skill.createdBy} ·{" "}
                      {formatDate(skill.createdAt)}
                    </span>
                  </span>
                  {skill.notes ? (
                    <span className="hidden max-w-[40%] truncate text-[12px] text-[#85858A] md:block">
                      {skill.notes}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function SkillDetail({ row, onBack }: { row: SkillRow; onBack: () => void }) {
  const { data, error, loading } = useSectionData<WorkspaceSkill>(
    () => rpc.workspace.skills.get({ name: row.name, version: row.version }),
    `${row.name}:${row.version}`,
  );
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 text-[12.5px] text-[#85858A] hover:text-[#ECECEE]"
      >
        ← <Trans>All skills</Trans>
      </button>
      <h3 className="text-[15px] font-medium text-[#ECECEE]">{row.name}</h3>
      <p className="mt-1 text-[12px] text-[#6E6975]">
        {row.kind} · v{row.version} · {row.createdBy} · {formatDate(row.createdAt)}
      </p>
      {row.notes ? <p className="mt-2 text-[12.5px] text-[#A6A6AD]">{row.notes}</p> : null}
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <pre className="rk-scroll mt-3 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-[#202023] bg-[#131315] p-4 font-mono text-[12px] leading-relaxed text-[#C9C9CE]">
          {data.content}
        </pre>
      ) : null}
    </div>
  );
}
