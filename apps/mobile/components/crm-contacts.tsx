import type { CrmContact, CrmOverview } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { rpc } from "../lib/api";
import { contactName, matchesContact } from "../lib/crm";
import { manor } from "../lib/native";
import { Button, Card, Chip, Empty, Field, Label } from "./crm-kit";
import { KeyboardAvoider } from "./keyboard-avoider";

type Draft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
  tagIds: string[];
};

const BLANK: Draft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  notes: "",
  tagIds: [],
};

function toDraft(contact: CrmContact): Draft {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    company: contact.company ?? "",
    notes: contact.notes ?? "",
    tagIds: contact.tags.map((tag) => tag.id),
  };
}

export function CrmContacts({
  overview,
  onChanged,
}: {
  overview: CrmOverview;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CrmContact | null>(null);
  const [creating, setCreating] = useState(false);

  const matches = overview.contacts.filter((contact) => matchesContact(contact, query));
  const active = matches.filter((contact) => contact.status === "active");
  const archived = matches.filter((contact) => contact.status === "archived");

  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 32 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <TextInput
          placeholder="Search contacts"
          placeholderTextColor={manor.muted2}
          keyboardAppearance="dark"
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          style={{
            flex: 1,
            backgroundColor: manor.surface,
            borderWidth: 1,
            borderColor: manor.hairlineStrong,
            borderRadius: 11,
            paddingHorizontal: 13,
            paddingVertical: 11,
            color: manor.ink,
            fontSize: 15,
          }}
        />
        <Button label="Add" tone="loud" onPress={() => setCreating(true)} />
      </View>

      {active.length === 0 && archived.length === 0 ? (
        <Empty>{query ? "No contacts match that" : "No contacts yet"}</Empty>
      ) : (
        <View style={{ gap: 9, marginTop: 14 }}>
          {active.map((contact) => (
            <Row key={contact.id} contact={contact} onPress={() => setEditing(contact)} />
          ))}
          {archived.length > 0 ? (
            <View style={{ marginTop: 14, gap: 9 }}>
              <Label>Archived</Label>
              {archived.map((contact) => (
                <Row key={contact.id} contact={contact} onPress={() => setEditing(contact)} />
              ))}
            </View>
          ) : null}
        </View>
      )}

      <ContactSheet
        visible={creating || editing !== null}
        contact={editing}
        tags={overview.tags}
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
    </View>
  );
}

function Row({ contact, onPress }: { contact: CrmContact; onPress: () => void }) {
  const subtitle = [contact.company, contact.email, contact.phone].filter(Boolean).join(" · ");
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card style={{ opacity: contact.status === "archived" ? 0.55 : 1 }}>
        <Text style={{ color: manor.ink, fontSize: 15.5 }}>{contactName(contact)}</Text>
        {subtitle ? (
          <Text style={{ color: manor.muted, fontSize: 12.5, marginTop: 3 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {contact.tags.length > 0 ? (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
            {contact.tags.map((tag) => (
              <Chip key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

function ContactSheet({
  visible,
  contact,
  tags,
  onClose,
  onSaved,
}: {
  visible: boolean;
  contact: CrmContact | null;
  tags: CrmOverview["tags"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(contact ? toDraft(contact) : BLANK);
    setError(null);
    setPending(false);
  }, [visible, contact]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!draft.firstName.trim()) {
      setError("A first name is required");
      return;
    }
    setPending(true);
    setError(null);
    try {
      // The contract takes optional strings on create but nullable ones on
      // update, so a cleared field has to be sent as null to actually clear.
      const body = {
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        company: draft.company.trim(),
        notes: draft.notes,
        tagIds: draft.tagIds,
      };
      if (contact) {
        await rpc("crm/contacts/update", {
          contactId: contact.id,
          ...body,
          email: body.email || null,
          phone: body.phone || null,
          company: body.company || null,
          notes: body.notes || null,
        });
      } else {
        await rpc("crm/contacts/create", {
          ...body,
          email: body.email || undefined,
          phone: body.phone || undefined,
          company: body.company || undefined,
          notes: body.notes || undefined,
        });
      }
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the contact");
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (!contact) return;
    setPending(true);
    try {
      await rpc("crm/contacts/update", {
        contactId: contact.id,
        status: contact.status === "archived" ? "active" : "archived",
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive the contact");
    } finally {
      setPending(false);
    }
  }

  function confirmDelete() {
    if (!contact) return;
    Alert.alert("Delete contact", `Delete ${contactName(contact)}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setPending(true);
          rpc("crm/contacts/delete", { contactId: contact.id })
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
              {contact ? "Contact" : "New contact"}
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
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field
                label="First name"
                value={draft.firstName}
                onChangeText={(value) => set("firstName", value)}
                placeholder="Ada"
              />
              <Field
                label="Last name"
                value={draft.lastName}
                onChangeText={(value) => set("lastName", value)}
                placeholder="Lovelace"
              />
            </View>
            <Field
              label="Email"
              value={draft.email}
              onChangeText={(value) => set("email", value)}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="ada@example.com"
            />
            <Field
              label="Phone"
              value={draft.phone}
              onChangeText={(value) => set("phone", value)}
              keyboardType="phone-pad"
              placeholder="555-0100"
            />
            <Field
              label="Company"
              value={draft.company}
              onChangeText={(value) => set("company", value)}
              placeholder="Analytical Engines"
            />
            <Field
              label="Notes"
              value={draft.notes}
              onChangeText={(value) => set("notes", value)}
              multiline
              placeholder="What matters about this relationship"
            />

            {tags.length > 0 ? (
              <View>
                <Label>Tags</Label>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
                  {tags.map((tag) => {
                    const on = draft.tagIds.includes(tag.id);
                    return (
                      <Pressable
                        key={tag.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() =>
                          set(
                            "tagIds",
                            on
                              ? draft.tagIds.filter((id) => id !== tag.id)
                              : [...draft.tagIds, tag.id],
                          )
                        }
                        style={{ opacity: on ? 1 : 0.45 }}
                      >
                        <Chip name={tag.name} color={tag.color} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {error ? <Text style={{ color: manor.danger }}>{error}</Text> : null}

            {contact ? (
              <View style={{ gap: 10, marginTop: 10 }}>
                <Button
                  label={contact.status === "archived" ? "Restore contact" : "Archive contact"}
                  onPress={() => void archive()}
                  disabled={pending}
                />
                <Button
                  label="Delete contact"
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

const sheetHeader = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  paddingHorizontal: 20,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: manor.hairline,
};
