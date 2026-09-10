import { TEAM_HEARTBEAT_MS, TEAM_IDLE_MS } from "@rakazo/contracts";
import { useEffect } from "react";
import { rpc } from "./rpc";

export function useTeamPresence() {
  useEffect(() => {
    let lastInput = Date.now();
    let lastSent = 0;
    let pending = false;
    const heartbeat = () => {
      const now = Date.now();
      if (
        pending ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        now - lastInput >= TEAM_IDLE_MS ||
        now - lastSent < TEAM_HEARTBEAT_MS
      )
        return;
      pending = true;
      lastSent = now;
      void rpc.team
        .heartbeat()
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };
    const activity = () => {
      lastInput = Date.now();
      heartbeat();
    };
    const events = ["pointerdown", "pointermove", "keydown", "scroll", "focus"] as const;
    for (const event of events) window.addEventListener(event, activity, { passive: true });
    document.addEventListener("visibilitychange", heartbeat);
    heartbeat();
    const timer = window.setInterval(heartbeat, TEAM_HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      for (const event of events) window.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, []);
}
