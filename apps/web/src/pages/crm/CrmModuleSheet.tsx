import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  CRM_MODULE_FIELD_TYPES,
  type CrmModule,
  type CrmModuleFieldType,
  type CrmModuleRecord,
} from "@rakazo/contracts";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { type SheetColumn, SheetGrid } from "./SheetGrid";

/**
 * One custom module rendered as a sheet: columns come from the module's field
 * definitions, so the same grid serves Tenants, Agent Logs, or anything else
 * the workspace defines.
 */
export function CrmModuleSheet({
  module,
  onModulesChanged,
}: {
  module: CrmModule;
  onModulesChanged: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [records, setRecords] = useState<CrmModuleRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    const page = await rpc.crm.modules.records.list({ moduleId: module.id, limit: 200 });
    setRecords(page.data);
    setNextCursor(page.nextCursor);
  }, [module.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    const page = await rpc.crm.modules.records.list({
      moduleId: module.id,
      cursor: nextCursor,
      limit: 200,
    });
    setRecords((previous) => [...previous, ...page.data]);
    setNextCursor(page.nextCursor);
  }

  async function commitCell(record: CrmModuleRecord, fieldId: string, value: string) {
    const field = module.fields.find((candidate) => candidate.id === fieldId);
    const outgoing =
      field?.type === "checkbox"
        ? value === t`Yes`
          ? "true"
          : value === t`No`
            ? "false"
            : ""
        : value;
    const updated = await rpc.crm.modules.records.update({
      recordId: record.id,
      values: { [fieldId]: outgoing },
    });
    setRecords((previous) =>
      previous.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    );
  }

  async function deleteRecord(record: CrmModuleRecord) {
    await rpc.crm.modules.records.delete({ recordId: record.id });
    setRecords((previous) => previous.filter((candidate) => candidate.id !== record.id));
  }

  async function deleteModule() {
    await rpc.crm.modules.delete({ moduleId: module.id });
    await onModulesChanged();
  }

  const display = (record: CrmModuleRecord, fieldId: string): string => {
    const field = module.fields.find((candidate) => candidate.id === fieldId);
    const value = record.values[fieldId];
    if (value === undefined || value === null) return "";
    if (field?.type === "checkbox") return value === true || value === "true" ? t`Yes` : t`No`;
    return String(value);
  };

  const columns: SheetColumn<CrmModuleRecord>[] = [
    ...module.fields.map(
      (field): SheetColumn<CrmModuleRecord> => ({
        id: field.id,
        label: field.label,
        width: field.type === "checkbox" ? 90 : field.type === "number" ? 120 : 170,
        editable: true,
        options:
          field.type === "select"
            ? field.options
            : field.type === "checkbox"
              ? [t`Yes`, t`No`]
              : undefined,
        getValue: (record) => display(record, field.id),
      }),
    ),
    {
      id: "__delete",
      label: "",
      width: 44,
      getValue: () => "",
      render: (record) => (
        <button
          type="button"
          aria-label={t`Delete row`}
          onClick={(event) => {
            event.stopPropagation();
            void deleteRecord(record);
          }}
          className="text-[11px] text-[#5F5B69] opacity-0 hover:text-[#F87171] group-hover:opacity-100"
        >
          ✕
        </button>
      ),
    },
  ];

  const firstField = module.fields[0];

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-[#5F5B69] tabular-nums">
          <Plural value={records.length} one="# record" other="# records" />
        </span>
        <button
          type="button"
          onClick={() => setAddingField(true)}
          className="text-[12.5px] text-[#85858A] hover:text-[#ECECEE]"
        >
          <Trans>+ Field</Trans>
        </button>
        <span className="flex-1" />
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-[12.5px]">
            <button
              type="button"
              onClick={() => void deleteModule()}
              className="text-[#F87171] hover:text-[#F87171]"
            >
              <Trans>Confirm delete</Trans>
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="text-[#6E6975] hover:text-[#C9C9CE]"
            >
              <Trans>Cancel</Trans>
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-[12.5px] text-[#6E6975] hover:text-[#F87171]"
          >
            <Trans>Delete module</Trans>
          </button>
        )}
      </div>

      {addingField ? (
        <FieldForm
          onDone={async () => {
            setAddingField(false);
            await onModulesChanged();
          }}
          onCancel={() => setAddingField(false)}
          moduleId={module.id}
        />
      ) : null}

      {module.fields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A2A2E] p-10 text-center">
          <p className="text-[13.5px] text-[#C9C9CE]">
            <Trans>Add a field to start this sheet</Trans>
          </p>
        </div>
      ) : (
        <SheetGrid
          columns={columns}
          rows={records}
          onCommit={(record, column, value) => commitCell(record, column.id, value)}
          quickAddPlaceholder={
            firstField ? t`Type ${firstField.label.toLowerCase()} to add a row` : undefined
          }
          onQuickAdd={async (value) => {
            if (!firstField) return;
            const created = await rpc.crm.modules.records.create({
              moduleId: module.id,
              values: { [firstField.id]: value },
            });
            setRecords((previous) => [...previous, created]);
          }}
        />
      )}

      {nextCursor ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="self-start text-[12.5px] text-[#85858A] hover:text-[#ECECEE]"
        >
          <Trans>Load more</Trans>
        </button>
      ) : null}
    </div>
  );
}

function FieldForm({
  moduleId,
  onDone,
  onCancel,
}: {
  moduleId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CrmModuleFieldType>("text");
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);

  const typeLabels: Record<CrmModuleFieldType, string> = {
    text: t`Text`,
    number: t`Number`,
    date: t`Date`,
    checkbox: t`Checkbox`,
    select: t`Select`,
    email: t`Email`,
    phone: t`Phone`,
    url: t`URL`,
  };

  async function submit() {
    if (!label.trim() || busy) return;
    const parsedOptions = options
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
    if (type === "select" && !parsedOptions.length) return;
    setBusy(true);
    try {
      await rpc.crm.modules.fields.create({
        moduleId,
        label: label.trim(),
        type,
        options: type === "select" ? parsedOptions : [],
      });
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "rounded-lg border border-[#202023] bg-[#0F0F11] px-2.5 py-1.5 text-[12.5px] text-[#ECECEE] outline-none placeholder:text-[#5F5B69] focus:border-[#3A3A40]";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#1C1C1F] bg-[#111113] px-3 py-2.5">
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") onCancel();
        }}
        placeholder={t`Field label`}
        className={inputClass}
        // biome-ignore lint/a11y/noAutofocus: the user just asked to add a field
        autoFocus
      />
      <select
        value={type}
        onChange={(event) => setType(event.target.value as CrmModuleFieldType)}
        className={inputClass}
      >
        {CRM_MODULE_FIELD_TYPES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {typeLabels[candidate]}
          </option>
        ))}
      </select>
      {type === "select" ? (
        <input
          value={options}
          onChange={(event) => setOptions(event.target.value)}
          placeholder={t`Options, comma-separated`}
          className={`${inputClass} min-w-[220px]`}
        />
      ) : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!label.trim() || busy || (type === "select" && !options.trim())}
        className="rounded-full bg-[#F1F1EF] px-3 py-1 text-[12.5px] font-medium text-[#17171A] disabled:opacity-40"
      >
        <Trans>Add field</Trans>
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[12.5px] text-[#6E6975] hover:text-[#C9C9CE]"
      >
        <Trans>Cancel</Trans>
      </button>
    </div>
  );
}
