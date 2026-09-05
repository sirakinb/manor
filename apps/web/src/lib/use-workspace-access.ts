import type { WorkspaceAccess } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "./rpc";

export function useWorkspaceAccess() {
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    rpc.workspace.access().then(
      (value) => {
        if (!cancelled) setAccess(value);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return { access, failed, retry: () => setAttempt((value) => value + 1) };
}
