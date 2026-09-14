import { Trans } from "@lingui/react/macro";
import type { ComputerMode, LocalComputerLiveSession } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

export function ComputerModePicker({
  value,
  onChange,
  session,
}: {
  value: ComputerMode;
  onChange: (value: ComputerMode) => void;
  session?: LocalComputerLiveSession | null;
}) {
  const [live, setLive] = useState<LocalComputerLiveSession | null>(session ?? null);

  useEffect(() => {
    setLive(session ?? null);
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const next = await rpc.localComputer.session();
        if (!cancelled) setLive(next);
      } catch {
        /* picker still works for Team / Private */
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const connected = Boolean(live?.connected);

  return (
    <div className="mt-4">
      <div className="text-[14px] text-[#85858A]">
        <Trans>Computer</Trans>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["team", "dedicated"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
            className={`rounded-[11px] border px-3.5 py-3 text-[14px] capitalize ${
              value === mode
                ? "border-[#6C6C70] bg-[#1A1A1D] text-[#ECECEE]"
                : "border-[#26262A] text-[#85858A]"
            }`}
          >
            {mode === "team" ? <Trans>Team</Trans> : <Trans>Private</Trans>}
          </button>
        ))}
        <button
          type="button"
          data-testid="computer-mode-this-mac"
          aria-pressed={value === "local"}
          disabled={!connected}
          onClick={() => {
            if (connected) onChange("local");
          }}
          className={`col-span-2 rounded-[11px] border px-3.5 py-3 text-[14px] ${
            value === "local"
              ? "border-[#6C6C70] bg-[#1A1A1D] text-[#ECECEE]"
              : "border-[#26262A] text-[#85858A]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <Trans>This Mac</Trans>
        </button>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[#6C6C70]">
        {connected ? (
          <Trans>Shared folder on this laptop, only while desktop is sharing.</Trans>
        ) : (
          <Trans>Open Manor desktop to share this Mac.</Trans>
        )}
      </p>
    </div>
  );
}
