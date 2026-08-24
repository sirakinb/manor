import type { CrmDeal, CrmOverview, CrmStage } from "@rakazo/contracts";
import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { rpc } from "../lib/api";
import { contactName, formatMoney, parseDealValue, STATUS_COLORS, stageColor } from "../lib/crm";
import { manor } from "../lib/native";
import { Button, Card, Empty, Field, Label, Segmented } from "./crm-kit";
import { KeyboardAvoider } from "./keyboard-avoider";

export function CrmPipeline({
  overview,
  pipelineId,
  onPipelineChange,
  onChanged,
}: {
  overview: CrmOverview;
  pipelineId: string;
  onPipelineChange: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  // A phone shows one column at a time, so the board becomes a stage switcher.
  const pipeline =
    overview.pipelines.find((entry) => entry.id === pipelineId) ?? overview.pipelines[0];
  const [stageId, setStageId] = useState(pipeline?.stages[0]?.id ?? "");
  const [editing, setEditing] = useState<CrmDeal | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<CrmDeal | null>(null);

  const stages = pipeline?.stages ?? [];
  useEffect(() => {
    if (!stages.some((stage) => stage.id === stageId)) setStageId(stages[0]?.id ?? "");
  }, [stages, stageId]);

  const counts = useMemo(() => {
    const byStage = new Map<string, { count: number; value: number }>();
    for (const deal of overview.deals) {
      const entry = byStage.get(deal.stageId) ?? { count: 0, value: 0 };
      byStage.set(deal.stageId, { count: entry.count + 1, value: entry.value + deal.value });
    }
    return byStage;
  }, [overview.deals]);

  if (!pipeline) return <Empty>No pipelines yet</Empty>;

  const deals = overview.deals.filter((deal) => deal.stageId === stageId);
  const stage = stages.find((entry) => entry.id === stageId);
  const totals = counts.get(stageId) ?? { count: 0, value: 0 };

  return (
    <View style={{ paddingBottom: 32 }}>
      {overview.pipelines.length > 1 ? (
        <View style={{ marginBottom: 12 }}>
          <Segmented
            value={pipeline.id}
            onChange={onPipelineChange}
            options={overview.pipelines.map((entry) => ({ key: entry.id, label: entry.name }))}
          />
        </View>
      ) : null}

      <Segmented
        value={stageId}
        onChange={setStageId}
        options={stages.map((entry) => ({
          key: entry.id,
          label: `${entry.name} ${counts.get(entry.id)?.count ?? 0}`,
        }))}
      />

      <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Label>{stage?.name ?? "Stage"}</Label>
            <Text style={{ color: manor.muted, fontSize: 12.5, marginTop: 4 }}>
              {totals.count} deal{totals.count === 1 ? "" : "s"} · {formatMoney(totals.value)}
            </Text>
          </View>
          <Button label="Add" tone="loud" onPress={() => setCreating(true)} />
        </View>

        {deals.length === 0 ? (
          <Empty>Nothing in this stage</Empty>
        ) : (
          <View style={{ gap: 9, marginTop: 14 }}>
            {deals.map((deal) => (
              <DealRow
                key={deal.id}
                deal={deal}
                contact={overview.contacts.find((entry) => entry.id === deal.contactId) ?? null}
                onPress={() => setEditing(deal)}
                onMove={() => setMoving(deal)}
              />
            ))}
          </View>
        )}
      </View>

      <DealSheet
        visible={creating || editing !== null}
        deal={editing}
        pipelineId={pipeline.id}
        stageId={stageId}
        contacts={overview.contacts}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={async () => {
          setCreating(false);
          setEditing(null);
          await onChanged();
        }}
      />

      <MoveSheet
        deal={moving}
        stages={stages}
        onClose={() => setMoving(null)}
        onMoved={async (nextStageId) => {
          setMoving(null);
          setStageId(nextStageId);
          await onChanged();
        }}
      />
    </View>
  );
}

function DealRow({
  deal,
  contact,
  onPress,
  onMove,
}: {
  deal: CrmDeal;
  contact: CrmOverview["contacts"][number] | null;
  onPress: () => void;
  onMove: () => void;
}) {
  return (
    <Card style={{ opacity: deal.status === "open" ? 1 : 0.7 }}>
      <Pressable accessibilityRole="button" onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: manor.ink, fontSize: 15.5, flex: 1 }} numberOfLines={1}>
            {deal.title}
          </Text>
          <Text style={{ color: manor.body, fontSize: 15 }}>{formatMoney(deal.value)}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 }}>
          {deal.status === "open" ? null : (
            <Text style={{ color: STATUS_COLORS[deal.status], fontSize: 12 }}>
              {deal.status === "won" ? "Won" : "Lost"}
            </Text>
          )}
          {contact ? (
            <Text style={{ color: manor.muted, fontSize: 12.5, flex: 1 }} numberOfLines={1}>
              {contactName(contact)}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onMove}
        hitSlop={8}
        style={{ marginTop: 10, alignSelf: "flex-start" }}
      >
        <Text style={{ color: manor.accent, fontSize: 13 }}>Move to…</Text>
      </Pressable>
    </Card>
  );
}

