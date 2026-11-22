import { Trans, useLingui } from "@lingui/react/macro";
import type { ComputerMode, LocalComputerLiveSession, ThinkingLevel } from "@rakazo/contracts";
import {
  BOT_COMPUTER_MODES,
  BOT_DESCRIPTION_MAX_LENGTH,
  BUILTIN_TOOL_NAMES,
} from "@rakazo/contracts";
import type { ChatModelChoice } from "@rakazo/core";
import { thinkingLevelLabel } from "@rakazo/i18n/thinking-level";
import { Button, OptionSelect, SectionHeading, Switch, Textarea, Toggle } from "@rakazo/ui-web";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useState } from "react";
import { rpc } from "../../../lib/query/rpc";
import { ChatModelPicker } from "../chat/chat-model-picker";

/** Manor: the shared "This Mac" session, read again every few seconds while shown. */
export function useLocalComputerSession(session?: LocalComputerLiveSession | null) {
  const [live, setLive] = useState<LocalComputerLiveSession | null>(session ?? null);

  useEffect(() => {
    setLive(session ?? null);
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const next = await rpc.localComputer.session();
        if (!cancelled) setLive(next);
      } catch {
        /* Team and Private still work without it. */
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return live;
}

export function ComputerModePicker({
  value,
  onChange,
  session,
}: {
  value: ComputerMode;
  onChange: (value: ComputerMode) => void;
  /** Manor: the shared "This Mac" session, offered as a third computer while it is connected. */
  session?: LocalComputerLiveSession | null;
}) {
  const connected = Boolean(useLocalComputerSession(session)?.connected);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {BOT_COMPUTER_MODES.map((mode) => (
          <Toggle
            key={mode}
            variant="outline"
            pressed={value === mode}
            onPressedChange={(pressed) => {
              if (pressed) onChange(mode);
            }}
            className="capitalize aria-pressed:border-foreground/40 aria-pressed:text-foreground"
          >
            {mode === "team" ? <Trans>Team</Trans> : <Trans>Private</Trans>}
          </Toggle>
        ))}
        <Toggle
          variant="outline"
          pressed={value === "local"}
          disabled={!connected}
          data-testid="computer-mode-this-mac"
          onPressedChange={(pressed) => {
            if (pressed && connected) onChange("local");
          }}
          className="col-span-2 aria-pressed:border-foreground/40 aria-pressed:text-foreground"
        >
          <Trans>This Mac</Trans>
        </Toggle>
      </div>
      <p className="mt-2 text-label leading-relaxed text-muted-foreground/80">
        {connected ? (
          <Trans>Shared folder on this laptop, only while desktop is sharing.</Trans>
        ) : (
          <Trans>Open Manor desktop to share this Mac.</Trans>
        )}
      </p>
    </div>
  );
}

/** A panel section: its label, an optional control beside it, then its content. */
export function PanelSection({
  label,
  action,
  children,
}: {
  label: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section>
      <SectionHeading variant="label" className="mb-2 flex min-h-6 items-center justify-between">
        {label}
        {action}
      </SectionHeading>
      {children}
    </section>
  );
}

/** Rows of one card. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-muted/50 px-4 py-1">{children}</div>;
}

export function SwitchRow({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-center justify-between gap-3 text-body text-foreground"
    >
      {label}
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function humanizeTool(name: string) {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The model row and, when the model offers levels, a thinking row under it. */
export function ModelRow({
  ids,
  containerRef,
  choices,
  value,
  onModelChange,
  thinkingOptions,
  thinkingLevel,
  defaultThinkingLevel,
  onThinkingLevelChange,
  loadError,
}: {
  ids: string;
  containerRef: RefObject<HTMLDivElement | null>;
  choices: readonly ChatModelChoice[];
  value: string;
  onModelChange: (key: string) => void;
  thinkingOptions: ThinkingLevel[];
  thinkingLevel: string;
  defaultThinkingLevel: ThinkingLevel;
  onThinkingLevelChange: (level: string) => void;
  /** Manor: says the model choices did not load instead of showing an empty picker. */
  loadError?: string | null;
}) {
  const { t } = useLingui();
  return (
    <>
      <div ref={containerRef}>
        <ChatModelPicker
          id={`${ids}-model`}
          choices={choices}
          value={value}
          onChange={onModelChange}
        />
      </div>
      {loadError ? (
        <p role="alert" className="text-label text-destructive">
          {loadError}
        </p>
      ) : null}
      {thinkingOptions.length ? (
        <label
          htmlFor={`${ids}-thinking`}
          className="flex min-h-12 items-center justify-between gap-3 text-body text-foreground"
        >
          <Trans>Thinking</Trans>
          <OptionSelect
            id={`${ids}-thinking`}
            className="w-fit max-w-2/3"
            value={thinkingLevel}
            onValueChange={onThinkingLevelChange}
            options={[
              { value: "", label: t`Default (${thinkingLevelLabel(defaultThinkingLevel)})` },
              ...thinkingOptions.map((level) => ({
                value: level,
                label: thinkingLevelLabel(level),
              })),
            ]}
          />
        </label>
      ) : null}
    </>
  );
}

/** The voice that reads replies aloud. */
export function VoiceRow({
  ids,
  voices,
  voiceId,
  onVoiceIdChange,
}: {
  ids: string;
  voices: ReadonlyArray<{ id: string; label: string }>;
  voiceId: string;
  onVoiceIdChange: (voiceId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <label
      htmlFor={`${ids}-voice`}
      className="flex min-h-12 items-center justify-between gap-3 text-body text-foreground"
    >
      <Trans>Voice</Trans>
      <OptionSelect
        id={`${ids}-voice`}
        className="w-fit max-w-2/3"
        value={voiceId}
        onValueChange={onVoiceIdChange}
        options={[
          { value: "", label: t`Account default` },
          ...voices.map((voice) => ({ value: voice.id, label: voice.label })),
        ]}
      />
    </label>
  );
}

export function DescriptionGroup({
  ids,
  description,
  onDescriptionChange,
  onCommit,
}: {
  ids: string;
  description: string;
  onDescriptionChange: (description: string) => void;
  /** Saves the description when the field loses focus. */
  onCommit: () => void;
}) {
  const { t } = useLingui();
  return (
    <PanelSection label={t`How other bots see it`}>
      <Textarea
        id={`${ids}-description`}
        aria-label={t`How other bots see it`}
        value={description}
        maxLength={BOT_DESCRIPTION_MAX_LENGTH}
        onChange={(e) => onDescriptionChange(e.target.value)}
        onBlur={onCommit}
        placeholder={t`What this bot is for`}
        rows={2}
        className="min-h-16 max-h-96 resize-none field-sizing-content"
      />
    </PanelSection>
  );
}

export function ToolsGroup({
  ids,
  disabledBuiltinTools,
  onDisable,
  onEnable,
}: {
  ids: string;
  disabledBuiltinTools: string[];
  onDisable: (name: string) => void;
  onEnable: (name: string) => void;
}) {
  const { t } = useLingui();
  return (
    <PanelSection label={t`Tools`}>
      <section data-testid="bot-settings-tools">
        <div className="space-y-2 [&>*]:mt-0">
          <div>
            <OptionSelect
              id={`${ids}-disabled-tools`}
              aria-label={t`Disable a tool`}
              value=""
              onValueChange={(name) => {
                if (name) onDisable(name);
              }}
              options={[
                { value: "", label: t`Disable a tool` },
                ...BUILTIN_TOOL_NAMES.filter((name) => !disabledBuiltinTools.includes(name)).map(
                  (name) => ({ value: name, label: humanizeTool(name) }),
                ),
              ]}
            />
          </div>
          {disabledBuiltinTools.map((toolName) => (
            <div
              key={toolName}
              className="flex min-h-11 items-center justify-between gap-3 text-body"
            >
              <span>{humanizeTool(toolName)}</span>
              <Button
                id={`${ids}-disabled-${toolName}`}
                variant="ghost"
                size="icon-xs"
                aria-label={t`Enable ${humanizeTool(toolName)}`}
                title={t`Enable ${humanizeTool(toolName)}`}
                onClick={() => onEnable(toolName)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </PanelSection>
  );
}
