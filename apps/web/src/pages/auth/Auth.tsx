import { Trans, useLingui } from "@lingui/react/macro";
import { signInProviders } from "@rakazo/contracts";
import {
  credentialIssue,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  signupRequiresEmailVerification,
  suggestEmailCorrection,
} from "@rakazo/core";
import { Button, Input, InputOTP, InputOTPGroup, InputOTPSlot, Label } from "@rakazo/ui-web";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PasskeySignIn, usePasskeySignIn } from "../../components/account/PasskeySignIn";
import { SocialSignInButtons } from "../../components/account/SocialSignInButtons";
import { ParticleWordmark } from "../../components/ai/ParticleWordmark";
import { BrandLogo } from "../../components/BrandLogo";
import { WindowChrome } from "../../components/WindowChrome";
import { authClient } from "../../lib/auth/auth";
import type { AuthCapabilities } from "../../lib/auth/auth-capabilities";
import { fetchAuthCapabilities } from "../../lib/auth/auth-capabilities";
import { newAccountDestination, signInNext } from "../../lib/auth/sign-in-next";
import { runSsoFlow } from "../../lib/auth/sso-flow";
import { brand, brandName } from "../../lib/brand";
import { desktopBridge } from "../../lib/platform/desktop";
import { clearSpaceSelection } from "../../lib/query/rpc";
import { authErrorText, credentialIssueText } from "../../lib/query/user-error";

type AuthMode = "in" | "up" | "forgot";

