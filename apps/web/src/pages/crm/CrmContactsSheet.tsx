import { Plural, useLingui } from "@lingui/react/macro";
import type { CrmContact, CrmTag } from "@rakazo/contracts";
import { useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import { type SheetColumn, SheetGrid } from "./SheetGrid";

/**
 * Contacts as a sheet. Each cell edit commits through the same update path the
 * drawer uses; a pending overlay keeps the grid instant while the overview
 * refreshes behind it.
 */
export function CrmContactsSheet({
  contacts,
  allTags,
  onChanged,
  onOpenRow,
}: {
  contacts: CrmContact[];
  allTags: CrmTag[];
  onChanged: () => Promise<void>;
  onOpenRow: (contact: CrmContact) => void;
}) {
  const { t } = useLingui();
  const [pending, setPending] = useState<Record<string, string>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const shown = (contact: CrmContact, columnId: string, actual: string) =>
    pending[`${contact.id}:${columnId}`] ?? actual;

  async function commitField(contact: CrmContact, columnId: string, value: string) {
    const key = `${contact.id}:${columnId}`;
    setPending((previous) => ({ ...previous, [key]: value }));
    try {
      const trimmed = value.trim();
      if (columnId === "firstName") {
        if (!trimmed) throw new Error("required");
        await rpc.crm.contacts.update({ contactId: contact.id, firstName: trimmed });
      } else if (columnId === "lastName") {
        await rpc.crm.contacts.update({ contactId: contact.id, lastName: trimmed });
      } else if (columnId === "status") {
        await rpc.crm.contacts.update({
          contactId: contact.id,
          status: value === t`Archived` || value === "archived" ? "archived" : "active",
        });
      } else if (columnId === "tags") {
        const names = [
          ...new Set(
            value
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean),
          ),
        ];
        const tagIds: string[] = [];
        for (const name of names) {
          const existing = allTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
          const tag = existing ?? (await rpc.crm.tags.create({ name }));
          if (!tagIds.includes(tag.id)) tagIds.push(tag.id);
        }
        await rpc.crm.contacts.update({ contactId: contact.id, tagIds });
      } else {
        await rpc.crm.contacts.update({
          contactId: contact.id,
          [columnId]: trimmed || null,
        });
      }
      await onChanged();
    } finally {
      setPending((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  }

  const columns: SheetColumn<CrmContact>[] = [
    {
      id: "firstName",
      label: t`First name`,
      width: 150,
      editable: true,
      getValue: (contact) => shown(contact, "firstName", contact.firstName),
    },
    {
      id: "lastName",
      label: t`Last name`,
      width: 150,
      editable: true,
      getValue: (contact) => shown(contact, "lastName", contact.lastName),
    },
    {
      id: "company",
      label: t`Company`,
      width: 180,
      editable: true,
      getValue: (contact) => shown(contact, "company", contact.company ?? ""),
    },
    {
      id: "email",
      label: t`Email`,
      width: 220,
      editable: true,
      getValue: (contact) => shown(contact, "email", contact.email ?? ""),
    },
    {
      id: "phone",
      label: t`Phone`,
      width: 140,
      editable: true,
      getValue: (contact) => shown(contact, "phone", contact.phone ?? ""),
    },
    {
      id: "status",
      label: t`Status`,
      width: 110,
      editable: true,
      options: [t`Active`, t`Archived`],
      getValue: (contact) =>
        shown(contact, "status", contact.status === "archived" ? t`Archived` : t`Active`),
    },
    {
      id: "tags",
      label: t`Tags`,
      width: 200,
      editable: true,
      getValue: (contact) => contact.tags.map((tag) => tag.name).join(", "),
      render: (contact) => (
        <span className="flex gap-1 overflow-hidden">
          {contact.tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="shrink-0 rounded-full border border-[#2A2A2E] px-1.5 py-px text-[10.5px] text-[#C9C9CE]"
              style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
            >
              {tag.name}
            </span>
          ))}
          {contact.tags.length > 3 ? (
            <span className="text-[10.5px] text-[#5F5B69]">+{contact.tags.length - 3}</span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <SheetGrid
        columns={columns}
        rows={contacts}
        onCommit={(contact, column, value) => commitField(contact, column.id, value)}
        onOpenRow={onOpenRow}
        quickAddPlaceholder={t`Type a name to add a contact`}
        onQuickAdd={async (value) => {
          const [firstName, ...rest] = value.split(/\s+/);
          if (!firstName) return;
          await rpc.crm.contacts.create({ firstName, lastName: rest.join(" ") });
          await onChanged();
        }}
      />
      <p className="text-[11.5px] text-[#5F5B69] tabular-nums">
        <Plural value={contacts.length} one="# contact" other="# contacts" />
      </p>
    </div>
  );
}
