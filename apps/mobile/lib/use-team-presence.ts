import { TEAM_HEARTBEAT_MS, TEAM_IDLE_MS } from "@rakazo/contracts";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { loadSessionToken, rpc } from "./api";

export function useTeamPresence(ready: boolean) {
  const lastInput = useRef(Date.now());
  const activity = useCallback(() => {
    lastInput.current = Date.now();
  }, []);
  useEffect(() => {
    if (!ready) return;
    let pending = false;
    let disposed = false;
    const heartbeat = async () => {
      if (
        pending ||
        AppState.currentState !== "active" ||
        Date.now() - lastInput.current >= TEAM_IDLE_MS
      )
        return;
      pending = true;
      try {
        if (await loadSessionToken()) {
          if (!disposed && AppState.currentState === "active") await rpc("team/heartbeat");
        }
      } catch {
        /* Presence recovers on the next heartbeat. */
      } finally {
        pending = false;
      }
    };
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        activity();
        void heartbeat();
      }
    });
    void heartbeat();
    const timer = setInterval(heartbeat, TEAM_HEARTBEAT_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
      listener.remove();
    };
  }, [ready, activity]);
  return activity;
}
