import { Trans, useLingui } from "@lingui/react/macro";
import type { ReportGenerateInput, WorkspaceSummary } from "@rakazo/contracts";
import { useState } from "react";
import { BuiButton } from "../../../components/beautiful-ui/primitives";
import { Card, Field, INPUT } from "../bits";

export function reportPreviewRange(kind: "monthly_voice" | "email"): { from: string; to: string } {
  const today = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const end = new Date(today);
  if (kind === "monthly_voice") end.setUTCDate(0);
  else end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  if (kind === "monthly_voice") start.setUTCDate(1);
  else start.setUTCDate(start.getUTCDate() - 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function ReportCreateCard({
  channel,
  busy,
  onGenerate,
}: {
  channel: WorkspaceSummary["channels"][number];
  busy: boolean;
  onGenerate: (input: ReportGenerateInput) => void;
}) {
  const { t } = useLingui();
  const [range, setRange] = useState(() => reportPreviewRange("email"));
  const [audience, setAudience] = useState<"tenant" | "landlord">("tenant");
  return (
    <Card title={channel === "voice" ? t`Voice report` : t`Email campaign report`}>
      <div className="flex flex-wrap items-end gap-3">
        {channel === "voice" ? (
          <Field label={t`Audience`} className="min-w-[120px] flex-1">
            <select
              className={INPUT}
              value={audience}
              onChange={(event) => setAudience(event.target.value as "tenant" | "landlord")}
            >
              <option value="tenant">{t`Tenants`}</option>
              <option value="landlord">{t`Landlords`}</option>
            </select>
          </Field>
        ) : null}
        <Field label={t`From`} className="min-w-[135px] flex-1">
          <input
            className={INPUT}
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </Field>
        <Field label={t`To`} className="min-w-[135px] flex-1">
          <input
            className={INPUT}
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <BuiButton
          tone="accent"
          disabled={busy || !range.from || !range.to || range.from > range.to}
          onClick={() =>
            onGenerate({
              kind: channel === "voice" ? "voice" : "email",
              ...(channel === "voice" ? { agentType: audience } : {}),
              ...range,
            })
          }
        >
          <Trans>Generate report</Trans>
        </BuiButton>
      </div>
    </Card>
  );
}
