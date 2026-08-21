import { Button } from "@rakazo/ui-web";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "../lib/rpc";

type CatalogEntry = {
  provider: string;
  providerName?: string;
  id: string;
  label: string;
  billing: string;
  auth?: "api-key" | "oauth" | "both";
  oauthLabel?: string;
  subscription?: boolean;
  signIn?: "device-code" | "auth-url";
};

export function ModelOverlay({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [current, setCurrent] = useState<{ provider: string; modelId: string } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [oauth, setOauth] = useState<{
    verificationUri: string;
    userCode: string;
    mode: "device-code" | "auth-url";
    loginId: string;
  } | null>(null);
  const [pasteCode, setPasteCode] = useState("");

  useEffect(() => {
    void Promise.all([rpc.me(), rpc.models.list().catch(() => [])])
      .then(([me, models]) => {
        setCatalog(models);
        if (me.defaultProvider && me.defaultModel) {
          setCurrent({ provider: me.defaultProvider, modelId: me.defaultModel });
          setProvider(me.defaultProvider);
          setModelId(me.defaultModel);
        } else if (models[0]) {
          setProvider(models[0].provider);
          setModelId(models[0].id);
        }
      })
      .catch(() => setError("Could not load the model catalog"));
  }, []);

  const providers = useMemo(() => {
    const seen = new Map<string, CatalogEntry>();
    for (const entry of catalog) if (!seen.has(entry.provider)) seen.set(entry.provider, entry);
    const list = [...seen.values()];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    const matching = new Set(
      catalog
        .filter((entry) =>
          `${entry.provider} ${entry.providerName ?? ""} ${entry.label} ${entry.id}`
            .toLowerCase()
            .includes(needle),
        )
        .map((entry) => entry.provider),
    );
    return list.filter((entry) => matching.has(entry.provider));
  }, [catalog, query]);

  const models = useMemo(
    () => catalog.filter((entry) => entry.provider === provider),
    [catalog, provider],
  );
  const selected = models.find((entry) => entry.id === modelId) ?? models[0];
  const subscriptionSignIn = selected?.signIn === "device-code" || selected?.signIn === "auth-url";
  const acceptsKey = selected?.auth !== "oauth";
  const isCurrent = current?.provider === provider && current?.modelId === (selected?.id ?? "");

  async function useModel() {
    if (!selected) return;
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      if (apiKey.trim()) {
        await rpc.models.connect({
          provider,
          apiKey: apiKey.trim(),
          modelId: selected.id,
          label: selected.providerName ?? provider,
        });
        setApiKey("");
      }
      await rpc.models.setDefault({ provider, modelId: selected.id });
      setCurrent({ provider, modelId: selected.id });
      setNotice(`Now using ${selected.label}. New messages use this model.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch model");
    } finally {
      setPending(false);
    }
  }

  async function signIn() {
    if (!selected) return;
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const started = await rpc.models.beginOAuth({
        provider,
        modelId: selected.id,
        label: selected.providerName ?? provider,
      });
      setPasteCode("");
      setOauth({
        verificationUri: started.verificationUri,
        userCode: started.userCode,
        mode: started.mode,
        loginId: started.loginId,
      });
      window.open(started.verificationUri, "_blank", "noopener,noreferrer");
      for (let i = 0; i < 180; i += 1) {
        const row = await rpc.models.completeOAuth({ loginId: started.loginId });
        if (row.status === "connected") {
          await rpc.models.setDefault({ provider, modelId: selected.id });
          setCurrent({ provider, modelId: selected.id });
          setNotice(`Signed in. Now using ${selected.label}.`);
          setOauth(null);
          return;
        }
        if (row.status === "error") {
          setError(row.error);
          setOauth(null);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      setError("Sign-in timed out. Try again.");
      setOauth(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in");
      setOauth(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-10">
      <div className="flex h-[640px] w-[920px] max-w-full flex-col overflow-hidden rounded-[26px] border border-[#232326] bg-[#141216] shadow-[0_40px_90px_rgba(0,0,0,.55)]">
        <div className="flex items-start justify-between px-8 pt-7">
          <div>
            <div className="text-2xl font-medium text-[#F1F1F2]">AI Model</div>
            <p className="mt-1 text-[13.5px] text-[#7A7A80]">
              {current
                ? `Current: ${catalog.find((entry) => entry.provider === current.provider && entry.id === current.modelId)?.label ?? current.modelId}`
                : "No model connected yet"}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[#85858A]">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 gap-0 pt-4">
          <div className="flex w-[320px] flex-col border-r border-[#232326]">
            <div className="px-6 pb-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search providers"
                className="w-full rounded-[13px] border border-[#26262A] bg-[#101012] px-4 py-2.5 text-[14px] text-[#ECECEE] outline-none"
              />
            </div>
            <div className="rk-scroll flex-1 overflow-y-auto px-3 pb-4">
              {providers.map((entry) => (
                <button
                  key={entry.provider}
                  type="button"
                  onClick={() => {
                    setProvider(entry.provider);
                    const first = catalog.find(
                      (candidate) => candidate.provider === entry.provider,
                    );
                    if (first) setModelId(first.id);
                    setError(null);
                    setNotice(null);
                  }}
                  className="flex w-full items-center justify-between rounded-[11px] px-3 py-2.5 text-left hover:bg-[#1B1820]"
                  style={{ background: provider === entry.provider ? "#1B1820" : "transparent" }}
                >
                  <span className="text-[14.5px] text-[#ECECEE]">
                    {entry.providerName ?? entry.provider}
                  </span>
                  {current?.provider === entry.provider ? (
                    <span className="h-2 w-2 rounded-full bg-[#A855F7]" />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <div className="rk-scroll flex-1 overflow-y-auto px-7 py-2">
            {models.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setModelId(entry.id);
                  setError(null);
                  setNotice(null);
                }}
                className="mb-1.5 flex w-full items-center justify-between rounded-[11px] border px-4 py-3 text-left"
                style={{
                  borderColor: selected?.id === entry.id ? "#A855F7" : "#232326",
                  background: selected?.id === entry.id ? "rgba(168,85,247,.07)" : "transparent",
                }}
              >
                <span>
                  <span className="block text-[14.5px] text-[#ECECEE]">{entry.label}</span>
                  <span className="block text-[12.5px] text-[#7A7A80]">
                    {entry.id} · {entry.billing}
                  </span>
                </span>
                {current?.provider === entry.provider && current?.modelId === entry.id ? (
                  <span className="rk-label text-[10px] text-[#A855F7]">Current</span>
                ) : null}
              </button>
            ))}
            {selected ? (
              <div className="mt-4 border-t border-[#232326] pt-4">
                {oauth ? (
                  <div className="rounded-[13px] border border-[#262130] bg-[#0C0B10] p-4">
                    {oauth.mode === "auth-url" ? (
                      <>
                        <p className="text-[14px] text-[#DFDDE3]">
                          Finish signing in at{" "}
                          <a
                            href={oauth.verificationUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#A855F7] underline"
                          >
                            claude.ai
                          </a>
                          . When the final page fails to load, copy its URL (or the code it shows)
                          and paste it here:
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <input
                            value={pasteCode}
                            onChange={(e) => setPasteCode(e.target.value)}
                            placeholder="http://localhost:53692/callback?code=…"
                            className="w-full rounded-[11px] border border-[#26262A] bg-[#101012] px-3.5 py-2.5 text-[13px] text-[#ECECEE] outline-none focus:border-[#A855F7]"
                          />
                          <Button
                            type="button"
                            disabled={!pasteCode.trim()}
                            onClick={() => {
                              const code = pasteCode.trim();
                              if (!code) return;
                              void rpc.models
                                .submitOAuthCode({ loginId: oauth.loginId, code })
                                .then(() => setPasteCode(""))
                                .catch((err) =>
                                  setError(
                                    err instanceof Error ? err.message : "Could not submit code",
                                  ),
                                );
                            }}
                          >
                            Submit
                          </Button>
                        </div>
                        <p className="mt-2 text-[12.5px] text-[#7A7A80]">Waiting for sign-in…</p>
                      </>
                    ) : (
                      <>
                        <p className="text-[14px] text-[#DFDDE3]">
                          Enter this code at{" "}
                          <a
                            href={oauth.verificationUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#A855F7] underline"
                          >
                            {oauth.verificationUri}
                          </a>
                        </p>
                        <p className="mt-2 font-mono text-[22px] tracking-[0.2em] text-[#F1F0F3]">
                          {oauth.userCode}
                        </p>
                        <p className="mt-2 text-[12.5px] text-[#7A7A80]">Waiting for sign-in…</p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {acceptsKey ? (
                      <input
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={`${selected.providerName ?? provider} API key (leave blank if already connected)`}
                        type="password"
                        className="w-full rounded-[13px] border border-[#26262A] bg-[#101012] px-4 py-3 text-[14px] text-[#ECECEE] outline-none focus:border-[#A855F7]"
                      />
                    ) : null}
                    <div className="flex items-center gap-3">
                      {subscriptionSignIn ? (
                        <Button type="button" disabled={pending} onClick={() => void signIn()}>
                          {pending ? "Working…" : (selected.oauthLabel ?? "Sign in")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        disabled={pending || isCurrent}
                        onClick={() => void useModel()}
                      >
                        {isCurrent ? "Current model" : pending ? "Working…" : "Use this model"}
                      </Button>
                    </div>
                  </div>
                )}
                {error ? <p className="mt-3 text-sm text-[#C94244]">{error}</p> : null}
                {notice ? <p className="mt-3 text-sm text-[#4ECB71]">{notice}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
