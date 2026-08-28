import { Trans, useLingui } from "@lingui/react/macro";
import type { CrmContact, CrmOverview, CrmTag } from "@rakazo/contracts";
import { useMemo, useState } from "react";
import { rpc } from "../../lib/rpc";
import { formatMoney } from "./theme";

/**
 * The people. A data-dense table with search and tags, and a drawer holding
 * everything about one person — fields, tags, and their deals.
 */
export function CrmContacts({
  overview,
  onChanged,
}: {
  overview: CrmOverview;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const contacts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return overview.contacts.filter((contact) => {
      if (!showArchived && contact.status === "archived") return false;
      if (!needle) return true;
      const haystack = [
        contact.firstName,
        contact.lastName,
        contact.email ?? "",
        contact.company ?? "",
        ...contact.tags.map((tag) => tag.name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [overview.contacts, search, showArchived]);

  const open = openId ? overview.contacts.find((contact) => contact.id === openId) : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 px-[22px] py-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#202023] bg-[#131315] px-3 py-1.5">
            <span className="text-[#5F5B69]">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t`Search people, companies, tags`}
              className="w-full bg-transparent text-[13.5px] text-[#ECECEE] outline-none placeholder:text-[#5F5B69]"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] text-[#6E6975]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            <Trans>Archived</Trans>
          </label>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full bg-[#F1F1EF] px-3.5 py-1.5 text-[13px] font-medium text-[#17171A]"
          >
            <Trans>New contact</Trans>
          </button>
        </div>

        {contacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#2A2A2E] p-12 text-center">
            <p className="text-[14px] font-medium text-[#C9C9CE]">
              {search ? <Trans>Nobody matches that search</Trans> : <Trans>No contacts yet</Trans>}
            </p>
            {!search ? (
              <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[#6E6975]">
                <Trans>Everyone your business talks to lives here. Add the first one.</Trans>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#1C1C1F]">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#1C1C1F] bg-[#111113] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5F5B69]">
                  <th className="px-4 py-2.5">
                    <Trans>Name</Trans>
                  </th>
                  <th className="px-4 py-2.5">
                    <Trans>Company</Trans>
                  </th>
                  <th className="hidden px-4 py-2.5 xl:table-cell">
                    <Trans>Email</Trans>
                  </th>
                  <th className="px-4 py-2.5">
                    <Trans>Tags</Trans>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#161618]">
                {contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    onClick={() => setOpenId(contact.id)}
                    className={`cursor-pointer transition-colors hover:bg-[#131315] ${
                      openId === contact.id ? "bg-[#131315]" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#232326] text-[10.5px] font-semibold text-[#C9C9CE]">
                          {initials(contact)}
                        </span>
                        <span
                          className={`truncate text-[13px] font-medium ${
                            contact.status === "archived"
                              ? "text-[#6E6975] line-through"
                              : "text-[#ECECEE]"
                          }`}
                        >
                          {contact.firstName} {contact.lastName}
                        </span>
                      </div>
                    </td>
                    <td className="truncate px-4 py-2.5 text-[13px] text-[#85858A]">
                      {contact.company ?? "—"}
                    </td>
                    <td className="hidden truncate px-4 py-2.5 text-[13px] text-[#85858A] xl:table-cell">
                      {contact.email ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.slice(0, 3).map((tag) => (
                          <TagChip key={tag.id} tag={tag} />
                        ))}
                        {contact.tags.length > 3 ? (
                          <span className="text-[11px] text-[#5F5B69]">
                            +{contact.tags.length - 3}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open ? (
        <ContactDrawer
          key={open.id}
          contact={open}
          overview={overview}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
        />
      ) : null}
      {creating ? (
        <ContactDrawer
          contact={null}
          overview={overview}
          onClose={() => setCreating(false)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function initials(contact: { firstName: string; lastName: string }): string {
  return `${contact.firstName[0] ?? ""}${contact.lastName[0] ?? ""}`.toUpperCase() || "?";
}

function TagChip({ tag }: { tag: CrmTag }) {
  return (
    <span
      className="rounded-full border border-[#2A2A2E] px-2 py-0.5 text-[11px] text-[#C9C9CE]"
      style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
    >
      {tag.name}
    </span>
  );
}

// A stable ref identity, so React attaches it once on mount instead of
// re-running it (and stealing focus) on every keystroke's re-render.
function focusOnMount(node: HTMLInputElement | null) {
  node?.focus();
}

const fieldClass =
  "w-full rounded-lg border border-[#202023] bg-[#0F0F11] px-3 py-2 text-[13.5px] text-[#ECECEE] outline-none placeholder:text-[#5F5B69] focus:border-[#3A3A40]";

/** Create (contact === null) and edit share one drawer, like one address book card. */
function ContactDrawer({
  contact,
  overview,
  onClose,
  onChanged,
}: {
  contact: CrmContact | null;
  overview: CrmOverview;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [form, setForm] = useState({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    company: contact?.company ?? "",
    notes: contact?.notes ?? "",
  });
  const [tagIds, setTagIds] = useState<string[]>(contact?.tags.map((tag) => tag.id) ?? []);
  const [newTag, setNewTag] = useState("");
  const [busy, setBusy] = useState(false);

  const deals = contact ? overview.deals.filter((deal) => deal.contactId === contact.id) : [];

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function addTag() {
    const name = newTag.trim();
    if (!name) return;
    const tag = await rpc.crm.tags.create({ name }).catch(() => null);
    if (tag) {
      setTagIds((previous) => (previous.includes(tag.id) ? previous : [...previous, tag.id]));
      setNewTag("");
      await onChanged();
    }
  }

  async function save() {
    if (!form.firstName.trim() || busy) return;
    setBusy(true);
    try {
      if (contact) {
        await rpc.crm.contacts.update({
          contactId: contact.id,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          notes: form.notes.trim() || null,
          tagIds,
        });
      } else {
        await rpc.crm.contacts.create({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          company: form.company.trim() || undefined,
          notes: form.notes.trim() || undefined,
          tagIds,
        });
      }
      await onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(archived: boolean) {
    if (!contact) return;
    await rpc.crm.contacts.update({
      contactId: contact.id,
      status: archived ? "archived" : "active",
    });
    await onChanged();
    onClose();
  }

  async function remove() {
    if (!contact) return;
    await rpc.crm.contacts.delete({ contactId: contact.id });
    await onChanged();
    onClose();
  }

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-[#141416] bg-[#101012]">
      <div className="flex items-center justify-between border-b border-[#141416] px-5 py-[15px]">
        <span className="text-[14px] font-medium text-[#ECECEE]">
          {contact ? <Trans>Contact</Trans> : <Trans>New contact</Trans>}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[#85858A] hover:text-[#ECECEE]"
          aria-label={t`Close`}
        >
          ✕
        </button>
      </div>

      <div className="rk-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-2.5">
          <input
            ref={contact ? undefined : focusOnMount}
            value={form.firstName}
            onChange={(event) => set("firstName", event.target.value)}
            placeholder={t`First name`}
            className={fieldClass}
          />
          <input
            value={form.lastName}
            onChange={(event) => set("lastName", event.target.value)}
            placeholder={t`Last name`}
            className={fieldClass}
          />
        </div>
        <input
          value={form.company}
          onChange={(event) => set("company", event.target.value)}
          placeholder={t`Company`}
          className={fieldClass}
        />
        <input
          value={form.email}
          onChange={(event) => set("email", event.target.value)}
          placeholder={t`Email`}
          className={fieldClass}
        />
        <input
          value={form.phone}
          onChange={(event) => set("phone", event.target.value)}
          placeholder={t`Phone`}
          className={fieldClass}
        />
        <textarea
          value={form.notes}
          onChange={(event) => set("notes", event.target.value)}
          placeholder={t`Notes`}
          rows={3}
          className={`${fieldClass} resize-none`}
        />

        <div>
          <p className="mb-1.5 text-[12px] font-medium text-[#85858A]">
            <Trans>Tags</Trans>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {overview.tags.map((tag) => {
              const active = tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() =>
                    setTagIds((previous) =>
                      active ? previous.filter((id) => id !== tag.id) : [...previous, tag.id],
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                    active
                      ? "border-[var(--rk-accent)] text-[var(--rk-accent-soft)]"
                      : "border-[#2A2A2E] text-[#6E6975] hover:text-[#C9C9CE]"
                  }`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addTag();
              }}
              placeholder={t`New tag`}
              className={fieldClass}
            />
            <button
              type="button"
              onClick={() => void addTag()}
              disabled={!newTag.trim()}
              className="shrink-0 text-[13px] text-[#85858A] hover:text-[#C9C9CE] disabled:opacity-40"
            >
              <Trans>Add</Trans>
            </button>
          </div>
        </div>

        {deals.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-[#85858A]">
              <Trans>Deals</Trans>
            </p>
            <div className="space-y-1.5">
              {deals.map((deal) => (
                <div
                  key={deal.id}
                  className="flex items-center justify-between rounded-lg border border-[#1C1C1F] bg-[#131315] px-3 py-2"
                >
                  <span className="truncate text-[12.5px] text-[#C9C9CE]">{deal.title}</span>
                  <span className="text-[12.5px] font-medium text-[#ECECEE] tabular-nums">
                    {formatMoney(deal.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-[#141416] px-5 py-3.5">
        <div className="flex items-center justify-between">
          {contact ? (
            <div className="flex items-center gap-3 text-[12.5px]">
              <button
                type="button"
                onClick={() => void setArchived(contact.status !== "archived")}
                className="text-[#6E6975] hover:text-[#C9C9CE]"
              >
                {contact.status === "archived" ? <Trans>Restore</Trans> : <Trans>Archive</Trans>}
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                className="text-[#F87171]/70 hover:text-[#F87171]"
              >
                <Trans>Delete</Trans>
              </button>
            </div>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={!form.firstName.trim() || busy}
            onClick={() => void save()}
            className="rounded-full bg-[#F1F1EF] px-4 py-1.5 text-[13px] font-medium text-[#17171A] disabled:opacity-40"
          >
            {contact ? <Trans>Save</Trans> : <Trans>Create</Trans>}
          </button>
        </div>
      </div>
    </aside>
  );
}