// off-scale: 16px below md stops iOS Safari zooming into a focused field.
const fieldClass = "mt-2 h-12 rounded-xl px-4 text-[16px]/6 md:text-body-lg";
const CODE_LENGTH = 6;
export const submitClass = "mt-3 h-12 w-full rounded-xl text-body-lg";

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const chooserPath = mode === "up" ? "/sign-up" : "/sign-in";
  const emailStep = location.pathname === `${chooserPath}/email`;
  const next = signInNext(searchParams.get("next"));
  // Switching between sign-in and sign-up keeps where the person was going.
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailBlurred, setEmailBlurred] = useState(false);
  const [warnedEmail, setWarnedEmail] = useState<string | null>(null);
  const emailSuggestion = mode === "up" ? suggestEmailCorrection(email) : null;
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get("error");
    if (!code) return null;
    return authErrorText({ code }, t`Could not continue`);
  });
  const [pending, setPending] = useState(false);
  const entering = useRef(false);
  const passkey = usePasskeySignIn({ onSignedIn: enterApp, onError: setError });
  const [resetSent, setResetSent] = useState(false);
  // Signup triggers a session refresh that remounts the anonymous auth page.
  const sent = resetSent || searchParams.get("verify") === "email";
  const [reset, setReset] = useState<AuthCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const useCode = Boolean(reset?.passwordAuth && reset.emailCode) && mode !== "forgot";
  // A blank password asks for an emailed code, so code-only accounts need no toggle.
  const codeMode = useCode && !password;
  const codeStep = useCode && codeSent;
  const providers = reset ? signInProviders(reset) : [];
  const chooser = Boolean(
    reset?.passwordAuth && providers.length > 0 && !emailStep && mode !== "forgot" && !codeStep,
  );
  // The chooser and the email step share a card. A server with no providers keeps today's form.
  const presented = Boolean(
    reset?.passwordAuth && providers.length > 0 && mode !== "forgot" && !sent && !codeStep,
  );
  const passwordFieldId = mode === "in" ? "current-password" : "new-password";
  const logoOnly = !sent && !codeStep && mode === "in" && brand.id !== "manor";
  const title =
    sent || codeStep ? (
      <Trans>Check your email</Trans>
    ) : presented && mode === "in" ? (
      <Trans>Welcome back</Trans>
    ) : mode === "in" ? (
      <Trans>Sign in to {brandName}</Trans>
    ) : mode === "up" ? (
      brand.id === "manor" ? (
        <Trans>Create your Manor</Trans>
      ) : (
        <Trans>Create your {brandName} account</Trans>
      )
    ) : (
      <Trans>Reset your password</Trans>
    );

  useEffect(() => {
    setReset(null);
    setCapabilityError(false);
    let active = true;
    void fetchAuthCapabilities()
      .then((capabilities) => {
        if (active) setReset(capabilities);
      })
      .catch(() => {
        if (active) setCapabilityError(true);
      });
    return () => {
      // Do not abort on unmount: a guard redirect that bounces through this
      // page only mounts it for a render or two, and the cancelled fetch then
      // surfaces as a failed request. `active` drops the result; the request
      // keeps its own time bound.
      active = false;
    };
  }, [mode, capabilityAttempt]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reset?.passwordAuth) return;
    if (codeStep) {
      // An unfinished code would spend one of the code's three attempts.
      if (code.length === CODE_LENGTH) await verifyCode(code);
      return;
    }
    const issue = credentialIssue({
      email,
      password: mode === "forgot" || codeMode ? undefined : password,
    });
    if (issue) {
      setError(credentialIssueText(issue));
      return;
    }
    if (emailSuggestion && warnedEmail !== email) {
      setWarnedEmail(email);
      setEmailBlurred(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (mode === "forgot") {
        if (!reset?.passwordReset || !reset.resetUrl) {
          setError(t`Password recovery is not configured for this server`);
          return;
        }
        const result = await authClient.requestPasswordReset({
          email: email.trim(),
          redirectTo: reset.resetUrl,
        });
        if (result.error) {
          setError(authErrorText(result.error, t`Could not send reset email`));
          return;
        }
        setResetSent(true);
        return;
      }
      const trimmedEmail = email.trim();
      if (codeMode) {
        const request = await authClient.emailOtp.sendVerificationOtp({
          email: trimmedEmail,
          type: "sign-in",
        });
        if (request.error) {
          setError(authErrorText(request.error, t`Could not continue`));
          return;
        }
        setCode("");
        setCodeSent(true);
        return;
      }
      const result =
        mode === "up"
          ? await authClient.signUp.email({
              email: trimmedEmail,
              password,
              name: name || trimmedEmail.split("@")[0] || "User",
            })
          : await authClient.signIn.email({ email: trimmedEmail, password });
      if (result.error) {
        setError(authErrorText(result.error, t`Could not continue`));
        return;
      }
      if (mode === "up" && signupRequiresEmailVerification(result.data)) {
        setSearchParams({ verify: "email", ...(next ? { next } : {}) });
        return;
      }
      enterApp();
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      if (!entering.current) setPending(false);
    }
  }

  async function verifyCode(otp: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const trimmedEmail = email.trim();
      const result = await authClient.signIn.emailOtp({
        email: trimmedEmail,
        otp,
        // Only used when this creates the account.
        name: mode === "up" ? name || trimmedEmail.split("@")[0] || "User" : undefined,
      });
      if (result.error) {
        setError(authErrorText(result.error, t`Could not continue`));
        setCode("");
        return;
      }
      enterApp();
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      if (!entering.current) setPending(false);
    }
  }

  function enterApp() {
    clearSpaceSelection();
    // The routes move a signed-in user on once the session refetch lands. Navigating
    // first beats it, so the guards bounce through sign-in and the shell.
    entering.current = true;
    setPending(true);
  }

  async function signInAsDemo(account: { email: string; password: string }) {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signIn.email(account);
      if (result.error) {
        setError(authErrorText(result.error, t`Could not continue`));
        return;
      }
      // Sign-up sends a signed-in user to new-account onboarding; the demo account already exists.
      if (mode === "up") navigate(`/sign-in${nextQuery}`, { replace: true });
      enterApp();
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      if (!entering.current) setPending(false);
    }
  }

  function leaveCodeStep() {
    setCodeSent(false);
    setCode("");
    setError(null);
  }

  async function signInWithProvider(provider: string) {
    setError(null);
    try {
      const result = await runSsoFlow(
        (disableRedirect, callbackURL) =>
          authClient.signIn.social({
            disableRedirect,
            provider,
            newUserCallbackURL: callbackURL(newAccountDestination(next)),
            callbackURL: callbackURL(next ?? "/app"),
            errorCallbackURL: callbackURL("/sign-in"),
          }),
        ["/app", "/onboarding", "/integrations/setup", "/sign-in", ...(next ? [next] : [])],
      );
      if (result.error) setError(authErrorText(result.error, t`Could not continue`));
    } catch {
      setError(t`Could not continue`);
    }
  }

  if (!sent && !reset && !capabilityError) {
    return <div className="h-full bg-[var(--rk-page)]" />;
  }

  return (
    <div
      className="flex min-h-full flex-col bg-[var(--rk-page)] text-[#F1F0F3]"
      data-rakazo-surface="auth"
    >
      <div className="app-drag flex gap-2 px-5 py-[18px]">
        <WindowChrome />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <form onSubmit={submit} className="flex w-full max-w-[460px] flex-col items-center">
          {presented && emailStep ? (
            <div className="mb-4 self-start">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setError(null);
                  if (location.state?.authChooser) navigate(-1);
                  else navigate(`${chooserPath}${nextQuery}`, { replace: true });
                }}
              >
                <ChevronLeft />
                <Trans>Back</Trans>
              </Button>
            </div>
          ) : null}
          <BrandLogo
            className={
              brand.logo.viewBox
                ? "h-[90px] w-[156px]"
                : brand.logo.wide
                  ? "h-12 w-auto"
                  : "h-[74px] w-[74px]"
            }
          />
          {brand.id === "manor" ? (
            <div className="mt-5 w-[300px]">
              <ParticleWordmark text="MANOR" fontSize={40} gap={2} label="Manor" />
            </div>
          ) : null}
          <h1
            className={
              logoOnly
                ? "sr-only"
                : `rk-serif mb-[38px] text-center text-[38px] ${brand.id === "manor" ? "mt-3" : "mt-[30px]"}`
            }
          >
            {title}
          </h1>
          {sent ? (
            <div role="status" className="w-full text-center">
              {resetSent ? (
                <p className="mb-6 text-[15px] leading-relaxed text-[#8A8590]">
                  <Trans>
                    If an account exists for that address, we sent a password reset link.
                  </Trans>
                </p>
              ) : null}
              <Link to={`/sign-in${nextQuery}`} className="inline-block font-medium text-[#F1F0F3]">
                <Trans>Back to sign in</Trans>
              </Link>
            </div>
          ) : !reset?.passwordAuth ? (
            <div
              className={`flex w-full flex-col items-center text-[16px] text-[#8A8590] ${logoOnly ? "mt-[38px]" : ""}`}
            >
              {capabilityError ? (
                <div role="alert" className="w-full text-center">
                  <p>
                    <Trans>Could not load sign-in options</Trans>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
                    onClick={() => setCapabilityAttempt((attempt) => attempt + 1)}
                  >
                    <Trans>Retry</Trans>
                  </Button>
                </div>
              ) : null}
              {mode !== "forgot" ? (
                <SocialSignInButtons
                  providers={providers}
                  disabled={pending}
                  onPress={(providerId) => void signInWithProvider(providerId)}
                />
              ) : null}
              {error ? (
                <p role="alert" className="mt-4 w-full text-center text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : chooser ? (
            <div
              className={`flex w-full flex-col items-center text-[16px] text-[#8A8590] ${logoOnly ? "mt-[38px]" : ""}`}
            >
              <SocialSignInButtons
                providers={providers}
                disabled={pending || passkey.pending}
                onPress={(providerId) => void signInWithProvider(providerId)}
                onEmail={() => {
                  setError(null);
                  navigate(`${chooserPath}/email${nextQuery}`, { state: { authChooser: true } });
                }}
                onPasskey={mode === "in" && passkey.supported ? passkey.start : undefined}
              />
              {error ? (
                <p role="alert" className="mt-4 w-full text-center text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <p className="mt-[30px] text-center">
                {mode === "in" ? (
                  <>
                    <Trans>Don’t have an account?</Trans>{" "}
                    <Link to={`/sign-up${nextQuery}`} className="font-medium text-foreground">
                      <Trans>Sign up</Trans>
                    </Link>
                  </>
                ) : (
                  <>
                    <Trans>Already have an account?</Trans>{" "}
                    <Link to={`/sign-in${nextQuery}`} className="font-medium text-foreground">
                      <Trans>Sign in</Trans>
                    </Link>
                  </>
                )}
              </p>
            </div>
          ) : (
            <>
              {mode === "up" && !codeStep ? (
                <label className="mb-4 w-full text-[16px] text-[#8A8590]">
                  <Trans>Name</Trans>
                  <input
                    id="name"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t`Your name`}
                    className="mt-2 w-full rounded-[13px] border border-[var(--rk-hairline-strong)] bg-[var(--rk-main)] px-[18px] py-[17px] text-[17px] text-[#F1F0F3] outline-none focus:border-[var(--rk-accent)]"
                  />
                </label>
              ) : null}
              {codeStep ? (
                <div className="flex w-full justify-center">
                  <InputOTP
                    aria-label={t({ message: "Code", context: "email sign-in" })}
                    maxLength={CODE_LENGTH}
                    pattern={"^\\d+$"}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={setCode}
                    onComplete={(value: string) => void verifyCode(value)}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="size-12 text-heading3 first:rounded-l-xl last:rounded-r-xl"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              ) : (
                <>
                  <label
                    className={`w-full text-[16px] text-[#8A8590] ${logoOnly ? "mt-[38px]" : ""}`}
                  >
                    <Trans>Email</Trans>
                    <input
                      id="email"
                      name="email"
                      autoComplete={mode === "in" ? "username webauthn" : "username"}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setEmailBlurred(false);
                      }}
                      onBlur={() => setEmailBlurred(true)}
                      placeholder={t`Your email address`}
                      type="email"
                      required
                      className="mt-2 w-full rounded-[13px] border border-[var(--rk-hairline-strong)] bg-[var(--rk-main)] px-[18px] py-[17px] text-[17px] text-[#F1F0F3] outline-none focus:border-[var(--rk-accent)]"
                    />
                  </label>
                  {emailSuggestion && emailBlurred ? (
                    <p role="status" className="mt-2 w-full text-sm text-warning">
                      <Trans>
                        Did you mean{" "}
                        <button
                          type="button"
                          className="font-medium underline"
                          onClick={() => setEmail(emailSuggestion)}
                        >
                          {emailSuggestion}
                        </button>
                        ?
                      </Trans>
                    </p>
                  ) : null}
                </>
              )}
              {mode !== "forgot" && !codeStep ? (
                <div className="mt-4 w-full text-[16px] text-[#8A8590]">
                  <label htmlFor={passwordFieldId}>
                    <Trans>Password</Trans>
                  </label>
                  <div className="relative mt-2">
                    <input
                      id={passwordFieldId}
                      name="password"
                      autoComplete={mode === "in" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t`Password`}
                      type={showPassword ? "text" : "password"}
                      required={!useCode}
                      minLength={mode === "up" ? MIN_PASSWORD_LENGTH : undefined}
                      maxLength={MAX_PASSWORD_LENGTH}
                      className="w-full rounded-[13px] border border-[var(--rk-hairline-strong)] bg-[var(--rk-main)] py-[17px] pl-[18px] pr-[52px] text-[17px] text-[#F1F0F3] outline-none focus:border-[var(--rk-accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((shown) => !shown)}
                      aria-label={showPassword ? t`Hide password` : t`Show password`}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex items-center px-[18px] text-[#8A8590] hover:text-[#F1F0F3]"
                    >
                      {showPassword ? (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" y1="2" x2="22" y2="22" />
                        </svg>
                      ) : (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {mode === "in" && reset?.passwordReset ? (
                    <div className="mt-2 text-right text-[14px]">
                      <Link to="/forgot-password" className="font-medium text-[#F1F0F3]">
                        <Trans>Forgot password?</Trans>
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="mt-3 w-full text-sm text-[#EF4444]">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={pending || (codeStep && code.length < CODE_LENGTH)}
                className="mt-3 w-full rounded-[13px] bg-[var(--rk-accent-strong)] py-[18px] text-center text-[17px] font-medium text-white hover:bg-[var(--rk-accent)] disabled:opacity-60"
              >
                {pending ? (
                  <Trans>Working…</Trans>
                ) : codeMode ? (
                  <Trans>Continue</Trans>
                ) : mode === "in" ? (
                  <Trans>Sign in</Trans>
                ) : mode === "forgot" ? (
                  <Trans>Send reset link</Trans>
                ) : (
                  <Trans>Create account</Trans>
                )}
              </button>
              {mode === "in" && !codeStep ? (
                <PasskeySignIn
                  autoFillOnly={presented}
                  disabled={pending}
                  className="mt-3 h-auto w-full rounded-[13px] border border-[var(--rk-hairline-strong)] bg-transparent py-[17px] text-[16px] text-[#F1F0F3] hover:bg-[var(--rk-main)]"
                  onSignedIn={enterApp}
                  onError={setError}
                />
              ) : null}
              {reset?.demoAccount && mode !== "forgot" && !codeStep ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={pending}
                  className={submitClass}
                  onClick={() => reset.demoAccount && void signInAsDemo(reset.demoAccount)}
                >
                  <Trans>Sign in with demo account</Trans>
                </Button>
              ) : null}
              {codeStep ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={leaveCodeStep}
                  className="mt-3 text-[14px] text-[#8A8590] hover:text-[#F1F0F3]"
                >
                  <Trans>Back</Trans>
                </button>
              ) : null}
              {codeStep ? null : (
                <p className="mt-[30px] text-center text-[16px] text-[#8A8590]">
                  {mode === "in" ? (
                    <>
                      <Trans>Don’t have an account?</Trans>{" "}
                      <Link
                        to={`/sign-up${presented ? "/email" : ""}${nextQuery}`}
                        replace={presented}
                        state={location.state}
                        className="font-medium text-[#F1F0F3]"
                      >
                        <Trans>Sign up</Trans>
                      </Link>
                    </>
                  ) : mode === "up" ? (
                    <>
                      <Trans>Already have an account?</Trans>{" "}
                      <Link
                        to={`/sign-in${presented ? "/email" : ""}${nextQuery}`}
                        replace={presented}
                        state={location.state}
                        className="font-medium text-[#F1F0F3]"
                      >
                        <Trans>Sign in</Trans>
                      </Link>
                    </>
                  ) : (
                    <Link to={`/sign-in${nextQuery}`} className="font-medium text-[#F1F0F3]">
                      <Trans>Back to sign in</Trans>
                    </Link>
                  )}
                </p>
              )}
            </>
          )}
        </form>
      </div>
      <ChangeServerButton />
    </div>
  );
}

export function PasswordResetPage() {
  const { t } = useLingui();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") || !params.get("token") ? t`This reset link is invalid or expired` : null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const token = params.get("token");
    if (!token) return;
    if (password !== confirmation) {
      setError(t`Passwords do not match`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(authErrorText(result.error, t`Could not reset password`));
        return;
      }
      setComplete(true);
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame onSubmit={submit} title={<Trans>Choose a new password</Trans>}>
      {complete ? (
        <div role="status" className="w-full text-center">
          <p className="text-heading3">
            <Trans>Password updated</Trans>
          </p>
          <Link to="/sign-in" className="mt-6 inline-block font-medium">
            <Trans>Sign in</Trans>
          </Link>
        </div>
      ) : (
        <>
          <PasswordField
            id="new-password"
            label={t`New password`}
            value={password}
            onChange={setPassword}
          />
          <PasswordField
            id="confirm-password"
            label={t`Confirm password`}
            value={confirmation}
            onChange={setConfirmation}
            className="mt-4"
          />
          {error ? (
            <p role="alert" className="mt-3 w-full text-body text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            disabled={pending || !params.get("token")}
            className={submitClass}
          >
            {pending ? <Trans>Working…</Trans> : <Trans>Reset password</Trans>}
          </Button>
          <Link to="/sign-in" className="mt-6 font-medium">
            <Trans>Back to sign in</Trans>
          </Link>
        </>
      )}
    </AuthFrame>
  );
}

export function AuthFrame({
  title,
  surface = false,
  leading,
  onSubmit,
  children,
}: {
  title: React.ReactNode;
  surface?: boolean;
  leading?: React.ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-full flex-col bg-background text-foreground"
      data-rakazo-surface="auth"
    >
      <div className="app-drag flex items-center gap-2 px-5 py-[18px]">
        <WindowChrome />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <form
          onSubmit={onSubmit}
          className={
            surface
              ? "flex w-full max-w-[520px] flex-col rounded-3xl border border-border bg-card px-8 pt-8 pb-9 shadow-sm"
              : "flex w-full max-w-[460px] flex-col items-center"
          }
        >
          {leading ? <div className="mb-4 self-start">{leading}</div> : null}
          <div className={surface ? "flex w-full flex-col items-center" : "contents"}>
            <BrandLogo
              className={
                brand.logo.viewBox
                  ? "h-[90px] w-[156px]"
                  : brand.logo.wide
                    ? "h-12 w-auto"
                    : "h-[74px] w-[74px]"
              }
            />
            <h1
              aria-live="polite"
              className={
                surface
                  ? "mt-5 mb-6 text-balance text-center text-4xl font-medium tracking-tight"
                  : "mt-7 mb-9 text-balance text-center text-4xl font-medium tracking-tight"
              }
            >
              {title}
            </h1>
          </div>
          {children}
        </form>
      </div>
      <ChangeServerButton />
    </div>
  );
}

/** The desktop app can point at another server from any signed-out page. */
function ChangeServerButton() {
  const server = desktopBridge()?.server;
  if (!server) return null;
  return (
    <div className="flex justify-center pb-6">
      <Button type="button" variant="text" size="sm" onClick={() => void server.change()}>
        <Trans>Change server</Trans>
      </Button>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`w-full ${className}`}>
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        name={id}
        autoComplete="new-password"
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      />
    </div>
  );
}
