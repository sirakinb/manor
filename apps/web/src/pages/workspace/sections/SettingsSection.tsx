import { Trans, useLingui } from "@lingui/react/macro";
import {
  WORKSPACE_CREDENTIAL_PROVIDERS,
  type WorkspaceCredentialProvider,
  type WorkspaceCredentialRow,
  type WorkspaceSettings,
  type WorkspaceSettingsUpdate,
  type WorkspaceSummary,
} from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { BuiButton } from "../../../components/beautiful-ui/primitives";
import { rpc } from "../../../lib/rpc";
import {
  Card,
  CLICKABLE_TEXT,
  ConfirmCard,
  ErrorLine,
  errorMessage,
  Field,
  formatDateTime,
  INPUT,
  Loading,
  PageHeader,
  StatusPill,
  Toggle,
  useSectionData,
} from "../bits";

/** Which write-only fields each provider takes; values never come back. */
const PROVIDER_FIELDS: Record<WorkspaceCredentialProvider, string[]> = {
  buildium: ["clientId", "clientSecret"],
  twilio: ["accountSid", "authToken", "fromNumber"],
  "zoho-crm": ["clientId", "clientSecret", "refreshToken"],
  "zoho-campaigns": ["clientId", "clientSecret", "refreshToken"],
  instagram: ["pageToken", "igUserId"],
  gmail: ["clientId", "clientSecret", "refreshToken"],
  openai: ["apiKey", "model"],
  openrouter: ["apiKey", "model"],
  smtp: ["url", "from"],
};

const PROVIDER_NAMES: Record<WorkspaceCredentialProvider, string> = {
  buildium: "Buildium",
  twilio: "Twilio",
  "zoho-crm": "Zoho CRM",
  "zoho-campaigns": "Zoho Campaigns",
  instagram: "Instagram",
  gmail: "Gmail",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  smtp: "SMTP",
};

export function SettingsSection({
  workspace,
  eyebrow,
}: {
  workspace: WorkspaceSummary;
  eyebrow: string;
}) {
  const { t } = useLingui();
  const settings = useSectionData(() => rpc.workspace.settings.get(), "settings");
  const credentials = useSectionData(() => rpc.workspace.credentials.list(), "credentials");

  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={t`Settings`} subtitle={workspace.name} />
      {settings.error ? <ErrorLine message={settings.error} /> : null}
      {settings.loading ? <Loading /> : null}
      {settings.data ? (
        <div className="space-y-4">
          <ReportsCard settings={settings.data} onSaved={settings.setData} />
          <UtilitiesCard settings={settings.data} onSaved={settings.setData} />
        </div>
      ) : null}
      <div className="mt-4">
        {credentials.error ? <ErrorLine message={credentials.error} /> : null}
        {credentials.data ? (
          <CredentialsCard rows={credentials.data} onChanged={credentials.reload} />
        ) : null}
      </div>
    </div>
  );
}

function useSaver<T extends object>(
  save: (patch: T) => Promise<WorkspaceSettings>,
  onSaved: (next: WorkspaceSettings) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { t } = useLingui();
  return {
    busy,
    error,
    savedAt,
    run: async (patch: T) => {
      setBusy(true);
      setError(null);
      try {
        onSaved(await save(patch));
        setSavedAt(Date.now());
      } catch (cause) {
        setError(errorMessage(cause, t`Could not save`));
      } finally {
        setBusy(false);
      }
    },
  };
}

function SaveRow({
  busy,
  error,
  savedAt,
  onSave,
}: {
  busy: boolean;
  error: string | null;
  savedAt: number | null;
  onSave: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <span className="text-[12.5px] text-[#E8A33C]">{error ?? ""}</span>
      <span className="flex items-center gap-3">
        {savedAt && !error ? (
          <span className="text-[12px] text-[#4ADE80]">
            <Trans>Saved</Trans>
          </span>
        ) : null}
        <BuiButton tone="accent" disabled={busy} onClick={onSave}>
          <Trans>Save</Trans>
        </BuiButton>
      </span>
    </div>
  );
}

