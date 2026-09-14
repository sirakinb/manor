import { Trans, useLingui } from "@lingui/react/macro";
import type { RakazoDesktopLocalComputerStatus } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";
import { BuiButton } from "./beautiful-ui/primitives";

const DEVICE_TOKEN_KEY = "manor.local-computer.device-token";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string) {
  try {
    window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  } catch {
    /* ignore quota */
  }
}

/**
 * Share-this-Mac controls. Rendered only inside desktop Settings.
 * The website has no disk access and must not start a share.
 */
export function ShareThisMacSettings({ onSharingChange }: { onSharingChange?: () => void }) {
  const { t } = useLingui();
  const desktop = desktopBridge()?.localComputer;
  const [status, setStatus] = useState<RakazoDesktopLocalComputerStatus>({
    sharing: false,
    folderName: null,
    lastCommand: null,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void desktop.status().then((next) => {
      if (!cancelled) setStatus(next);
    });
    const unsubscribe = desktop.onChange((next) => setStatus(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [desktop]);

  if (!desktop) return null;

  async function ensureToken(): Promise<string> {
    const stored = readStoredToken();
    if (stored) return stored;
    const created = await rpc.localComputer.register({ name: "This Mac" });
    writeStoredToken(created.token);
    return created.token;
  }

  async function share() {
    if (!desktop || pending) return;
    setPending(true);
    setError(null);
    try {
      const folderPath = await desktop.pickFolder();
      if (!folderPath) return;
      let token = await ensureToken();
      try {
        await desktop.connect({ origin: window.location.origin, token, folderPath });
      } catch {
        const created = await rpc.localComputer.register({ name: "This Mac" });
        writeStoredToken(created.token);
        token = created.token;
        await desktop.connect({ origin: window.location.origin, token, folderPath });
      }
      onSharingChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not share this Mac`);
    } finally {
      setPending(false);
    }
  }

  async function stop() {
    if (!desktop || pending) return;
    setPending(true);
    setError(null);
    try {
      await desktop.stop();
      await rpc.localComputer.stop().catch(() => undefined);
      onSharingChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not stop sharing`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      data-testid="share-this-mac-settings"
      className="mt-5 rounded-[14px] border border-[#26262A] bg-[#101012] px-4 py-4"
    >
      <h3 className="text-[15px] font-medium text-[#ECECEE]">
        <Trans>Share this Mac</Trans>
      </h3>
      <p className="mt-3 text-[13px] leading-relaxed text-[#7A7A80]">
        <Trans>
          Pick one folder on this laptop. Writes and shell need Allow once. Overnight work stays on
          the cloud computer.
        </Trans>
      </p>
      {status.sharing ? (
        <p className="mt-3 text-[14px] text-[#C9C9CE]">
          <Trans>Manor is using this Mac</Trans>
          {status.folderName ? ` · ${status.folderName}` : null}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-[#EF4444]">
          {error}
        </p>
      ) : null}
      <div className="mt-4">
        {status.sharing ? (
          <BuiButton tone="accent" disabled={pending} onClick={() => void stop()}>
            {pending ? <Trans>Stopping…</Trans> : <Trans>Stop</Trans>}
          </BuiButton>
        ) : (
          <BuiButton tone="accent" disabled={pending} onClick={() => void share()}>
            {pending ? <Trans>Sharing…</Trans> : <Trans>Share this Mac</Trans>}
          </BuiButton>
        )}
      </div>
    </section>
  );
}
