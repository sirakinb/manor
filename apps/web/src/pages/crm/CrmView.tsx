import { Trans, useLingui } from "@lingui/react/macro";
import type { CrmModule, CrmOverview } from "@rakazo/contracts";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { CrmContacts } from "./CrmContacts";
import { CrmHome } from "./CrmHome";
import { CrmModuleSheet } from "./CrmModuleSheet";
import { CrmPipelineBoard } from "./CrmPipelineBoard";

type CrmTab = "home" | "pipeline" | "contacts" | { moduleId: string };

/**
 * The CRM pane. One dataset feeds all three tabs, so it is loaded here once
 * and every mutation below refreshes it — the surfaces stay consistent
 * without any of them owning the data. Custom modules add their own tabs.
 */
export function CrmView() {
  const { t } = useLingui();
  const [tab, setTab] = useState<CrmTab>("home");
  const [overview, setOverview] = useState<CrmOverview | null>(null);
  const [modules, setModules] = useState<CrmModule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingModule, setCreatingModule] = useState(false);
  const [newModuleName, setNewModuleName] = useState("");
  const [renamingModule, setRenamingModule] = useState<{ id: string; name: string } | null>(null);

  const tabs: Array<{ key: "home" | "pipeline" | "contacts"; label: string }> = [
    { key: "home", label: t`Home` },
    { key: "pipeline", label: t`Pipeline` },
    { key: "contacts", label: t`Contacts` },
  ];

  const refresh = useCallback(async () => {
    try {
      const [next, moduleList] = await Promise.all([rpc.crm.overview(), rpc.crm.modules.list()]);
      // A workspace's first visit gets a ready board, not an empty screen.
      setOverview(next.pipelines.length === 0 ? await rpc.crm.pipelines.seed() : next);
      setModules(moduleList);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not load the CRM`);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshModules = useCallback(async () => {
    const moduleList = await rpc.crm.modules.list();
    setModules(moduleList);
    setTab((current) => {
      if (typeof current === "object" && !moduleList.some((m) => m.id === current.moduleId)) {
        return "home";
      }
      return current;
    });
  }, []);

  async function createModule() {
    const name = newModuleName.trim();
    if (!name) return;
    const module = await rpc.crm.modules.create({
      name,
      fields: [{ label: t`Name`, type: "text", options: [] }],
    });
    setNewModuleName("");
    setCreatingModule(false);
    await refreshModules();
    setTab({ moduleId: module.id });
  }

  async function renameModule() {
    if (!renamingModule) return;
    const name = renamingModule.name.trim();
    setRenamingModule(null);
    if (!name || name === modules.find((m) => m.id === renamingModule.id)?.name) return;
    await rpc.crm.modules.update({ moduleId: renamingModule.id, name });
    await refreshModules();
  }

  const activeModule =
    typeof tab === "object" ? modules.find((module) => module.id === tab.moduleId) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
      <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[13px]">
        <div className="flex min-w-0 items-center gap-5">
          <span className="text-[16px] font-medium tracking-[0.01em] text-[#ECECEE]">CRM</span>
          <div className="rk-scroll flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-[#202023] bg-[#131315] p-1">
            {tabs.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTab(entry.key)}
                className={`shrink-0 rounded-full px-3.5 py-1 text-[13px] transition-colors ${
                  tab === entry.key
                    ? "bg-[#232326] text-[#ECECEE]"
                    : "text-[#85858A] hover:text-[#C9C9CE]"
                }`}
              >
                {entry.label}
              </button>
            ))}
            {modules.map((module) =>
              renamingModule?.id === module.id ? (
                <input
                  key={module.id}
                  value={renamingModule.name}
                  onChange={(event) =>
                    setRenamingModule({ id: module.id, name: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void renameModule();
                    if (event.key === "Escape") setRenamingModule(null);
                  }}
                  onBlur={() => void renameModule()}
                  aria-label={t`Module name`}
                  className="w-[130px] shrink-0 rounded-full bg-[#232326] px-3 py-1 text-[13px] text-[#ECECEE] outline-none"
                  // biome-ignore lint/a11y/noAutofocus: the user just asked to rename the module
                  autoFocus
                />
              ) : (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => setTab({ moduleId: module.id })}
                  onDoubleClick={() => setRenamingModule({ id: module.id, name: module.name })}
                  title={t`Double-click to rename`}
                  className={`shrink-0 rounded-full px-3.5 py-1 text-[13px] transition-colors ${
                    activeModule?.id === module.id
                      ? "bg-[#232326] text-[#ECECEE]"
                      : "text-[#85858A] hover:text-[#C9C9CE]"
                  }`}
                >
                  {module.name}
                </button>
              ),
            )}
            {creatingModule ? (
              <input
                value={newModuleName}
                onChange={(event) => setNewModuleName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createModule();
                  if (event.key === "Escape") {
                    setCreatingModule(false);
                    setNewModuleName("");
                  }
                }}
                onBlur={() => {
                  if (newModuleName.trim()) void createModule();
                  else setCreatingModule(false);
                }}
                placeholder={t`Module name`}
                className="w-[130px] shrink-0 rounded-full bg-[#232326] px-3 py-1 text-[13px] text-[#ECECEE] outline-none placeholder:text-[#5F5B69]"
                // biome-ignore lint/a11y/noAutofocus: the user just asked to name the module
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => setCreatingModule(true)}
                aria-label={t`New module`}
                className="shrink-0 rounded-full px-2.5 py-1 text-[13px] text-[#5F5B69] transition-colors hover:text-[#C9C9CE]"
              >
                +
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-[22px] py-6 text-[13px] text-[#E8A33C]">{error}</p>
        ) : !overview ? (
          <p className="px-[22px] py-6 text-[13px] text-[#6E6975]">
            <Trans>Loading…</Trans>
          </p>
        ) : tab === "home" ? (
          <CrmHome overview={overview} />
        ) : tab === "pipeline" ? (
          <CrmPipelineBoard overview={overview} onChanged={refresh} />
        ) : tab === "contacts" ? (
          <CrmContacts overview={overview} onChanged={refresh} />
        ) : activeModule ? (
          <div className="px-[22px] py-4">
            <CrmModuleSheet
              key={activeModule.id}
              module={activeModule}
              onModulesChanged={refreshModules}
            />
          </div>
        ) : (
          <p className="px-[22px] py-6 text-[13px] text-[#6E6975]">
            <Trans>Loading…</Trans>
          </p>
        )}
      </div>
    </div>
  );
}
