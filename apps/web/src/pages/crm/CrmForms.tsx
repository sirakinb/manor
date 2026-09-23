import { Trans, useLingui } from "@lingui/react/macro";
import type { PublicForm, PublicFormInput } from "@rakazo/contracts";
import { useCallback, useEffect, useState } from "react";
import { BuiButton, BuiCard } from "../../components/beautiful-ui/primitives";
import { rpc } from "../../lib/rpc";
import { isoToZonedLocal, zonedLocalToIso } from "../../lib/zoned-time";

type Draft = PublicFormInput & { id?: string };

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
];

const inputClass =
  "w-full rounded-[10px] border border-[#26262A] bg-[#101012] px-3 py-2 text-[14px] text-[#ECECEE] outline-none focus:border-[#4A4A50]";

function blankDraft(kind: Draft["kind"]): Draft {
  return {
    kind,
    slug: "",
    title: "",
    enabled: true,
    crmTag: "",
    allowedOrigins: [],
    message: null,
    notifyEmail: null,
    senderName: null,
    signature: null,
    eventStartsAt: null,
    eventMinutes: kind === "event" ? 60 : null,
    eventTimeZone: kind === "event" ? "America/New_York" : null,
    joinUrl: null,
    bookingUrl: null,
  };
}

function formUrl(slug: string) {
  return `${window.location.origin}/v1/public/forms/${slug}`;
}

