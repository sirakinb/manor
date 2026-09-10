import { Trans } from "@lingui/react/macro";
import { TEAM_HEARTBEAT_MS, type TeamMember } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";
import { BuiCard, LoadingState } from "./beautiful-ui/primitives";

export function TeamMembers() {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const next = await rpc.team.list();
        if (!disposed) {
          setMembers(next);
          setFailed(false);
        }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, TEAM_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <BuiCard className="mt-5 p-4" role="region" aria-labelledby="team-members-title">
      <h3 id="team-members-title" className="text-[15px] font-medium">
        <Trans>Team</Trans>
      </h3>
      {failed ? (
        <p role="status" className="mt-3 text-sm">
          <Trans>Team activity is unavailable. Retrying…</Trans>
        </p>
      ) : null}
      {!members && !failed ? <LoadingState /> : null}
      <ul className="mt-3 divide-y divide-[var(--rk-hairline)]">
        {members?.map((member) => (
          <li key={member.id} className="py-3" data-testid="team-member">
            <div className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: failed ? "#85858a" : member.active ? "#4ade80" : "#85858a" }}
              />
              <span className="font-medium">{member.name}</span>
              <span className="ml-auto text-xs text-[var(--rk-accent-soft)]">{member.role}</span>
            </div>
            <p className="mt-1 text-xs text-[#a2a2a8]">
              {failed ? (
                <Trans>Status unavailable</Trans>
              ) : member.active ? (
                <Trans>Active now</Trans>
              ) : member.lastActiveAt ? (
                <>
                  <Trans>Last active</Trans>:{" "}
                  <time dateTime={member.lastActiveAt}>
                    {new Date(member.lastActiveAt).toLocaleString()}
                  </time>
                </>
              ) : (
                <Trans>No activity yet</Trans>
              )}
            </p>
            <p className="mt-1 text-xs text-[#a2a2a8]">
              <Trans>Last sign-in</Trans>:{" "}
              {member.lastSignedInAt ? (
                <time dateTime={member.lastSignedInAt}>
                  {new Date(member.lastSignedInAt).toLocaleString()}
                </time>
              ) : (
                <Trans>Not recorded yet</Trans>
              )}
            </p>
          </li>
        ))}
      </ul>
    </BuiCard>
  );
}
