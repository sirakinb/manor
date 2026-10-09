import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BuiButton, BuiCard, LoadingState } from "../components/beautiful-ui/primitives";
import { brandName } from "../lib/brand";
import { rpc, selectedSpaceId, withSpaceHeaders } from "../lib/rpc";
import { useWorkspaceAccess } from "../lib/use-workspace-access";

type AuthorizationDetails = { client_name: string; redirect_host: string; scopes: string[] };
type Space = { id: string; name: string };

/** OAuth consent for MCP clients such as claude.ai connectors. */
export function OAuthAuthorizePage() {
  const { t } = useLingui();
  const [params] = useSearchParams();
  const { access } = useWorkspaceAccess();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`/v1/oauth/authorize?${params}`, {
        credentials: "include",
        headers: withSpaceHeaders(),
      }).then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(body?.error?.message ?? t`This connection request is invalid.`);
        return body as AuthorizationDetails;
      }),
      rpc.spaces.list(),
    ])
      .then(([loaded, navigation]) => {
        setDetails(loaded);
        setScopes(loaded.scopes);
        setSpaces(navigation.spaces);
        const preferred = selectedSpaceId();
        setSpaceId(
          navigation.spaces.some((space) => space.id === preferred)
            ? preferred
            : navigation.current.id,
        );
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : t`This connection request is invalid.`),
      );
  }, [params, t]);

  const offered = (details?.scopes ?? []).filter(
    (scope) => access?.workspace || !scope.startsWith("workspace:"),
  );
  const granted = scopes.filter((scope) => offered.includes(scope));

  function deny() {
    const redirect = new URL(params.get("redirect_uri") ?? "");
    redirect.searchParams.set("error", "access_denied");
    const state = params.get("state");
    if (state) redirect.searchParams.set("state", state);
    window.location.assign(redirect.href);
  }

  async function allow() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/v1/oauth/authorize", {
        method: "POST",
        credentials: "include",
        headers: withSpaceHeaders({ "content-type": "application/json" }, spaceId),
        body: JSON.stringify({ ...Object.fromEntries(params), scopes: granted }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? t`Could not connect`);
      window.location.assign(body.redirect_to);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not connect`);
      setPending(false);
    }
  }

  // Approval must never be clickable inside another site's frame.
  if (window.top !== window.self) return null;

  if (!details) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--rk-page)] p-6 text-center">
        {error ? (
          <div>
            <div className="text-lg text-[#F1F1F2]">
              <Trans>Connection failed</Trans>
            </div>
            <p className="mt-2 max-w-md text-sm text-[#85858B]">{error}</p>
          </div>
        ) : (
          <LoadingState label={t`loading`} />
        )}
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--rk-page)] p-6">
      <BuiCard className="flex w-full max-w-md flex-col gap-5 p-6 text-[#F1F1F2]">
        <div>
          <h1 className="text-lg font-semibold">
            <Trans>
              Connect {details.client_name} to {brandName}
            </Trans>
          </h1>
          <p className="mt-1 text-sm text-[#85858B]">
            <Trans>You will return to {details.redirect_host}.</Trans>
          </p>
        </div>
        {spaces.length > 1 ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[#85858B]">
              <Trans>Space</Trans>
            </span>
            <select
              value={spaceId ?? ""}
              onChange={(event) => setSpaceId(event.target.value)}
              className="rounded-lg border border-[#34343B] bg-transparent px-3 py-2"
            >
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1.5 text-sm text-[#85858B]">
            <Trans>Access</Trans>
          </legend>
          {offered.map((scope) => {
            const selected = scopes.includes(scope);
            return (
              <button
                key={scope}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setScopes((current) =>
                    selected ? current.filter((value) => value !== scope) : [...current, scope],
                  )
                }
                className={`rounded-full border px-3 py-1.5 font-mono text-xs ${
                  selected
                    ? "border-[#A855F7] bg-[#A855F722] text-[#E9D5FF]"
                    : "border-[#34343B] text-[#85858A]"
                }`}
              >
                {scope}
              </button>
            );
          })}
        </fieldset>
        {error ? <p className="text-sm text-[#F87171]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <BuiButton onClick={deny} disabled={pending}>
            <Trans>Cancel</Trans>
          </BuiButton>
          <BuiButton
            tone="accent"
            onClick={() => void allow()}
            disabled={pending || !spaceId || granted.length === 0}
          >
            {pending ? <Trans>Connecting…</Trans> : <Trans>Allow</Trans>}
          </BuiButton>
        </div>
      </BuiCard>
    </div>
  );
}
