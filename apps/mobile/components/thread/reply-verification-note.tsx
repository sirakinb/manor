import type { MessageBlock } from "@rakazo/contracts";
import { useState } from "react";
import { Pressable, Text } from "react-native";

/** Manor's reply check: statements in the reply it could not verify, folded until tapped. */
export function ReplyVerificationNote({
  block,
}: {
  block: Extract<MessageBlock, { kind: "verification" }>;
}) {
  const [open, setOpen] = useState(false);
  const count = block.unsupported.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((value) => !value)}
      hitSlop={6}
    >
      <Text style={{ color: "#85858A", fontSize: 13.5 }}>
        {count === 1 ? "Couldn't verify 1 statement" : `Couldn't verify ${count} statements`}
      </Text>
      {open
        ? block.unsupported.map((statement, index) => (
            <Text key={index} style={{ color: "#85858A", fontSize: 13.5, marginTop: 4 }}>
              • {statement}
            </Text>
          ))
        : null}
    </Pressable>
  );
}
