import type { ComputerMode, LocalComputerLiveSession } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { NativeSegmentedControl } from "./native-segmented-control";

export function ComputerModePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ComputerMode | undefined;
  onChange: (mode: ComputerMode) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
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
    <View style={{ marginTop: 16, padding: 16, borderRadius: 14, backgroundColor: native.fill }}>
      <Text style={{ color: tokens.foreground, marginBottom: 12, fontSize: 16, fontWeight: "600" }}>
        {t("Computer")}
      </Text>
      <NativeSegmentedControl
        accessibilityLabel={t("Computer")}
        disabled={disabled}
        onChange={onChange}
        options={[
          { value: "team", label: t("Team") },
          { value: "dedicated", label: t("Private") },
        ]}
        value={value}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: value === "local", disabled: disabled || !connected }}
        disabled={disabled || !connected}
        onPress={() => onChange("local")}
        style={{
          marginTop: 8,
          alignItems: "center",
          borderWidth: 1,
          borderColor: value === "local" ? tokens.mutedForeground : tokens.border,
          backgroundColor: value === "local" ? tokens.muted : "transparent",
          borderRadius: 11,
          paddingVertical: 12,
          opacity: disabled || !connected ? 0.5 : 1,
        }}
      >
        <Text style={{ color: value === "local" ? tokens.foreground : tokens.mutedForeground }}>
          This Mac
        </Text>
      </Pressable>
      <Text style={{ color: tokens.mutedForeground, marginTop: 8, fontSize: 12.5, lineHeight: 18 }}>
        {connected
          ? "Shared folder on this laptop, only while desktop is sharing."
          : "Open Manor desktop to share this Mac."}
      </Text>
    </View>
  );
}
