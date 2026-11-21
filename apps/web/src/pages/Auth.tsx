import { Trans, useLingui } from "@lingui/react/macro";
import { credentialIssue, signupRequiresEmailVerification } from "@rakazo/core";
import { Button, Input, Label } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ParticleWordmark } from "../components/ai/ParticleWordmark";
import { BrandLogo } from "../components/BrandLogo";
import { authClient } from "../lib/auth";
import type { AuthCapabilities } from "../lib/auth-capabilities";
import { fetchAuthCapabilities } from "../lib/auth-capabilities";
import { brand, brandName } from "../lib/brand";
import { signInReturnPath } from "../lib/return-path";
import { clearSpaceSelection } from "../lib/rpc";
import { runSsoFlow } from "../lib/sso-flow";
import { authErrorText, credentialIssueText } from "../lib/user-error";

type AuthMode = "in" | "up" | "forgot";

const fieldClass = "mt-2 h-12 rounded-xl px-4 text-base md:text-base";
export const submitClass = "mt-3 h-12 w-full rounded-xl text-base";

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get("error");
    if (!code) return null;
    return authErrorText({ code }, t`Could not continue`);
  });
  const [pending, setPending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // Signup triggers a session refresh that remounts the anonymous auth page.
  const sent = resetSent || searchParams.get("verify") === "email";
  const [reset, setReset] = useState<AuthCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const passwordFieldId = mode === "in" ? "current-password" : "new-password";
  const logoOnly = !sent && mode === "in" && brand.id !== "manor";
  const title = sent ? (
    <Trans>Check your email</Trans>
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
        setSearchParams({ verify: "email" });
        return;
      }
      clearSpaceSelection();
      navigate(
        mode === "up" ? "/onboarding" : (signInReturnPath(window.location.search) ?? "/app"),
      );
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  async function signInWithSso() {
    setError(null);
    try {
      const result = await runSsoFlow(
        (disableRedirect, callbackURL) =>
          authClient.signIn.social({
            disableRedirect,
            provider: "oidc",
            newUserCallbackURL: callbackURL("/onboarding"),
            callbackURL: callbackURL(
              searchParams.get("next") === "/integrations/setup" ? "/integrations/setup" : "/app",
            ),
            errorCallbackURL: callbackURL("/sign-in"),
          }),
        ["/app", "/onboarding", "/integrations/setup", "/sign-in"],
      );
      if (result.error) setError(authErrorText(result.error, t`Could not continue`));
    } catch {
      setError(t`Could not continue`);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--rk-page)] px-6 py-16 text-[#F1F0F3]">
      <form onSubmit={submit} className="flex w-[460px] flex-col items-center">
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
                <Trans>If an account exists for that address, we sent a password reset link.</Trans>
              </p>
            ) : null}
            <Link to="/sign-in" className="inline-block font-medium text-[#F1F0F3]">
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
            ) : !reset ? (
              <p role="status">
                <Trans>Loading…</Trans>
              </p>
            ) : null}
            {reset?.sso && mode !== "forgot" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void signInWithSso()}
                className="mt-3 w-full rounded-[13px] bg-[var(--rk-accent-strong)] py-[18px] text-center text-[17px] font-medium text-white hover:bg-[var(--rk-accent)]"
              >
                <Trans>Continue with {reset.sso.name}</Trans>
              </button>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-sm text-[#EF4444]">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {mode === "up" ? (
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
            <label className={`w-full text-[16px] text-[#8A8590] ${logoOnly ? "mt-[38px]" : ""}`}>
              <Trans>Email</Trans>
              <input
                id="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t`Your email address`}
                type="email"
                required
                className="mt-2 w-full rounded-[13px] border border-[var(--rk-hairline-strong)] bg-[var(--rk-main)] px-[18px] py-[17px] text-[17px] text-[#F1F0F3] outline-none focus:border-[var(--rk-accent)]"
              />
            </label>
            {mode !== "forgot" ? (
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
                    required
                    minLength={8}
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
              disabled={pending}
              className="mt-3 w-full rounded-[13px] bg-[var(--rk-accent-strong)] py-[18px] text-center text-[17px] font-medium text-white hover:bg-[var(--rk-accent)]"
            >
              {pending ? (
                <Trans>Working…</Trans>
              ) : mode === "in" ? (
                <Trans>Continue with email</Trans>
              ) : mode === "forgot" ? (
                <Trans>Send reset link</Trans>
              ) : (
                <Trans>Create account</Trans>
              )}
            </button>
            {reset?.sso && mode !== "forgot" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void signInWithSso()}
                className="mt-3 text-[14px] text-[#8A8590] hover:text-[#F1F0F3]"
              >
                <Trans>Continue with {reset.sso.name}</Trans>
              </button>
            ) : null}
            <p className="mt-[30px] text-[16px] text-[#8A8590]">
              {mode === "in" ? (
                <>
                  <Trans>Don’t have an account?</Trans>{" "}
                  <Link to="/sign-up" className="font-medium text-[#F1F0F3]">
                    <Trans>Sign up</Trans>
                  </Link>
                </>
              ) : mode === "up" ? (
                <>
                  <Trans>Already have an account?</Trans>{" "}
                  <Link to="/sign-in" className="font-medium text-[#F1F0F3]">
                    <Trans>Sign in</Trans>
                  </Link>
                </>
              ) : (
                <Link to="/sign-in" className="font-medium text-[#F1F0F3]">
                  <Trans>Back to sign in</Trans>
                </Link>
              )}
            </p>
          </>
        )}
      </form>
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
          <p className="text-lg">
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
            <p role="alert" className="mt-3 w-full text-sm text-destructive">
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
  onSubmit,
  children,
}: {
  title: React.ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-16 text-foreground">
      <form onSubmit={onSubmit} className="flex w-[460px] flex-col items-center">
        <BrandLogo
          className={
            brand.logo.viewBox
              ? "h-[90px] w-[156px]"
              : brand.logo.wide
                ? "h-12 w-auto"
                : "h-[74px] w-[74px]"
          }
        />
        <h1 aria-live="polite" className="mb-9 mt-7 text-4xl font-medium tracking-tight">
          {title}
        </h1>
        {children}
      </form>
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
        minLength={8}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      />
    </div>
  );
}
