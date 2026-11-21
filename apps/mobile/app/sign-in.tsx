import type { IntegrationSetupState } from "@rakazo/contracts";
import { credentialIssue, MAX_PASSWORD_LENGTH, PASSWORD_RULES } from "@rakazo/core";
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
  sendSignInCode,
  signIn,
  signInWithCode,
  signUp,
  usesCustomApiBase,
} from "../lib/api";
import type { AuthMode } from "../lib/auth-routing";
import { useI18n } from "../lib/i18n";
import { brandType, manor } from "../lib/native";
import { passkeysAvailable, signInWithPasskey } from "../lib/passkey";
import { continueWithSso } from "../lib/sso";
import { credentialIssueText, errorText } from "../lib/user-error";

const CODE_LENGTH = 6;

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
  const [usePassword, setUsePassword] = useState(false);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [passkeys, setPasskeys] = useState(false);

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
    // A code belongs to the server that sent it.
    setCodeSent(false);
    setCode("");
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
    let active = true;
    setPasskeys(false);
    void passkeysAvailable(reset).then((available) => {
      if (active) setPasskeys(available);
    });
    return () => {
      active = false;
    };
  }, [reset]);

  useEffect(() => {
    if (resetSent || codeSent) AccessibilityInfo.announceForAccessibility(t("Check your email"));
  }, [resetSent, codeSent, t]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: manor.page, justifyContent: "center", padding: 24 }}>
        <Text style={{ color: manor.muted, textAlign: "center" }}>{t("Loading…")}</Text>
      </View>
    );
  }
  if (hasSession) return <Redirect href="/" />;

  const codeFlow = Boolean(reset?.passwordAuth && reset.emailCode && mode !== "forgot");
  const usingCode = codeFlow && !usePassword;
  const codeStep = usingCode && codeSent;

  async function submit(enteredCode = code) {
    if (pending || !reset?.passwordAuth) return;
    const issue = credentialIssue({
      email,
      password: mode === "forgot" || usingCode ? undefined : password,
    });
    if (issue) {
      setError(credentialIssueText(issue));
      return;
    }
    // An unfinished code would spend one of the code's three attempts.
    if (codeStep && enteredCode.length !== CODE_LENGTH) return;
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
      if (usingCode && !codeSent) {
        const sentFrom = apiBase;
        await sendSignInCode(email.trim());
        if (currentApiBase() !== sentFrom) return;
        setCode("");
        setCodeSent(true);
        return;
      }
      if (usingCode) {
        const trimmedEmail = email.trim();
        await signInWithCode(
          trimmedEmail,
          enteredCode,
          // Only used when this creates the account.
          mode === "up" ? name.trim() || trimmedEmail.split("@")[0] || "User" : undefined,
        );
      } else if (mode === "up") {
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
      // A code can create the account from either form.
      const setup =
        mode === "up" || usingCode
          ? await rpc<IntegrationSetupState>("integrationSetup/get").catch(() => null)
          : null;
      router.replace(setup?.needsSetup ? "/integration-setup" : "/");
    } catch (err) {
      setError(errorText(err, t("Could not continue")));
    } finally {
      setPending(false);
    }
  }

  async function externalSignIn(run: () => Promise<boolean>) {
    setPending(true);
    setError(null);
    try {
      if (await run()) router.replace("/");
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
                      setCodeSent(false);
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
                      onPress={() => void externalSignIn(continueWithSso)}
                      style={{ marginTop: 16 }}
                    />
                  ) : null}
                  {error && !reset?.passwordAuth ? (
                    <Text accessibilityRole="alert" style={{ color: manor.danger, marginTop: 12 }}>
                      {error}
                    </Text>
                  ) : null}
                  {reset?.passwordAuth && codeStep ? (
                    <>
                      <Text
                        accessibilityRole="header"
                        style={{ color: manor.ink, fontSize: 17, textAlign: "center" }}
                      >
                        {t("Check your email")}
                      </Text>
                      <TextInput
                        accessibilityLabel={t("Code")}
                        autoComplete="one-time-code"
                        autoFocus
                        keyboardType="number-pad"
                        keyboardAppearance="dark"
                        maxLength={CODE_LENGTH}
                        placeholder={t("Code")}
                        placeholderTextColor={manor.muted2}
                        textContentType="oneTimeCode"
                        value={code}
                        onChangeText={(value) => {
                          const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
                          setCode(digits);
                          // iOS offers the code from Mail; a complete code signs in at once.
                          if (digits.length === CODE_LENGTH) void submit(digits);
                        }}
                        onSubmitEditing={() => void submit()}
                        style={[styles.field, { marginTop: 22 }]}
                      />
                      {error ? (
                        <Text style={{ color: manor.danger, marginTop: 12 }}>{error}</Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void submit()}
                        disabled={pending || code.length < CODE_LENGTH}
                        style={({ pressed }) => [
                          styles.submit,
                          pressed && { backgroundColor: manor.accent },
                          (pending || code.length < CODE_LENGTH) && { opacity: 0.5 },
                        ]}
                      >
                        <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "500" }}>
                          {pending ? t("Working…") : t("Continue")}
                        </Text>
                      </Pressable>
                      <NativeActionButton
                        label={t("Back")}
                        prominence="quiet"
                        disabled={pending}
                        onPress={() => {
                          setCodeSent(false);
                          setCode("");
                          setError(null);
                        }}
                        style={{ alignSelf: "center", marginTop: 16 }}
                      />
                    </>
                  ) : reset?.passwordAuth ? (
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
                      {mode !== "forgot" && !usingCode ? (
                        <TextInput
                          textContentType={mode === "in" ? "password" : "newPassword"}
                          passwordRules={mode === "in" ? undefined : PASSWORD_RULES}
                          maxLength={MAX_PASSWORD_LENGTH}
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
                            : usingCode
                              ? t("Continue")
                              : mode === "in"
                                ? "Continue with email"
                                : mode === "up"
                                  ? t("Sign up")
                                  : t("Send reset link")}
                        </Text>
                      </Pressable>
                      {passkeys && mode === "in" && !codeSent ? (
                        <NativeActionButton
                          label={t("Sign in with passkey")}
                          prominence="quiet"
                          disabled={pending}
                          onPress={() => void externalSignIn(signInWithPasskey)}
                          style={{ alignSelf: "center", marginTop: 16 }}
                        />
                      ) : null}
                      {codeFlow ? (
                        <NativeActionButton
                          label={usingCode ? t("Use password") : t("Use email code")}
                          prominence="quiet"
                          disabled={pending}
                          onPress={() => {
                            setUsePassword(usingCode);
                            setError(null);
                          }}
                          style={{ alignSelf: "center", marginTop: 16 }}
                        />
                      ) : null}
                      {reset.sso && mode !== "forgot" ? (
                        <NativeActionButton
                          label={t("Continue with {name}", { name: reset.sso.name })}
                          prominence="quiet"
                          disabled={pending}
                          onPress={() => void externalSignIn(continueWithSso)}
                          style={{ alignSelf: "center", marginTop: 16 }}
                        />
                      ) : null}
                      {mode === "in" && !usingCode && reset?.passwordReset && reset.resetUrl ? (
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
