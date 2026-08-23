import type { CrmOverview } from "@rakazo/contracts";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { CrmContacts } from "./CrmContacts";
import { CrmHome } from "./CrmHome";
import { CrmPipelineBoard } from "./CrmPipelineBoard";

type CrmTab = "home" | "pipeline" | "contacts";

const TABS: Array<{ key: CrmTab; label: string }> = [
  { key: "home", label: "Home" },
  { key: "pipeline", label: "Pipeline" },
  { key: "contacts", label: "Contacts" },
];

/**
 * The CRM pane. One dataset feeds all three tabs, so it is loaded here once
 * and every mutation below refreshes it — the surfaces stay consistent
 * without any of them owning the data.
 */
export function CrmView() {
  const [tab, setTab] = useState<CrmTab>("home");
  const [overview, setOverview] = useState<CrmOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await rpc.crm.overview();
      // A workspace's first visit gets a ready board, not an empty screen.
      setOverview(next.pipelines.length === 0 ? await rpc.crm.pipelines.seed() : next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the CRM");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
      <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[13px]">
        <div className="flex items-center gap-5">
          <span className="text-[16px] font-medium tracking-[0.01em] text-[#ECECEE]">CRM</span>
          <div className="flex items-center gap-1 rounded-full border border-[#202023] bg-[#131315] p-1">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTab(entry.key)}
                className={`rounded-full px-3.5 py-1 text-[13px] transition-colors ${
                  tab === entry.key
                    ? "bg-[#232326] text-[#ECECEE]"
                    : "text-[#85858A] hover:text-[#C9C9CE]"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-[22px] py-6 text-[13px] text-[#E8A33C]">{error}</p>
        ) : !overview ? (
          <p className="px-[22px] py-6 text-[13px] text-[#6E6975]">Loading…</p>
        ) : tab === "home" ? (
          <CrmHome overview={overview} />
        ) : tab === "pipeline" ? (
          <CrmPipelineBoard overview={overview} onChanged={refresh} />
        ) : (
          <CrmContacts overview={overview} onChanged={refresh} />
        )}
      </div>
    </div>
  );
}
