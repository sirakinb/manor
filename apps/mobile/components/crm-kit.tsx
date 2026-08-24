import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { brandType, manor } from "../lib/native";

/** The eyebrow above a number or a section, in Manor's label face. */
export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({
  label,
  ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ flex: 1 }}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={manor.muted2}
        keyboardAppearance="dark"
        {...input}
        style={[styles.field, input.multiline ? { height: 96, paddingTop: 12 } : null, input.style]}
      />
    </View>
  );
}

/** A pill row that scrolls when the options outgrow the screen. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (key: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={[styles.pill, selected && styles.pillOn]}
          >
            <Text style={{ color: selected ? manor.ink : manor.muted, fontSize: 13 }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A horizontal proportion bar. Phone-width donuts read as decoration. */
export function Bar({ share, color }: { share: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View
        style={{
          width: `${Math.max(0, Math.min(1, share)) * 100}%`,
          height: "100%",
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function Chip({ name, color }: { name: string; color?: string | null }) {
  return (
    <View style={[styles.chip, color ? { borderColor: color } : null]}>
      <Text style={{ color: color ?? manor.muted, fontSize: 11.5 }}>{name}</Text>
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  tone = "quiet",
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: "quiet" | "loud" | "danger";
  disabled?: boolean;
}) {
  const color = tone === "loud" ? "#17171A" : tone === "danger" ? manor.danger : manor.body;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "loud" && { backgroundColor: manor.ink, borderColor: manor.ink },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={{ color, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  label: {
    color: manor.muted2,
    fontFamily: brandType.label,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginRight: -1.4,
  },
  card: {
    borderWidth: 1,
    borderColor: manor.hairlineStrong,
    backgroundColor: manor.main,
    borderRadius: 14,
    padding: 14,
  },
  field: {
    marginTop: 7,
    backgroundColor: manor.surface,
    borderWidth: 1,
    borderColor: manor.hairlineStrong,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: manor.ink,
    fontSize: 15.5,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: manor.hairlineStrong,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillOn: { backgroundColor: manor.surface2, borderColor: manor.muted2 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: manor.surface,
    overflow: "hidden",
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: manor.hairlineStrong,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  empty: {
    color: manor.muted2,
    fontSize: 14,
    paddingVertical: 34,
    textAlign: "center",
  },
  button: {
    borderWidth: 1,
    borderColor: manor.hairlineStrong,
    backgroundColor: manor.surface,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
});
