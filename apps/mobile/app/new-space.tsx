import { useLingui } from "@lingui/react/macro";
import { Stack, useNavigation, useRouter } from "expo-router";
import { useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { NativeActionButton } from "../components/native/native-action-button";
import { cancelHeaderOptions } from "../components/native/sheet-header";
import { selectSpace } from "../lib/api/api-server";
import { errorText } from "../lib/api/user-error";
import { useSideInsets } from "../lib/layout/side-insets";
import { hapticSuccess } from "../lib/native/haptics";
import { native, useMobileTokens } from "../lib/native/native";
import { useSave } from "../lib/query/query";
import { ACCOUNT_SETTINGS } from "../lib/query/settings-target";
import { isSearchInboxSession, searchInboxSession } from "../lib/search/search-inbox";
import { refreshOrganizations } from "../lib/spaces/organizations";

export default function NewSpace() {
  const sideInsets = useSideInsets();
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const router = useRouter();
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const creationError = (failure: Error) => errorText(failure, t`Could not create space`);
  const creation = useSave({
    // A new Space belongs to the account, so opening it does not end the save that made it.
    target: ACCOUNT_SETTINGS,
    save: async (
      ask: { name: string; shared: boolean; askedIn: ReturnType<typeof searchInboxSession> },
      send,
    ) => {
      const space = await send("spaces/create", { name: ask.name, shared: ask.shared });
      if (navigation.isFocused() && isSearchInboxSession(ask.askedIn)) hapticSuccess();
      void refreshOrganizations();
      // The Space exists by now, so it is opened even when this sheet has been closed meanwhile.
      if (!(await selectSpace(space.id)))
        Alert.alert(t`Space created`, t`It could not be opened. Try again from the sidebar.`);
      router.dismissAll();
      router.replace("/");
    },
    // VoiceOver and TalkBack keep focus on the button, so the failure is spoken here as well.
    onFailed: (failure) => AccessibilityInfo.announceForAccessibility(creationError(failure)),
    closesScreen: true,
  });
  const pending = creation.pending;
  const error = creation.error ? creationError(creation.error) : null;

  function create() {
    const trimmed = name.trim();
    if (trimmed) creation.run({ name: trimmed, shared, askedIn: searchInboxSession() });
  }

  return (
    <>
      <Stack.Screen options={cancelHeaderOptions(t`Cancel`, () => router.back())} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t`Name`}</Text>
        <TextInput
          accessibilityLabel={t`Name`}
          autoFocus
          value={name}
          maxLength={60}
          onChangeText={setName}
          onSubmitEditing={create}
          placeholder={t`Customer support`}
          placeholderTextColor={tokens.mutedForeground}
          returnKeyType="done"
          style={{
            marginTop: 8,
            backgroundColor: native.fill,
            borderRadius: 11,
            padding: 14,
            color: tokens.foreground,
            fontSize: 16,
          }}
        />
        <View accessibilityRole="radiogroup" style={{ marginTop: 20, gap: 12 }}>
          {[false, true].map((team) => (
            <Pressable
              key={String(team)}
              disabled={pending}
              accessibilityRole="radio"
              accessibilityState={{ checked: shared === team }}
              onPress={() => setShared(team)}
            >
              <Text
                style={{
                  color: shared === team ? tokens.foreground : tokens.mutedForeground,
                  fontSize: 15,
                }}
              >
                {shared === team ? "● " : "○ "}
                {team ? "Team: everyone in this organization" : "Personal: only you"}
              </Text>
            </Pressable>
          ))}
        </View>
        {shared ? (
          <Text style={{ color: tokens.mutedForeground, marginTop: 12 }}>
            Agents, conversations, files, and connected accounts are shared.
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: tokens.destructive, marginTop: 14 }}>
            {error}
          </Text>
        ) : null}
        <NativeActionButton
          disabled={!name.trim() || pending}
          label={pending ? t`Creating…` : t`Create space`}
          onPress={create}
          style={{ marginTop: 20 }}
        />
      </ScrollView>
    </>
  );
}
