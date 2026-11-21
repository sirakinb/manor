import type { IntegrationSetupState } from "@rakazo/contracts";
import { credentialIssue } from "@rakazo/core";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import { NativeActionButton } from "../components/native-action-button";
import type { PasswordResetCapabilities } from "../lib/api";
import {
  currentApiBase,
  displayApiHost,
  loadSessionToken,
  passwordResetCapabilities,
  requestPasswordReset,
  rpc,
  signIn,
  signUp,
  usesCustomApiBase,
} from "../lib/api";
import type { AuthMode } from "../lib/auth-routing";
import { useI18n } from "../lib/i18n";
import { brandType, manor } from "../lib/native";
import { continueWithSso } from "../lib/sso";
import { credentialIssueText, errorText } from "../lib/user-error";

export default function SignIn() {
  const { t } = useI18n();
  const router = useRouter();
  const { mode: requestedMode } = useLocalSearchParams<{ mode?: string | string[] }>();
  // Manor opens on sign-in; sign-up only when a link asks for it with mode=up.
  const [mode, setMode] = useState<AuthMode>(() => (requestedMode === "up" ? "up" : "in"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [apiBase, setApiBase] = useState(() => currentApiBase());
  const [reset, setReset] = useState<PasswordResetCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [resetSent, setResetSent] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setApiBase(currentApiBase());
    }, []),
  );

  useEffect(() => {
    void loadSessionToken().then((token) => {
      setHasSession(Boolean(token));
      setReady(true);
    });
  }, []);

  useEffect(() => {
    let active = true;
    setReset(null);
    setCapabilityError(false);
    void passwordResetCapabilities()
      .then((capabilities) => {
        if (active) setReset(capabilities);
      })
      .catch(() => {
        if (active) setCapabilityError(true);
      });
    return () => {
      active = false;
    };
  }, [apiBase, capabilityAttempt]);

  useEffect(() => {
    if (resetSent) AccessibilityInfo.announceForAccessibility(t("Check your email"));
  }, [resetSent, t]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: manor.page, justifyContent: "center", padding: 24 }}>
        <Text style={{ color: manor.muted, textAlign: "center" }}>{t("Loading…")}</Text>
      </View>
    );
  }
  if (hasSession) return <Redirect href="/" />;

  async function submit() {
    if (pending || !reset?.passwordAuth) return;
    const issue = credentialIssue({ email, password: mode === "forgot" ? undefined : password });
    if (issue) {
      setError(credentialIssueText(issue));
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (mode === "forgot") {
        if (!reset?.passwordReset || !reset.resetUrl) {
          throw new Error(t("Password recovery is not configured for this server"));
        }
        await requestPasswordReset(email.trim(), reset.resetUrl);
        setResetSent(true);
        return;
      }
      if (mode === "up") {
        const trimmedEmail = email.trim();
        const result = await signUp(
          trimmedEmail,
          password,
          name.trim() || trimmedEmail.split("@")[0] || "User",
        );
        if (result.verificationRequired) {
          setResetSent(true);
          return;
        }
      } else {
        await signIn(email.trim(), password);
      }
      const setup =
        mode === "up"
          ? await rpc<IntegrationSetupState>("integrationSetup/get").catch(() => null)
          : null;
      router.replace(setup?.needsSetup ? "/integration-setup" : "/");
    } catch (err) {
      setError(errorText(err, t("Could not continue")));
    } finally {
      setPending(false);
    }
  }

  async function sso() {
    setPending(true);
    setError(null);
    try {
      if (await continueWithSso()) router.replace("/");
    } catch (err) {
      setError(errorText(err, t("Could not continue")));
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
          <View style={{ flex: 1 }}>
            <ScrollView
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: "center",
                paddingHorizontal: 24,
                paddingVertical: 24,
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
                onLongPress={() => router.push("/server")}
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
              {resetSent ? (
                <View style={{ alignItems: "center", marginTop: 6 }}>
                  <Text accessibilityRole="header" style={{ color: manor.ink, fontSize: 17 }}>
                    {t("Check your email")}
                  </Text>
                  {/* Sign-up verification lands here too; the reset sentence is only true for a reset. */}
                  {mode === "forgot" ? (
                    <Text
                      style={{
                        color: manor.muted,
                        fontSize: 15,
                        marginTop: 10,
                        textAlign: "center",
                      }}
                    >
                      If an account exists for that address, we sent a password reset link.
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setMode("in");
                      setResetSent(false);
                    }}
                    style={{ marginTop: 22 }}
                  >
                    <Text style={{ color: manor.ink, fontSize: 15, fontWeight: "600" }}>
                      {t("Back to sign in")}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {capabilityError ? (
                    <View accessibilityRole="alert">
                      <Text style={{ color: manor.danger }}>
                        {t("Could not load sign-in options")}
                      </Text>
                      <NativeActionButton
                        label={t("Retry")}
                        onPress={() => setCapabilityAttempt((value) => value + 1)}
                      />
                    </View>
                  ) : !reset ? (
                    <Text style={{ color: manor.muted, textAlign: "center", marginTop: 16 }}>
                      {t("Loading…")}
                    </Text>
                  ) : null}
                  {reset?.sso && !reset.passwordAuth && mode !== "forgot" ? (
                    <NativeActionButton
                      label={t("Continue with {name}", { name: reset.sso.name })}
                      disabled={pending}
                      onPress={() => void sso()}
                      style={{ marginTop: 16 }}
                    />
                  ) : null}
                  {error && !reset?.passwordAuth ? (
                    <Text accessibilityRole="alert" style={{ color: manor.danger, marginTop: 12 }}>
                      {error}
                    </Text>
                  ) : null}
                  {reset?.passwordAuth ? (
                    <>
                      {mode === "up" ? (
                        <TextInput
                          autoComplete="name"
                          placeholder={t("Name")}
                          placeholderTextColor={manor.muted2}
                          keyboardAppearance="dark"
                          value={name}
                          onChangeText={setName}
                          style={[styles.field, { marginBottom: 12 }]}
                        />
                      ) : null}
                      <TextInput
                        autoCapitalize="none"
                        autoComplete="email"
                        keyboardType="email-address"
                        keyboardAppearance="dark"
                        placeholder={t("Email")}
                        placeholderTextColor={manor.muted2}
                        value={email}
                        onChangeText={setEmail}
                        style={styles.field}
                      />
                      {mode !== "forgot" ? (
                        <TextInput
                          placeholder={t("Password")}
                          placeholderTextColor={manor.muted2}
                          keyboardAppearance="dark"
                          autoComplete={mode === "in" ? "current-password" : "new-password"}
                          returnKeyType="go"
                          secureTextEntry
                          value={password}
                          onChangeText={setPassword}
                          onSubmitEditing={() => void submit()}
                          style={[styles.field, { marginTop: 12 }]}
                        />
                      ) : null}
                      {error ? (
                        <Text style={{ color: manor.danger, marginTop: 12 }}>{error}</Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void submit()}
                        disabled={pending}
                        style={({ pressed }) => [
                          styles.submit,
                          pressed && { backgroundColor: manor.accent },
                        ]}
                      >
                        <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "500" }}>
                          {pending
                            ? t("Working…")
                            : mode === "in"
                              ? "Continue with email"
                              : mode === "up"
                                ? t("Sign up")
                                : t("Send reset link")}
                        </Text>
                      </Pressable>
                      {reset.sso && mode !== "forgot" ? (
                        <NativeActionButton
                          label={t("Continue with {name}", { name: reset.sso.name })}
                          prominence="quiet"
                          disabled={pending}
                          onPress={() => void sso()}
                          style={{ alignSelf: "center", marginTop: 16 }}
                        />
                      ) : null}
                      {mode === "in" && reset?.passwordReset && reset.resetUrl ? (
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => {
                            setMode("forgot");
                            setError(null);
                          }}
                          style={{ alignSelf: "center", marginTop: 16 }}
                        >
                          <Text style={{ color: manor.ink, fontSize: 14, fontWeight: "600" }}>
                            {t("Forgot password?")}
                          </Text>
                        </Pressable>
                      ) : null}
                      {mode !== "forgot" ? (
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: 24,
                          }}
                        >
                          <Text style={{ color: manor.muted2, fontSize: 15 }}>
                            {mode === "in"
                              ? t("Don’t have an account?")
                              : t("Already have an account?")}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={() => {
                              setMode((current) => (current === "in" ? "up" : "in"));
                              setError(null);
                            }}
                            style={{ marginLeft: 5 }}
                          >
                            <Text style={{ color: manor.ink, fontSize: 15, fontWeight: "600" }}>
                              {mode === "in" ? t("Sign up") : t("Sign in")}
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </ScrollView>
            {custom ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Custom server {host}", { host: displayApiHost(apiBase) })}
                hitSlop={12}
                onPress={() => router.push("/server")}
                style={{
                  alignItems: "center",
                  paddingHorizontal: 24,
                  paddingBottom: 12,
                  paddingTop: 8,
                }}
              >
                <Text style={styles.footnoteLabel}>{t("Custom server")}</Text>
                <Text style={{ color: manor.muted2, fontSize: 13, marginTop: 3 }}>
                  {displayApiHost(apiBase)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
