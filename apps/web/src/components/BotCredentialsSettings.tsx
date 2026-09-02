import { Trans, useLingui } from "@lingui/react/macro";
import type { BotCredential } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

const inputClass =
  "mt-1 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-2.5 text-[14px] text-[#ECECEE] placeholder:text-[#5C5C62]";
const labelClass = "block text-[13px] text-[#85858A]";

type Draft = {
  label: string;
  site: string;
  username: string;
  password: string;
  totpSecret: string;
  notes: string;
};

const emptyDraft: Draft = {
  label: "",
  site: "",
  username: "",
  password: "",
  totpSecret: "",
  notes: "",
};

function draftFrom(credential: BotCredential): Draft {
  return {
    label: credential.label,
    site: credential.site,
    username: credential.username,
    password: "",
    totpSecret: "",
    notes: credential.notes,
  };
}

/**
 * Stored website logins for one bot. Secrets are write-only: the form never
 * shows a stored password or 2FA seed, and leaving those blank on edit keeps them.
 */
export function BotCredentialsSettings({ botId }: { botId: string }) {
  const { t } = useLingui();
  const [rows, setRows] = useState<BotCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await rpc.credentials.list({ botId }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not load credentials`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  function startNew() {
    setDraft(emptyDraft);
    setEditing("new");
    setError(null);
  }

  function startEdit(credential: BotCredential) {
    setDraft(draftFrom(credential));
    setEditing(credential.id);
    setError(null);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editing === "new") {
        await rpc.credentials.create({ botId, ...draft });
      } else if (editing) {
        await rpc.credentials.update({
          credentialId: editing,
          label: draft.label,
          site: draft.site,
          username: draft.username,
          notes: draft.notes,
          // Blank keeps the stored secret; only send what the user typed.
          ...(draft.password ? { password: draft.password } : {}),
          ...(draft.totpSecret ? { totpSecret: draft.totpSecret } : {}),
        });
      }
      setEditing(null);
      setDraft(emptyDraft);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save credential`);
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret(credential: BotCredential, field: "password" | "totpSecret") {
    setError(null);
    try {
      await rpc.credentials.update({ credentialId: credential.id, [field]: "" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not update credential`);
    }
  }

  async function remove(credential: BotCredential) {
    if (!window.confirm(t`Remove "${credential.label}"?`)) return;
    setError(null);
    try {
      await rpc.credentials.remove({ credentialId: credential.id });
      if (editing === credential.id) setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not remove credential`);
    }
  }

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <section className="mt-6" aria-label={t`Sign-in credentials`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] text-[#C9C9CE]">
            <Trans>Sign-in credentials</Trans>
          </h3>
          <p className="mt-1 text-[12px] text-[#85858A]">
            <Trans>
              Logins this bot may use on its computer. Passwords and 2FA seeds are stored encrypted
              and typed for the bot, never shown to it.
            </Trans>
          </p>
        </div>
        {editing === null ? (
          <button
            type="button"
            onClick={startNew}
            className="shrink-0 rounded-[11px] border border-[#26262A] px-3 py-1.5 text-[13px] text-[#C9C9CE] hover:border-[#4A4A50]"
          >
            <Trans>Add</Trans>
          </button>
        ) : null}
      </div>

      {loading && rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#5C5C62]">
          <Trans>Loading…</Trans>
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((credential) => (
            <li
              key={credential.id}
              className="rounded-[11px] border border-[#26262A] px-3.5 py-3 text-[13px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-[#ECECEE]">{credential.label}</div>
                  {credential.site ? (
                    <div className="truncate text-[#85858A]">{credential.site}</div>
                  ) : null}
                  {credential.username ? (
                    <div className="truncate text-[#85858A]">{credential.username}</div>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {credential.hasPassword ? (
                      <span className="rounded-full border border-[#26262A] px-2 py-0.5 text-[11px] text-[#A855F7]">
                        <Trans>password</Trans>
                      </span>
                    ) : null}
                    {credential.hasTotp ? (
                      <span className="rounded-full border border-[#26262A] px-2 py-0.5 text-[11px] text-[#A855F7]">
                        <Trans>2FA</Trans>
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(credential)}
                    className="rounded-[9px] px-2 py-1 text-[12px] text-[#C9C9CE] hover:bg-[#1A1A1D]"
                  >
                    <Trans>Edit</Trans>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(credential)}
                    className="rounded-[9px] px-2 py-1 text-[12px] text-[#85858A] hover:bg-[#1A1A1D] hover:text-[#EF4444]"
                  >
                    <Trans>Remove</Trans>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {editing !== null ? (
        <form
          className="mt-3 flex flex-col gap-3 rounded-[11px] border border-[#26262A] p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className={labelClass}>
            <Trans>Label</Trans>
            <input
              className={inputClass}
              placeholder={t`Philly Water portal`}
              required
              maxLength={80}
              autoComplete="off"
              {...field("label")}
            />
          </label>
          <label className={labelClass}>
            <Trans>Site</Trans>
            <input
              className={inputClass}
              placeholder="https://"
              autoComplete="off"
              {...field("site")}
            />
          </label>
          <label className={labelClass}>
            <Trans>Username or email</Trans>
            <input className={inputClass} autoComplete="off" {...field("username")} />
          </label>
          <label className={labelClass}>
            <Trans>Password</Trans>
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              placeholder={
                editing !== "new" && rows.find((row) => row.id === editing)?.hasPassword
                  ? t`Stored — leave blank to keep`
                  : ""
              }
              {...field("password")}
            />
          </label>
          <label className={labelClass}>
            <Trans>2FA setup key</Trans>
            <input
              className={inputClass}
              type="password"
              autoComplete="off"
              placeholder={
                editing !== "new" && rows.find((row) => row.id === editing)?.hasTotp
                  ? t`Stored — leave blank to keep`
                  : t`Base32 key or otpauth:// link from the site's authenticator setup`
              }
              {...field("totpSecret")}
            />
          </label>
          <label className={labelClass}>
            <Trans>Notes</Trans>
            <textarea
              className={inputClass}
              rows={2}
              placeholder={t`Security question answers, account number, sign-in hints`}
              {...field("notes")}
            />
          </label>
          {editing !== "new" ? (
            <div className="flex flex-wrap gap-3 text-[12px]">
              {rows.find((row) => row.id === editing)?.hasPassword ? (
                <button
                  type="button"
                  className="text-[#85858A] hover:text-[#EF4444]"
                  onClick={() => {
                    const row = rows.find((item) => item.id === editing);
                    if (row) void clearSecret(row, "password");
                  }}
                >
                  <Trans>Clear stored password</Trans>
                </button>
              ) : null}
              {rows.find((row) => row.id === editing)?.hasTotp ? (
                <button
                  type="button"
                  className="text-[#85858A] hover:text-[#EF4444]"
                  onClick={() => {
                    const row = rows.find((item) => item.id === editing);
                    if (row) void clearSecret(row, "totpSecret");
                  }}
                >
                  <Trans>Clear 2FA key</Trans>
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !draft.label.trim()}
              className="rounded-[11px] border border-[#4A4A50] bg-[#1A1A1D] px-3.5 py-2 text-[13px] text-[#ECECEE] disabled:opacity-50"
            >
              {editing === "new" ? <Trans>Add credential</Trans> : <Trans>Save</Trans>}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft(emptyDraft);
                setError(null);
              }}
              className="rounded-[11px] px-3.5 py-2 text-[13px] text-[#85858A]"
            >
              <Trans>Cancel</Trans>
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="mt-2 text-[13px] text-[#EF4444]">{error}</p> : null}
    </section>
  );
}