function ReportsCard({
  settings,
  onSaved,
}: {
  settings: WorkspaceSettings;
  onSaved: (next: WorkspaceSettings) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const saver = useSaver<WorkspaceSettingsUpdate>(
    (patch) => rpc.workspace.settings.update(patch),
    onSaved,
  );
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const weekdays = [
    t`Sunday`,
    t`Monday`,
    t`Tuesday`,
    t`Wednesday`,
    t`Thursday`,
    t`Friday`,
    t`Saturday`,
  ];
  const hourLabel = (hour: number) =>
    new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });

  return (
    <Card title={t`Reports`}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[#ECECEE]">
              <Trans>Monthly voice recap</Trans>
            </span>
            <Toggle
              label={t`Monthly voice recap`}
              checked={draft.monthlyVoiceReportsEnabled}
              onChange={(value) => setDraft({ ...draft, monthlyVoiceReportsEnabled: value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t`Send on`}>
              <select
                className={INPUT}
                value={draft.monthlyVoiceReportDay}
                onChange={(event) =>
                  setDraft({ ...draft, monthlyVoiceReportDay: Number(event.target.value) })
                }
              >
                <option value={0}>{t`Last day of month`}</option>
                {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t`At`}>
              <select
                className={INPUT}
                value={draft.monthlyVoiceReportHour}
                onChange={(event) =>
                  setDraft({ ...draft, monthlyVoiceReportHour: Number(event.target.value) })
                }
              >
                {hours.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[#ECECEE]">
              <Trans>Weekly email recap</Trans>
            </span>
            <Toggle
              label={t`Weekly email recap`}
              checked={draft.weeklyEmailReportsEnabled}
              onChange={(value) => setDraft({ ...draft, weeklyEmailReportsEnabled: value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t`Send on`}>
              <select
                className={INPUT}
                value={draft.weeklyEmailReportDay}
                onChange={(event) =>
                  setDraft({ ...draft, weeklyEmailReportDay: Number(event.target.value) })
                }
              >
                {weekdays.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t`At`}>
              <select
                className={INPUT}
                value={draft.weeklyEmailReportHour}
                onChange={(event) =>
                  setDraft({ ...draft, weeklyEmailReportHour: Number(event.target.value) })
                }
              >
                {hours.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <Field label={t`Recipients`}>
          <input
            className={INPUT}
            value={draft.reportRecipient ?? ""}
            placeholder="owner@example.com, ops@example.com"
            onChange={(event) => setDraft({ ...draft, reportRecipient: event.target.value })}
          />
        </Field>
        <Field label={t`Draft reviewer`}>
          <input
            className={INPUT}
            type="email"
            value={draft.reportReviewerEmail ?? ""}
            onChange={(event) => setDraft({ ...draft, reportReviewerEmail: event.target.value })}
          />
        </Field>
      </div>
      <SaveRow
        {...saver}
        onSave={() =>
          void saver.run({
            monthlyVoiceReportsEnabled: draft.monthlyVoiceReportsEnabled,
            monthlyVoiceReportDay: draft.monthlyVoiceReportDay,
            monthlyVoiceReportHour: draft.monthlyVoiceReportHour,
            weeklyEmailReportsEnabled: draft.weeklyEmailReportsEnabled,
            weeklyEmailReportDay: draft.weeklyEmailReportDay,
            weeklyEmailReportHour: draft.weeklyEmailReportHour,
            reportRecipient: draft.reportRecipient?.trim() || null,
            reportReviewerEmail: draft.reportReviewerEmail?.trim() || null,
          })
        }
      />
    </Card>
  );
}

function UtilitiesCard({
  settings,
  onSaved,
}: {
  settings: WorkspaceSettings;
  onSaved: (next: WorkspaceSettings) => void;
}) {
  const { t } = useLingui();
  const [glAccount, setGlAccount] = useState(
    settings.waterGlAccountId === null ? "" : String(settings.waterGlAccountId),
  );
  const [description, setDescription] = useState(settings.buildiumChargeDescription);
  useEffect(() => {
    setGlAccount(settings.waterGlAccountId === null ? "" : String(settings.waterGlAccountId));
    setDescription(settings.buildiumChargeDescription);
  }, [settings]);
  const saver = useSaver<WorkspaceSettingsUpdate>(
    (patch) => rpc.workspace.settings.update(patch),
    onSaved,
  );
  return (
    <Card title={t`Utilities`}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t`Water GL account`}>
          <input
            className={INPUT}
            inputMode="numeric"
            pattern="[0-9]*"
            value={glAccount}
            onChange={(event) => setGlAccount(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label={t`Charge description`}>
          <input
            className={INPUT}
            maxLength={120}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
      <SaveRow
        {...saver}
        onSave={() =>
          void saver.run({
            waterGlAccountId: glAccount === "" ? null : Number(glAccount),
            ...(description.trim() ? { buildiumChargeDescription: description.trim() } : {}),
          })
        }
      />
    </Card>
  );
}

function CredentialsCard({
  rows,
  onChanged,
}: {
  rows: WorkspaceCredentialRow[];
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return (
    <Card title={t`Credentials`}>
      <ul className="divide-y divide-[#1C1C1F]">
        {WORKSPACE_CREDENTIAL_PROVIDERS.map((provider) => (
          <CredentialRow
            key={provider}
            provider={provider}
            row={byProvider.get(provider) ?? null}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </Card>
  );
}

function CredentialRow({
  provider,
  row,
  onChanged,
}: {
  provider: WorkspaceCredentialProvider;
  row: WorkspaceCredentialRow | null;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [label, setLabel] = useState(row?.label ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = PROVIDER_FIELDS[provider];

  async function save() {
    const filled = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value.trim() !== ""),
    );
    if (Object.keys(filled).length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpc.workspace.credentials.set({
        provider,
        label: label.trim() || undefined,
        fields: filled,
      });
      setValues({});
      setEditing(false);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, t`Could not save`));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await rpc.workspace.credentials.remove({ provider });
      setRemoving(false);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, t`Could not remove`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-[#ECECEE]">
            {row?.label || PROVIDER_NAMES[provider]}
          </span>
          {row ? (
            <>
              {row.fields.map((field) => (
                <StatusPill key={field} tone="good">
                  {field}
                </StatusPill>
              ))}
              <span className="text-[11.5px] text-[#6E6975]">{formatDateTime(row.updatedAt)}</span>
            </>
          ) : (
            <StatusPill tone="dim">{t`Not set`}</StatusPill>
          )}
        </div>
        <div className="flex items-center gap-3 text-[12.5px]">
          <button
            type="button"
            onClick={() => {
              setEditing((value) => !value);
              setRemoving(false);
            }}
            className={`text-[#85858A] ${CLICKABLE_TEXT}`}
          >
            {editing ? t`Cancel` : row ? t`Edit` : t`Add`}
          </button>
          {row ? (
            <button
              type="button"
              onClick={() => {
                setRemoving((value) => !value);
                setEditing(false);
              }}
              className={`text-[#85858A] ${CLICKABLE_TEXT}`}
            >
              <Trans>Remove</Trans>
            </button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label={t`Label`}>
            <input
              className={INPUT}
              maxLength={120}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          {fields.map((field) => (
            <Field key={field} label={field}>
              <input
                className={INPUT}
                type={
                  field === "fromNumber" ||
                  field === "from" ||
                  field === "url" ||
                  field === "model" ||
                  field === "igUserId"
                    ? "text"
                    : "password"
                }
                autoComplete="off"
                value={values[field] ?? ""}
                placeholder={row?.fields.includes(field) ? "••••••••" : ""}
                onChange={(event) => setValues({ ...values, [field]: event.target.value })}
              />
            </Field>
          ))}
          <div className="flex items-end justify-end gap-2 md:col-span-3">
            {error ? <span className="mr-auto text-[12.5px] text-[#E8A33C]">{error}</span> : null}
            <BuiButton tone="accent" disabled={busy} onClick={() => void save()}>
              <Trans>Save</Trans>
            </BuiButton>
          </div>
        </div>
      ) : null}
      {removing ? (
        <div className="mt-3">
          <ConfirmCard
            title={t`Remove the ${PROVIDER_NAMES[provider]} credential?`}
            confirmLabel={t`Remove`}
            cancelLabel={t`Cancel`}
            tone="neutral"
            busy={busy}
            error={error}
            onConfirm={() => void remove()}
            onCancel={() => setRemoving(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
