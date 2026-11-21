import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { Bell, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { BrandLogo } from "../../components/BrandLogo";
import { IconTooltip } from "../../components/IconTooltip";
import { brand } from "../../lib/brand";
import { desktopBridge } from "../../lib/desktop";
import type { Panel } from "../../lib/right-panel-state";
import { WindowChrome } from "../WindowChrome";
import { BotCreatePicker } from "./bot-picker";

export function SidebarHeader({
  mini = false,
  activityMode,
  toggleActivityMode,
  setBotsSidebarCollapsedPref,
  bots,
  setMobileSidebarOpen,
  setPanel,
  navigate,
  setNewSpaceOpen,
  setPickerInfoTopic,
}: {
  mini?: boolean;
  activityMode: boolean;
  toggleActivityMode: () => void;
  setBotsSidebarCollapsedPref: (collapsed: boolean) => void;
  bots: Bot[];
  setMobileSidebarOpen: (open: boolean) => void;
  setPanel: (panel: Panel) => void;
  navigate: (path: string) => void;
  setNewSpaceOpen: (open: boolean) => void;
  setPickerInfoTopic: (topic: "group" | "space") => void;
}) {
  const { t } = useLingui();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const hasWindowChrome = Boolean(desktopBridge());
  const toggleLabel = mini ? t`Show bots` : t`Minimize bots`;
  return (
    <div
      className={`app-drag flex items-center ${mini ? `flex-col gap-2 px-0 pb-2 ${hasWindowChrome ? "pt-4" : "pt-2"}` : "justify-between px-[18px] pb-3 pt-4"}`}
    >
      {mini ? (
        hasWindowChrome ? (
          <WindowChrome />
        ) : null
      ) : (
        // Manor shows the brand's mark (and its name, unless the logo is a wordmark) here.
        <div className="flex items-center gap-2.5">
          <WindowChrome />
          <BrandLogo
            className={
              brand.logo.viewBox
                ? "h-[42px] w-[74px]"
                : brand.logo.wide
                  ? "h-[22px] w-auto"
                  : "h-[22px] w-[22px]"
            }
          />
          {brand.logo.wide ? null : (
            <span className="rk-wordmark text-[14px] text-[#F1F0F3]">
              {brand.name.toUpperCase()}
            </span>
          )}
        </div>
      )}
      <div className={`relative flex items-center ${mini ? "flex-col gap-0.5" : "gap-2.5"}`}>
        <IconTooltip label={t`Activity`}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Activity`}
            aria-pressed={activityMode}
            data-activity-mode={activityMode ? "on" : "off"}
            onClick={toggleActivityMode}
            className={`app-no-drag flex h-7 w-7 items-center justify-center rounded-full ${
              activityMode
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground/70 hover:text-foreground/75"
            }`}
          >
            <Bell
              size={15}
              strokeWidth={1.8}
              fill={activityMode ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </Button>
        </IconTooltip>
        <IconTooltip label={toggleLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag hidden h-7 w-7 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground/75 md:inline-flex"
            aria-label={toggleLabel}
            data-testid={mini ? "restore-bots-sidebar" : "minimize-bots-sidebar"}
            onClick={() => setBotsSidebarCollapsedPref(!mini)}
          >
            {mini ? (
              <PanelLeftOpen size={15} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={15} strokeWidth={1.8} aria-hidden="true" />
            )}
          </Button>
        </IconTooltip>
        <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
          <IconTooltip label={t`Create`}>
            <PopoverTrigger
              className="app-no-drag flex size-7 items-center justify-center rounded-full text-[21px] text-muted-foreground/70 outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t`Create`}
              data-testid="create-menu-trigger"
            >
              +
            </PopoverTrigger>
          </IconTooltip>
          {/* Unmount with the state change so the panel it opens never coexists with the menu. */}
          {createMenuOpen ? (
            <PopoverContent
              align="end"
              className="app-no-drag w-auto gap-0 overflow-hidden p-0 data-closed:animate-none"
            >
              <BotCreatePicker
                bots={bots}
                onCreateBot={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPanel("create");
                }}
                onOpenBot={(id) => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  navigate(`/app/${id}`);
                }}
                onCreateGroup={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPanel("create-group");
                }}
                onCreateSpace={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setNewSpaceOpen(true);
                }}
                onShowGroupInfo={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPickerInfoTopic("group");
                }}
                onShowSpaceInfo={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPickerInfoTopic("space");
                }}
              />
            </PopoverContent>
          ) : null}
        </Popover>
      </div>
    </div>
  );
}
