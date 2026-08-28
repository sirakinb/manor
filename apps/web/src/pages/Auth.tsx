import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth";

export function AuthPage({ mode }: { mode: "in" | "up" }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const title = mode === "in" ? <Trans>Sign in to Manor</Trans> : <Trans>Create your Manor</Trans>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result =
      mode === "up"
        ? await authClient.signUp.email({
            email,
            password,
            name: name || email.split("@")[0] || "User",
          })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? t`Could not continue`);
      return;
    }
    navigate(mode === "up" ? "/onboarding" : "/app");
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[#050308] px-6 py-16 text-[#F1F0F3]">
      <form onSubmit={submit} className="flex w-[460px] flex-col items-center">
        <img src="/manor-mark.png" alt="" className="h-[74px] w-[74px]" />
        <h1 className="rk-serif mb-[38px] mt-[30px] text-[38px]">{title}</h1>
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
              className="mt-2 w-full rounded-[13px] border border-[#262130] bg-[#0C0B0E] px-[18px] py-[17px] text-[17px] text-[#F1F0F3] outline-none focus:border-[#A855F7]"
            />
          </label>
        ) : null}
        <label className="w-full text-[16px] text-[#8A8590]">
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
            className="mt-2 w-full rounded-[13px] border border-[#262130] bg-[#0C0B0E] px-[18px] py-[17px] text-[17px] text-[#F1F0F3] outline-none focus:border-[#A855F7]"
          />
        </label>
        <label className="mt-4 w-full text-[16px] text-[#8A8590]">
          <Trans>Password</Trans>
          <input
            id={mode === "in" ? "current-password" : "new-password"}
            name="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t`Password`}
            type="password"
            required
            minLength={8}
            className="mt-2 w-full rounded-[13px] border border-[#262130] bg-[#0C0B0E] px-[18px] py-[17px] text-[17px] text-[#F1F0F3] outline-none focus:border-[#A855F7]"
          />
        </label>
        {error ? <p className="mt-3 w-full text-sm text-[#C94244]">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-3 w-full rounded-[13px] bg-[#9333EA] py-[18px] text-center text-[17px] font-medium text-white hover:bg-[#A855F7]"
        >
          {pending ? (
            <Trans>Working…</Trans>
          ) : mode === "in" ? (
            <Trans>Continue with email</Trans>
          ) : (
            <Trans>Create account</Trans>
          )}
        </button>
        <p className="mt-[30px] text-[16px] text-[#8A8590]">
          {mode === "in" ? (
            <>
              <Trans>Don’t have an account?</Trans>{" "}
              <Link to="/sign-up" className="font-medium text-[#F1F0F3]">
                <Trans>Sign up</Trans>
              </Link>
            </>
          ) : (
            <>
              <Trans>Already have an account?</Trans>{" "}
              <Link to="/sign-in" className="font-medium text-[#F1F0F3]">
                <Trans>Sign in</Trans>
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
