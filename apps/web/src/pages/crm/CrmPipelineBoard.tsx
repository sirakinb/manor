import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { CrmContact, CrmDeal, CrmOverview, CrmStage } from "@rakazo/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import { formatMoney, formatMoneyShort, STATUS_COLORS, stageColor, withAlpha } from "./theme";

/**
 * The kanban board. Drags update local state immediately and tell the server
 * afterwards — a card must never snap back while the request is in flight.
 */
export function CrmPipelineBoard({
  overview,
  onChanged,
}: {
  overview: CrmOverview;
  onChanged: () => Promise<void>;
}) {
  const [pipelineId, setPipelineId] = useState(overview.pipelines[0]?.id ?? "");
  const [creating, setCreating] = useState<null | "deal" | "pipeline">(null);
  const [editing, setEditing] = useState<CrmDeal | null>(null);
  const pipeline =
    overview.pipelines.find((entry) => entry.id === pipelineId) ?? overview.pipelines[0];

  const stageIds = useMemo(
    () => new Set((pipeline?.stages ?? []).map((stage) => stage.id)),
    [pipeline],
  );
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  useEffect(() => {
    setDeals(overview.deals.filter((deal) => stageIds.has(deal.stageId)));
  }, [overview.deals, stageIds]);

  const contactById = useMemo(
    () => new Map(overview.contacts.map((contact) => [contact.id, contact])),
    [overview.contacts],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const dragFromStage = useRef<string | null>(null);
  const [activeDeal, setActiveDeal] = useState<CrmDeal | null>(null);

  const stageForDeal = useCallback(
    (dealId: string) => deals.find((deal) => deal.id === dealId)?.stageId,
    [deals],
  );

  const resolveStage = useCallback(
    (overId: string) => (stageIds.has(overId) ? overId : stageForDeal(overId)),
    [stageIds, stageForDeal],
  );

  function handleDragStart(event: DragStartEvent) {
    const dealId = String(event.active.id);
    dragFromStage.current = stageForDeal(dealId) ?? null;
    setActiveDeal(deals.find((deal) => deal.id === dealId) ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!event.over) return;
    const dealId = String(event.active.id);
    const target = resolveStage(String(event.over.id));
    const current = stageForDeal(dealId);
    if (!target || !current || target === current) return;
    setDeals((previous) =>
      previous.map((deal) => (deal.id === dealId ? { ...deal, stageId: target } : deal)),
    );
  }

  function handleDragCancel() {
    dragFromStage.current = null;
    setActiveDeal(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const from = dragFromStage.current;
    dragFromStage.current = null;
    setActiveDeal(null);
    if (!event.over) return;
    const dealId = String(event.active.id);
    const target = resolveStage(String(event.over.id));
    if (!target) return;
    setDeals((previous) =>
      previous.map((deal) => (deal.id === dealId ? { ...deal, stageId: target } : deal)),
    );
    if (from && from !== target) {
      rpc.crm.deals
        .move({ dealId, stageId: target })
        .then(() => onChanged())
        .catch(() => onChanged());
    }
  }

  async function setStatus(dealId: string, status: "open" | "won" | "lost") {
    await rpc.crm.deals.update({ dealId, status }).catch(() => null);
    await onChanged();
  }

  async function removeDeal(dealId: string) {
    setDeals((previous) => previous.filter((deal) => deal.id !== dealId));
    await rpc.crm.deals.delete({ dealId }).catch(() => null);
    await onChanged();
  }

  if (!pipeline) return null;

  return (
    <div className="flex h-full min-h-0 flex-col px-[22px] py-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {overview.pipelines.length > 1 ? (
            <select
              value={pipeline.id}
              onChange={(event) => setPipelineId(event.target.value)}
              className="rounded-lg border border-[#202023] bg-[#131315] px-3 py-1.5 text-[13px] text-[#C9C9CE] outline-none"
            >
              {overview.pipelines.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[13.5px] font-medium text-[#C9C9CE]">{pipeline.name}</span>
          )}
          <button
            type="button"
            onClick={() => setCreating("pipeline")}
            className="text-[12.5px] text-[#6E6975] hover:text-[#C9C9CE]"
          >
            <Trans>+ New pipeline</Trans>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setCreating("deal")}
          className="rounded-full bg-[#F1F1EF] px-3.5 py-1.5 text-[13px] font-medium text-[#17171A]"
        >
          <Trans>New deal</Trans>
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-4">
          {pipeline.stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={deals.filter((deal) => deal.stageId === stage.id)}
              contactById={contactById}
              onSetStatus={setStatus}
              onDelete={removeDeal}
              onEdit={setEditing}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDeal ? (
            <DealCardOverlay
              deal={activeDeal}
              contact={activeDeal.contactId ? contactById.get(activeDeal.contactId) : undefined}
              accent={(() => {
                const stage = pipeline.stages.find((entry) => entry.id === activeDeal.stageId);
                return stage ? (stage.color ?? stageColor(stage.position)) : "#5F5B69";
              })()}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {creating === "deal" ? (
        <CreateDealModal
          overview={overview}
          initialPipelineId={pipeline.id}
          onClose={() => setCreating(null)}
          onCreated={async () => {
            setCreating(null);
            await onChanged();
          }}
        />
      ) : null}
      {editing ? (
        <EditDealModal
          deal={editing}
          contacts={overview.contacts}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}
      {creating === "pipeline" ? (
        <CreatePipelineModal
          onClose={() => setCreating(null)}
          onCreated={async (createdId) => {
            setCreating(null);
            await onChanged();
            setPipelineId(createdId);
          }}
        />
      ) : null}
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  contactById,
  onSetStatus,
  onDelete,
  onEdit,
}: {
  stage: CrmStage;
  deals: CrmDeal[];
  contactById: Map<string, CrmContact>;
  onSetStatus: (dealId: string, status: "open" | "won" | "lost") => void;
  onDelete: (dealId: string) => void;
  onEdit: (deal: CrmDeal) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const accent = stage.color ?? stageColor(stage.position);
  const total = deals.reduce((sum, deal) => sum + deal.value, 0);

  return (
    <div
      className={`flex w-[264px] shrink-0 flex-col rounded-xl border transition-colors ${
        isOver ? "border-[#3A3A40] bg-[#161618]" : "border-[#1C1C1F] bg-[#111113]"
      }`}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
        <h3 className="truncate text-[13px] font-medium text-[#DFDFE2]">{stage.name}</h3>
        <span className="text-[12px] text-[#5F5B69] tabular-nums">{deals.length}</span>
        <span className="ml-auto text-[12px] text-[#5F5B69] tabular-nums">
          {formatMoneyShort(total)}
        </span>
      </div>
      <div ref={setNodeRef} className="min-h-[80px] flex-1 space-y-2 px-2.5 pb-2.5">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            contact={deal.contactId ? contactById.get(deal.contactId) : undefined}
            accent={accent}
            onSetStatus={onSetStatus}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
        {deals.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-[#232326] py-6 text-[12px] text-[#5F5B69]">
            <Trans>Drop deals here</Trans>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DealCard({
  deal,
  contact,
  accent,
  onSetStatus,
  onDelete,
  onEdit,
}: {
  deal: CrmDeal;
  contact: CrmContact | undefined;
  accent: string;
  onSetStatus: (dealId: string, status: "open" | "won" | "lost") => void;
  onDelete: (dealId: string) => void;
  onEdit: (deal: CrmDeal) => void;
}) {
  const { t } = useLingui();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ borderLeftColor: accent }}
      className={`group relative cursor-grab rounded-lg border border-[#232326] border-l-2 bg-[#18181B] p-3 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-[#ECECEE]">{deal.title}</p>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMenuOpen((open) => !open)}
          className="shrink-0 text-[#5F5B69] opacity-0 transition-opacity hover:text-[#C9C9CE] group-hover:opacity-100"
          aria-label={t`Deal actions`}
        >
          ⋯
        </button>
      </div>
      <DealCardDetails deal={deal} contact={contact} />

      {menuOpen ? (
        <div
          className="absolute right-2 top-7 z-20 w-36 rounded-lg border border-[#2A2A2E] bg-[#1C1C1F] py-1 shadow-xl"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onEdit(deal);
            }}
            className="block w-full px-3 py-1.5 text-left text-[12.5px] text-[#C9C9CE] hover:bg-[#232326]"
          >
            <Trans>Edit</Trans>
          </button>
          {(["open", "won", "lost"] as const)
            .filter((status) => status !== deal.status)
            .map((status) => {
              const label =
                status === "open" ? t`Mark open` : status === "won" ? t`Mark won` : t`Mark lost`;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onSetStatus(deal.id, status);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[12.5px] text-[#C9C9CE] hover:bg-[#232326]"
                >
                  {label}
                </button>
              );
            })}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onDelete(deal.id);
            }}
            className="block w-full px-3 py-1.5 text-left text-[12.5px] text-[#F87171] hover:bg-[#232326]"
          >
            <Trans>Delete</Trans>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DealCardDetails({ deal, contact }: { deal: CrmDeal; contact: CrmContact | undefined }) {
  return (
    <>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#DFDFE2] tabular-nums">
          {formatMoney(deal.value)}
        </span>
        {deal.status !== "open" ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{
              backgroundColor: withAlpha(STATUS_COLORS[deal.status], 0.14),
              color: STATUS_COLORS[deal.status],
            }}
          >
            {deal.status}
          </span>
        ) : null}
      </div>
      {contact ? (
        <p className="mt-1 truncate text-[12px] text-[#6E6975]">
          {contact.firstName} {contact.lastName}
        </p>
      ) : null}
    </>
  );
}

// The card that follows the cursor while dragging; the in-column card ghosts.
function DealCardOverlay({
  deal,
  contact,
  accent,
}: {
  deal: CrmDeal;
  contact: CrmContact | undefined;
  accent: string;
}) {
  return (
    <div
      style={{ borderLeftColor: accent }}
      className="cursor-grabbing rounded-lg border border-[#232326] border-l-2 bg-[#18181B] p-3 shadow-xl"
    >
      <p className="min-w-0 truncate text-[13px] font-medium text-[#ECECEE]">{deal.title}</p>
      <DealCardDetails deal={deal} contact={contact} />
    </div>
  );
}

// A stable ref identity, so React attaches it once on mount instead of
// re-running it (and stealing focus) on every keystroke's re-render.
function focusOnMount(node: HTMLInputElement | null) {
  node?.focus();
}

const inputClass =
  "w-full rounded-lg border border-[#202023] bg-[#0F0F11] px-3 py-2 text-[13.5px] text-[#ECECEE] outline-none placeholder:text-[#5F5B69] focus:border-[#3A3A40]";

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onPointerDown={onClose}
      role="presentation"
    >
      <div
        className="w-[420px] rounded-2xl border border-[#242428] bg-[#141416] p-5 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="mb-4 text-[15px] font-medium text-[#ECECEE]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function CreateDealModal({
  overview,
  initialPipelineId,
  onClose,
  onCreated,
}: {
  overview: CrmOverview;
  initialPipelineId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [pipelineId, setPipelineId] = useState(initialPipelineId);
  const pipeline = overview.pipelines.find((entry) => entry.id === pipelineId);
  const [stageId, setStageId] = useState(pipeline?.stages[0]?.id ?? "");
  const [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStageId(pipeline?.stages[0]?.id ?? "");
  }, [pipeline]);

  async function submit() {
    if (!title.trim() || !stageId || busy) return;
    setBusy(true);
    try {
      await rpc.crm.deals.create({
        pipelineId,
        stageId,
        title: title.trim(),
        value: Number.parseInt(value, 10) > 0 ? Number.parseInt(value, 10) : 0,
        contactId: contactId || undefined,
      });
      await onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={t`New deal`} onClose={onClose}>
      <div className="space-y-3">
        <input
          ref={focusOnMount}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t`Deal title`}
          className={inputClass}
        />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))}
          placeholder={t`Value (USD)`}
          inputMode="numeric"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <select
            value={pipelineId}
            onChange={(event) => setPipelineId(event.target.value)}
            className={inputClass}
          >
            {overview.pipelines.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <select
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            className={inputClass}
          >
            {(pipeline?.stages ?? []).map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </div>
        <select
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
          className={inputClass}
        >
          <option value="">
            <Trans>No contact</Trans>
          </option>
          {overview.contacts
            .filter((contact) => contact.status === "active")
            .map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName}
              </option>
            ))}
        </select>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-[#85858A] hover:text-[#C9C9CE]"
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            disabled={!title.trim() || busy}
            onClick={() => void submit()}
            className="rounded-full bg-[#F1F1EF] px-4 py-1.5 text-[13px] font-medium text-[#17171A] disabled:opacity-40"
          >
            <Trans>Create</Trans>
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function EditDealModal({
  deal,
  contacts,
  onClose,
  onSaved,
}: {
  deal: CrmDeal;
  contacts: CrmContact[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [title, setTitle] = useState(deal.title);
  const [value, setValue] = useState(deal.value > 0 ? String(deal.value) : "");
  const [contactId, setContactId] = useState(deal.contactId ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await rpc.crm.deals.update({
        dealId: deal.id,
        title: title.trim(),
        value: Number.parseInt(value, 10) > 0 ? Number.parseInt(value, 10) : 0,
        contactId: contactId || null,
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={t`Edit deal`} onClose={onClose}>
      <div className="space-y-3">
        <input
          ref={focusOnMount}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t`Deal title`}
          className={inputClass}
        />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))}
          placeholder={t`Value (USD)`}
          inputMode="numeric"
          className={inputClass}
        />
        <select
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
          className={inputClass}
        >
          <option value="">
            <Trans>No contact</Trans>
          </option>
          {contacts
            .filter((contact) => contact.status === "active" || contact.id === deal.contactId)
            .map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName}
              </option>
            ))}
        </select>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-[#85858A] hover:text-[#C9C9CE]"
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            disabled={!title.trim() || busy}
            onClick={() => void submit()}
            className="rounded-full bg-[#F1F1EF] px-4 py-1.5 text-[13px] font-medium text-[#17171A] disabled:opacity-40"
          >
            <Trans>Save</Trans>
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CreatePipelineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (pipelineId: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [name, setName] = useState("");
  const [stages, setStages] = useState(["Lead", "Qualified", "Won"]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const cleaned = stages.map((stage) => stage.trim()).filter(Boolean);
    if (!name.trim() || cleaned.length === 0 || busy) return;
    setBusy(true);
    try {
      const created = await rpc.crm.pipelines.create({
        name: name.trim(),
        stages: cleaned.map((stage) => ({ name: stage })),
      });
      await onCreated(created.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={t`New pipeline`} onClose={onClose}>
      <div className="space-y-3">
        <input
          ref={focusOnMount}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t`Pipeline name`}
          className={inputClass}
        />
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-[#85858A]">
            <Trans>Stages, in order</Trans>
          </p>
          <div className="space-y-2">
            {stages.map((stage, index) => (
              <div key={`stage-${index.toString()}`} className="flex items-center gap-2">
                <input
                  value={stage}
                  onChange={(event) =>
                    setStages((previous) =>
                      previous.map((entry, at) => (at === index ? event.target.value : entry)),
                    )
                  }
                  placeholder={t`Stage ${index + 1}`}
                  className={inputClass}
                />
                {stages.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setStages((previous) => previous.filter((_, at) => at !== index))
                    }
                    className="text-[#5F5B69] hover:text-[#C9C9CE]"
                    aria-label={t`Remove stage`}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {stages.length < 12 ? (
            <button
              type="button"
              onClick={() => setStages((previous) => [...previous, ""])}
              className="mt-2 text-[12.5px] text-[#6E6975] hover:text-[#C9C9CE]"
            >
              <Trans>+ Add stage</Trans>
            </button>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-[#85858A] hover:text-[#C9C9CE]"
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
            className="rounded-full bg-[#F1F1EF] px-4 py-1.5 text-[13px] font-medium text-[#17171A] disabled:opacity-40"
          >
            <Trans>Create</Trans>
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