function MoveSheet({
  deal,
  stages,
  onClose,
  onMoved,
}: {
  deal: CrmDeal | null;
  stages: CrmStage[];
  onClose: () => void;
  onMoved: (stageId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function move(stageId: string) {
    if (!deal || pending) return;
    setPending(true);
    try {
      await rpc("crm/deals/move", { dealId: deal.id, stageId });
      await onMoved(stageId);
    } catch (cause) {
      Alert.alert("Could not move", cause instanceof Error ? cause.message : "Try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal visible={deal !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#00000099" }} onPress={onClose} />
      <SafeAreaView style={{ backgroundColor: manor.main }} edges={["bottom"]}>
        <View style={{ padding: 20, gap: 9 }}>
          <Label>Move to</Label>
          {stages.map((stage) => (
            <Pressable
              key={stage.id}
              accessibilityRole="button"
              disabled={pending || stage.id === deal?.stageId}
              onPress={() => void move(stage.id)}
              style={{ opacity: stage.id === deal?.stageId ? 0.4 : 1 }}
            >
              <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: stage.color ?? stageColor(stage.position),
                  }}
                />
                <Text style={{ color: manor.ink, fontSize: 15.5 }}>{stage.name}</Text>
              </Card>
            </Pressable>
          ))}
          <Button label="Cancel" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function DealSheet({
  visible,
  deal,
  pipelineId,
  stageId,
  contacts,
  onClose,
  onSaved,
}: {
  visible: boolean;
  deal: CrmDeal | null;
  pipelineId: string;
  stageId: string;
  contacts: CrmOverview["contacts"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(deal?.title ?? "");
    setValue(deal ? String(deal.value) : "");
    setContactId(deal?.contactId ?? null);
    setError(null);
    setPending(false);
  }, [visible, deal]);

  async function save() {
    if (!title.trim()) {
      setError("A title is required");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (deal) {
        await rpc("crm/deals/update", {
          dealId: deal.id,
          title: title.trim(),
          value: parseDealValue(value),
          contactId,
        });
      } else {
        await rpc("crm/deals/create", {
          pipelineId,
          stageId,
          title: title.trim(),
          value: parseDealValue(value),
          contactId: contactId ?? undefined,
        });
      }
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the deal");
    } finally {
      setPending(false);
    }
  }

  async function setStatus(status: "open" | "won" | "lost") {
    if (!deal) return;
    setPending(true);
    try {
      await rpc("crm/deals/update", { dealId: deal.id, status });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the deal");
    } finally {
      setPending(false);
    }
  }

  function confirmDelete() {
    if (!deal) return;
    Alert.alert("Delete deal", `Delete ${deal.title}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setPending(true);
          rpc("crm/deals/delete", { dealId: deal.id })
            .then(onSaved)
            .catch((cause: Error) => setError(cause.message))
            .finally(() => setPending(false));
        },
      },
    ]);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoider style={{ backgroundColor: manor.page }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={sheetHeader}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={{ color: manor.muted, fontSize: 17 }}>Cancel</Text>
            </Pressable>
            <Text style={{ color: manor.ink, fontSize: 17, fontWeight: "600" }}>
              {deal ? "Deal" : "New deal"}
            </Text>
            <Pressable onPress={() => void save()} disabled={pending} hitSlop={8}>
              <Text style={{ color: manor.accent, fontSize: 17, fontWeight: "600" }}>
                {pending ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="Roof replacement"
            />
            <Field
              label="Value"
              value={value}
              onChangeText={setValue}
              keyboardType="number-pad"
              placeholder="0"
            />

            <View>
              <Label>Contact</Label>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
                <ContactPick
                  label="None"
                  on={contactId === null}
                  onPress={() => setContactId(null)}
                />
                {contacts
                  .filter((contact) => contact.status === "active")
                  .map((contact) => (
                    <ContactPick
                      key={contact.id}
                      label={contactName(contact)}
                      on={contactId === contact.id}
                      onPress={() => setContactId(contact.id)}
                    />
                  ))}
              </View>
            </View>

            {error ? <Text style={{ color: manor.danger }}>{error}</Text> : null}

            {deal ? (
              <View style={{ gap: 10, marginTop: 10 }}>
                {deal.status === "open" ? (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Mark won"
                        onPress={() => void setStatus("won")}
                        disabled={pending}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Mark lost"
                        onPress={() => void setStatus("lost")}
                        disabled={pending}
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    label="Reopen deal"
                    onPress={() => void setStatus("open")}
                    disabled={pending}
                  />
                )}
                <Button
                  label="Delete deal"
                  tone="danger"
                  onPress={confirmDelete}
                  disabled={pending}
                />
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoider>
    </Modal>
  );
}

function ContactPick({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? manor.muted2 : manor.hairlineStrong,
        backgroundColor: on ? manor.surface2 : "transparent",
        paddingHorizontal: 12,
        paddingVertical: 7,
      }}
    >
      <Text style={{ color: on ? manor.ink : manor.muted, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const sheetHeader = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  paddingHorizontal: 20,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: manor.hairline,
};
