import { useLingui } from "@lingui/react/macro";
import type { WorkspacePipe } from "@rakazo/contracts";
import { rpc } from "../../../lib/rpc";
import {
  ErrorLine,
  formatDateTime,
  formatNumber,
  Loading,
  PanelHeader,
  pipeTone,
  StatusPill,
  Table,
  useFormatAgeHours,
  useSectionData,
} from "../bits";

const RUN_COLORS: Record<string, string> = {
  success: "#4ADE80",
  error: "#F87171",
  running: "#E8A33C",
};

export function SystemPanel() {
  const { t } = useLingui();
  const formatAgeHours = useFormatAgeHours();
  const { data, error, loading } = useSectionData(() => rpc.workspace.system(), "system");
  const statusLabel: Record<WorkspacePipe["status"], string> = {
    flowing: t`Flowing`,
    overdue: t`Overdue`,
    failing: t`Failing`,
    idle: t`Idle`,
  };

  return (
    <div>
      <PanelHeader title={t`System`} />
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <Loading /> : null}
      {data ? (
        <Table<WorkspacePipe>
          rows={data.pipes}
          rowKey={(pipe) => pipe.key}
          emptyLabel={t`No pipes configured`}
          columns={[
            {
              key: "label",
              label: t`Pipe`,
              width: "26%",
              render: (pipe) => (
                <div>
                  <p className="font-medium text-[#ECECEE]">{pipe.label}</p>
                  <p className="text-[11.5px] text-[#6E6975]">
                    {pipe.source} · {pipe.cadence}
                  </p>
                  {pipe.runs.length ? (
                    <span className="mt-1.5 flex gap-0.5" role="img" aria-label={t`Recent runs`}>
                      {pipe.runs.map((run, index) => (
                        <span
                          key={`${run.startedAt}-${index}`}
                          title={`${run.status} · ${formatDateTime(run.startedAt)}${
                            run.recordsLoaded !== null
                              ? ` · ${formatNumber(run.recordsLoaded)}`
                              : ""
                          }${run.errorMessage ? ` · ${run.errorMessage}` : ""}`}
                          className="h-2 w-2 rounded-[2px]"
                          style={{ backgroundColor: RUN_COLORS[run.status] ?? "#3A3A40" }}
                        />
                      ))}
                    </span>
                  ) : null}
                </div>
              ),
            },
            {
              key: "status",
              label: t`Status`,
              render: (pipe) => (
                <StatusPill tone={pipeTone(pipe.status)}>{statusLabel[pipe.status]}</StatusPill>
              ),
            },
            {
              key: "last",
              label: t`Last signal`,
              nowrap: true,
              render: (pipe) => formatDateTime(pipe.lastAt),
            },
            {
              key: "age",
              label: t`Age`,
              align: "right",
              render: (pipe) => formatAgeHours(pipe.ageHours),
            },
            {
              key: "records",
              label: t`Last records`,
              align: "right",
              render: (pipe) => formatNumber(pipe.lastRecords),
            },
            {
              key: "error",
              label: t`Last error`,
              width: "22%",
              render: (pipe) =>
                pipe.lastError ? (
                  <span className="line-clamp-2 text-[#F87171]">{pipe.lastError}</span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
