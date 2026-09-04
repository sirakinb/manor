import { useLingui } from "@lingui/react/macro";
import type { WorkspaceSummary } from "@rakazo/contracts";
import {
  Activity,
  Droplets,
  FileText,
  KeyRound,
  Mail,
  Phone,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import type { SectionKey } from "./bits";

/** Which rail entries a workspace shows: its channels plus the always-on four. */
export function railSections(workspace: WorkspaceSummary): SectionKey[] {
  const has = (channel: WorkspaceSummary["channels"][number]) =>
    workspace.channels.includes(channel);
  const sections: SectionKey[] = [];
  if (has("voice")) sections.push("voice");
  sections.push("reports");
  if (has("email")) sections.push("email");
  if (has("social")) sections.push("social");
  if (has("leasing")) sections.push("leasing");
  if (has("utilities")) sections.push("utilities");
  sections.push("team", "skills", "system");
  return sections;
}

export function useSectionLabels(): Record<SectionKey, string> {
  const { t } = useLingui();
  return {
    voice: t`Voice`,
    reports: t`Reports`,
    email: t`Email`,
    social: t`Social`,
    leasing: t`Leasing`,
    utilities: t`Utilities`,
    team: t`AI team`,
    skills: t`Skills`,
    system: t`System`,
  };
}

const ICONS: Record<SectionKey, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  voice: Phone,
  reports: FileText,
  email: Mail,
  social: Share2,
  leasing: KeyRound,
  utilities: Droplets,
  team: Users,
  skills: Sparkles,
  system: Activity,
};

export function WorkspaceRail({
  sections,
  active,
  onSelect,
}: {
  sections: SectionKey[];
  active: SectionKey | null;
  onSelect: (section: SectionKey) => void;
}) {
  const { t } = useLingui();
  const labels = useSectionLabels();
  return (
    <nav
      aria-label={t`Workspace sections`}
      className="rk-scroll flex w-[84px] shrink-0 flex-col items-stretch gap-0.5 overflow-y-auto border-l border-[#141416] bg-[#0D0D0E] px-1.5 py-2"
    >
      {sections.map((section) => {
        const Icon = ICONS[section];
        const selected = active === section;
        return (
          <button
            key={section}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(section)}
            className={`flex flex-col items-center gap-1 rounded-[10px] px-1 py-2 text-[10.5px] transition-colors ${
              selected
                ? "bg-[#1A1A1D] text-[#ECECEE]"
                : "text-[#85858A] hover:bg-[#131315] hover:text-[#C9C9CE]"
            }`}
          >
            <Icon size={16} strokeWidth={1.7} />
            <span className="leading-tight">{labels[section]}</span>
          </button>
        );
      })}
    </nav>
  );
}
