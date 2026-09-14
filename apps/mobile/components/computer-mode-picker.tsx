import type { ComputerMode, LocalComputerLiveSession } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";

export function ComputerModePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ComputerMode | undefined;
  onChange: (mode: ComputerMode) => void;
  disabled?: boolean;
}) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const session = await rpc<LocalComputerLiveSession>("localComputer/session");
        if (!cancelled) setConnected(session.connected);
      } catch {
        if (!cancelled) setConnected(false);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ color: "#85858A", marginBottom: 8, fontSize: 14 }}>Computer</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["team", "dedicated"] as const).map((mode) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityState={{ selected: value === mode }}
            disabled={disabled}
            onPress={() => onChange(mode)}
            style={{
              flex: 1,
              alignItems: "center",
              borderWidth: 1,
              borderColor: value === mode ? "#6C6C70" : "#26262A",
              backgroundColor: value === mode ? "#1A1A1D" : "transparent",
              borderRadius: 11,
              paddingVertical: 12,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Text style={{ color: value === mode ? "#ECECEE" : "#85858A" }}>
              {mode === "team" ? "Team" : "Private"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: value === "local", disabled: disabled || !connected }}
        disabled={disabled || !connected}
        onPress={() => onChange("local")}
        style={{
          marginTop: 8,
          alignItems: "center",
          borderWidth: 1,
          borderColor: value === "local" ? "#6C6C70" : "#26262A",
          backgroundColor: value === "local" ? "#1A1A1D" : "transparent",
          borderRadius: 11,
          paddingVertical: 12,
          opacity: disabled || !connected ? 0.5 : 1,
        }}
      >
        <Text style={{ color: value === "local" ? "#ECECEE" : "#85858A" }}>This Mac</Text>
      </Pressable>
      <Text style={{ color: "#6C6C70", marginTop: 8, fontSize: 12.5, lineHeight: 18 }}>
        {connected
          ? "Shared folder on this laptop, only while desktop is sharing."
          : "Open Manor desktop to share this Mac."}
      </Text>
    </View>
  );
}
