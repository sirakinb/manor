import { Redirect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  apiBaseWarning,
  currentApiBase,
  defaultApiBase,
  displayApiHost,
  loadSessionToken,
  normalizeApiBase,
  probeApiBase,
  resetApiBase,
  saveApiBase,
  signIn,
  usesCustomApiBase,
} from "../lib/api";
import { brandType, manor } from "../lib/native";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [apiBase, setApiBase] = useState(() => currentApiBase());
  const [serverOpen, setServerOpen] = useState(false);

  useEffect(() => {
    void loadSessionToken().then((token) => {
      setHasSession(Boolean(token));
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: manor.page, justifyContent: "center", padding: 24 }}>
        <Text style={{ color: manor.muted, textAlign: "center" }}>Loading…</Text>
      </View>
    );
  }
  if (hasSession) return <Redirect href="/" />;

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  }

  const custom = usesCustomApiBase(apiBase);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: manor.page }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              paddingHorizontal: 24,
            }}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
          >
            {/* The server picker only matters to self-hosters and to us in dev, so it
            hides behind the mark rather than sitting on the login screen. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manor"
              accessibilityHint="Double tap and hold to choose a custom server"
              delayLongPress={600}
              onLongPress={() => setServerOpen(true)}
              style={{ alignItems: "center", marginBottom: 34 }}
            >
              <Image
                source={require("../assets/manor-mark.png")}
                resizeMode="contain"
                style={{ width: 74, height: 74 }}
              />
              <Text style={styles.wordmark}>Manor</Text>
              <Text style={styles.byline}>By Pentridge</Text>
            </Pressable>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              keyboardAppearance="dark"
              placeholder="Email"
              placeholderTextColor={manor.muted2}
              value={email}
              onChangeText={setEmail}
              style={styles.field}
            />
            <TextInput
              placeholder="Password"
              placeholderTextColor={manor.muted2}
              keyboardAppearance="dark"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={[styles.field, { marginTop: 12 }]}
            />
            {error ? <Text style={{ color: manor.danger, marginTop: 12 }}>{error}</Text> : null}
            <Pressable
              onPress={() => void submit()}
              disabled={pending}
              style={({ pressed }) => [styles.submit, pressed && { backgroundColor: manor.accent }]}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "500" }}>
                {pending ? "Working…" : "Continue with email"}
              </Text>
            </Pressable>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
      {custom ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Custom server ${displayApiHost(apiBase)}`}
          hitSlop={12}
          onPress={() => setServerOpen(true)}
          style={{ alignItems: "center", paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8 }}
        >
          <Text style={styles.footnoteLabel}>Custom server</Text>
          <Text style={{ color: manor.muted2, fontSize: 13, marginTop: 3 }}>
            {displayApiHost(apiBase)}
          </Text>
        </Pressable>
      ) : null}
      <ServerSheet
        visible={serverOpen}
        current={apiBase}
        onClose={() => setServerOpen(false)}
        onSaved={(url) => {
          setApiBase(url);
          setServerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function ServerSheet({
  visible,
  current,
  onClose,
  onSaved,
}: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onSaved: (url: string) => void;
}) {
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(current);
    setError(null);
    setPending(false);
  }, [visible, current]);

  const parsedDraft = normalizeApiBase(draft);
  const warning = parsedDraft.ok ? apiBaseWarning(parsedDraft.url) : null;

  async function save() {
    setPending(true);
    setError(null);
    try {
      const probed = await probeApiBase(draft);
      if (!probed.ok) {
        setError(probed.error);
        return;
      }
      const saved = await saveApiBase(probed.url);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      onSaved(saved.url);
    } finally {
      setPending(false);
    }
  }

  async function restoreDefault() {
    setPending(true);
    setError(null);
    try {
      const saved = await resetApiBase();
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      onSaved(saved.url);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: manor.page }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView style={{ flex: 1, paddingHorizontal: 24, paddingTop: 12 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={{ color: manor.muted, fontSize: 17 }}>Cancel</Text>
            </Pressable>
            <Text style={{ color: manor.ink, fontSize: 17, fontWeight: "600" }}>Server</Text>
            <Pressable onPress={() => void save()} disabled={pending} hitSlop={8}>
              <Text style={{ color: manor.accent, fontSize: 17, fontWeight: "600" }}>
                {pending ? "Checking…" : "Save"}
              </Text>
            </Pressable>
          </View>
          <Text style={{ color: manor.muted, marginTop: 28, fontSize: 15, lineHeight: 22 }}>
            Point this app at your self-hosted Manor origin — the same HTTPS URL you open in a
            browser.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="url"
            textContentType="URL"
            returnKeyType="go"
            onSubmitEditing={() => void save()}
            placeholder={defaultApiBase()}
            placeholderTextColor={manor.muted2}
            keyboardAppearance="dark"
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              setError(null);
            }}
            style={[styles.field, { marginTop: 20, fontSize: 16 }]}
          />
          {warning ? (
            <Text style={{ color: manor.muted2, marginTop: 12, fontSize: 13 }}>{warning}</Text>
          ) : null}
          {error ? <Text style={{ color: manor.danger, marginTop: 12 }}>{error}</Text> : null}
          {usesCustomApiBase(current) || draft.trim() !== current ? (
            <Pressable
              onPress={() => void restoreDefault()}
              disabled={pending}
              style={{ marginTop: 28, alignItems: "center" }}
            >
              <Text style={{ color: manor.muted, fontSize: 15 }}>Use default server</Text>
            </Pressable>
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    marginTop: 22,
    color: manor.ink,
    fontFamily: brandType.wordmark,
    fontSize: 26,
    letterSpacing: 8.3,
    textTransform: "uppercase",
    // Tracking is applied on the right of every glyph, including the last.
    marginRight: -8.3,
  },
  byline: {
    marginTop: 10,
    color: manor.muted2,
    fontFamily: brandType.label,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginRight: -1.8,
  },
  field: {
    backgroundColor: manor.main,
    borderWidth: 1,
    borderColor: manor.hairlineStrong,
    borderRadius: 13,
    paddingHorizontal: 18,
    paddingVertical: 17,
    color: manor.ink,
    fontSize: 17,
  },
  submit: {
    marginTop: 16,
    backgroundColor: "#9333EA",
    borderRadius: 13,
    paddingVertical: 18,
    alignItems: "center",
  },
  footnoteLabel: {
    color: manor.muted,
    fontFamily: brandType.label,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginRight: -1.8,
  },
});
