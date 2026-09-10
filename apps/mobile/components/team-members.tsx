import { TEAM_HEARTBEAT_MS, type TeamMember } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Text, View } from "react-native";
import { rpc } from "../lib/api";

export function TeamMembers() {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending || AppState.currentState !== "active") return;
      pending = true;
      try {
        const next = await rpc<TeamMember[]>("team/list");
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
    const timer = setInterval(refresh, TEAM_HEARTBEAT_MS);
    const listener = AppState.addEventListener("change", () => {
      void refresh();
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  return (
    <View
      accessibilityLabel="Team"
      style={{ padding: 16, borderRadius: 14, backgroundColor: "#171719", gap: 12 }}
    >
      <Text style={{ color: "#f1f1f2", fontSize: 16, fontWeight: "600" }}>Team</Text>
      {failed ? (
        <Text style={{ color: "#a2a2a8" }}>Team activity is unavailable. Retrying…</Text>
      ) : null}
      {!members && !failed ? <ActivityIndicator /> : null}
      {members?.map((member) => (
        <View key={member.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              accessible={false}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: !failed && member.active ? "#4ade80" : "#85858a",
              }}
            />
            <Text style={{ color: "#f1f1f2", flex: 1 }}>{member.name}</Text>
            <Text style={{ color: "#a2a2a8", fontSize: 12 }}>{member.role}</Text>
          </View>
          <Text style={{ color: "#a2a2a8", fontSize: 12 }}>
            {failed
              ? "Status unavailable"
              : member.active
                ? "Active now"
                : member.lastActiveAt
                  ? `Last active: ${new Date(member.lastActiveAt).toLocaleString()}`
                  : "No activity yet"}
          </Text>
          <Text style={{ color: "#a2a2a8", fontSize: 12 }}>
            Last sign-in:{" "}
            {member.lastSignedInAt
              ? new Date(member.lastSignedInAt).toLocaleString()
              : "Not recorded yet"}
          </Text>
        </View>
      ))}
    </View>
  );
}