/** Owner-only settings for the organization's public signup and scorecard forms. */
export function CrmForms() {
  const { t } = useLingui();
  const [forms, setForms] = useState<PublicForm[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setForms((await rpc.publicForms.list()).forms);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not load forms`);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await rpc.publicForms.save(draft);
      setDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not save the form`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await rpc.publicForms.remove({ id });
      setDraft(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not delete the form`);
    }
  }

  if (draft) {
    return (
      <FormEditor
        draft={draft}
        onChange={setDraft}
        saving={saving}
        error={error}
        onSave={() => void save()}
        onCancel={() => {
          setDraft(null);
          setError(null);
        }}
        onDelete={draft.id ? () => void remove(draft.id!) : undefined}
      />
    );
  }

  return (
    <div className="px-[22px] py-5" data-testid="crm-forms">
      <div className="flex flex-wrap gap-2">
        <BuiButton onClick={() => setDraft(blankDraft("event"))}>
          <Trans>New event signup</Trans>
        </BuiButton>
        <BuiButton onClick={() => setDraft(blankDraft("scorecard"))}>
          <Trans>New scorecard</Trans>
        </BuiButton>
      </div>
      {error ? <p className="mt-3 text-[13px] text-[#E8A33C]">{error}</p> : null}
      {forms === null ? (
        <p className="mt-5 text-[13px] text-[#6E6975]">
          <Trans>Loading…</Trans>
        </p>
      ) : forms.length === 0 ? (
        <p className="mt-5 text-[13px] text-[#6E6975]">
          <Trans>No forms yet.</Trans>
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          {forms.map((form) => (
            <BuiCard key={form.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setDraft(form)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-[14.5px] text-[#ECECEE]">{form.title}</span>
                  <span className="block truncate text-[12.5px] text-[#85858A]">
                    {formUrl(form.slug)}
                  </span>
                </span>
                <span className="shrink-0 text-[12.5px] text-[#85858A]">
                  {form.enabled ? t`Live` : t`Off`} ·{" "}
                  {form.kind === "event" ? t`Event` : t`Scorecard`}
                </span>
              </button>
            </BuiCard>
          ))}
        </div>
      )}
    </div>
  );
}

function FormEditor({
  draft,
  onChange,
  saving,
  error,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { t } = useLingui();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const text = (value: string) => value.trim() || null;
  const zone = draft.eventTimeZone || "America/New_York";
  const zones = TIME_ZONES.includes(zone) ? TIME_ZONES : [zone, ...TIME_ZONES];
  const [timeError, setTimeError] = useState<string | null>(null);
  /** Apply a wall-clock time in a zone, refusing times skipped by a clock change. */
  const setStart = (local: string | null, timeZone: string) => {
    const iso = local ? zonedLocalToIso(local, timeZone) : null;
    if (local && !iso) {
      setTimeError(t`That time is skipped when the clocks change in ${timeZone}. Pick another.`);
      return;
    }
    setTimeError(null);
    set({ eventTimeZone: timeZone, eventStartsAt: iso });
  };

  return (
    <div className="max-w-[640px] px-[22px] py-5" data-testid="crm-form-editor">
      <div className="grid gap-4">
        <Field label={t`Title`}>
          <input
            className={inputClass}
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <Field label={t`Address`} hint={draft.slug ? formUrl(draft.slug) : undefined}>
          <input
            className={inputClass}
            value={draft.slug}
            placeholder="automation-hour"
            onChange={(event) =>
              set({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
            }
          />
        </Field>

        {draft.kind === "event" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_110px]">
              <Field label={t`Starts`}>
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={draft.eventStartsAt ? isoToZonedLocal(draft.eventStartsAt, zone) : ""}
                  onChange={(event) => setStart(event.target.value || null, zone)}
                />
              </Field>
              <Field label={t`Time zone`}>
                <select
                  className={inputClass}
                  value={zone}
                  onChange={(event) =>
                    // Keep the same wall-clock time when switching zones.
                    setStart(
                      draft.eventStartsAt ? isoToZonedLocal(draft.eventStartsAt, zone) : null,
                      event.target.value,
                    )
                  }
                >
                  {zones.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t`Minutes`}>
                <input
                  type="number"
                  min={5}
                  className={inputClass}
                  value={draft.eventMinutes ?? ""}
                  onChange={(event) =>
                    set({ eventMinutes: event.target.value ? Number(event.target.value) : null })
                  }
                />
              </Field>
            </div>
            {timeError ? <p className="text-[13px] text-[#E8A33C]">{timeError}</p> : null}
            <Field label={t`Join link`}>
              <input
                className={inputClass}
                value={draft.joinUrl ?? ""}
                placeholder="https://"
                onChange={(event) => set({ joinUrl: text(event.target.value) })}
              />
            </Field>
            <Field label={t`Email message`}>
              <textarea
                className={`${inputClass} min-h-[72px]`}
                value={draft.message ?? ""}
                onChange={(event) => set({ message: text(event.target.value) })}
              />
            </Field>
          </>
        ) : (
          <Field label={t`Booking link`}>
            <input
              className={inputClass}
              value={draft.bookingUrl ?? ""}
              placeholder="https://"
              onChange={(event) => set({ bookingUrl: text(event.target.value) })}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t`CRM tag`}>
            <input
              className={inputClass}
              value={draft.crmTag}
              onChange={(event) => set({ crmTag: event.target.value })}
            />
          </Field>
          <Field label={t`Notify`}>
            <input
              type="email"
              className={inputClass}
              value={draft.notifyEmail ?? ""}
              onChange={(event) => set({ notifyEmail: text(event.target.value) })}
            />
          </Field>
          <Field label={t`Sender name`}>
            <input
              className={inputClass}
              value={draft.senderName ?? ""}
              onChange={(event) => set({ senderName: text(event.target.value) })}
            />
          </Field>
          <Field label={t`Sign-off`}>
            <input
              className={inputClass}
              value={draft.signature ?? ""}
              onChange={(event) => set({ signature: text(event.target.value) })}
            />
          </Field>
        </div>
        <Field label={t`Allowed websites`} hint={t`One per line`}>
          <textarea
            className={`${inputClass} min-h-[64px]`}
            value={draft.allowedOrigins.join("\n")}
            placeholder="https://"
            onChange={(event) =>
              set({
                allowedOrigins: event.target.value
                  .split(/\s+/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <label className="flex items-center gap-3 text-[14px] text-[#C9C9CE]">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => set({ enabled: event.target.checked })}
          />
          <Trans>Accept submissions</Trans>
        </label>
      </div>

      {error ? <p className="mt-4 text-[13px] text-[#E8A33C]">{error}</p> : null}
      <div className="mt-5 flex items-center gap-2">
        <BuiButton tone="accent" disabled={saving} onClick={onSave}>
          {saving ? t`Saving…` : t`Save`}
        </BuiButton>
        <BuiButton onClick={onCancel}>
          <Trans>Cancel</Trans>
        </BuiButton>
        {onDelete ? (
          <span className="ml-auto">
            <BuiButton onClick={onDelete}>
              <Trans>Delete</Trans>
            </BuiButton>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: every caller passes its input as children
    <label className="grid gap-1.5">
      <span className="text-[12.5px] text-[#85858A]">{label}</span>
      {children}
      {hint ? <span className="truncate text-[12px] text-[#6E6975]">{hint}</span> : null}
    </label>
  );
}
