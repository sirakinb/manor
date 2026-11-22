import { Image, Text, View } from "react-native";
import { useThemedStyles } from "../lib/native/native";
import { createInboxStyles } from "./inbox/inbox-styles";

/** Manor's mark and wordmark, shown in the middle of the inbox header. */
export function ManorLockup() {
  const styles = useThemedStyles(createInboxStyles);
  return (
    <View accessibilityElementsHidden pointerEvents="none" style={styles.lockupRow}>
      <Image
        source={require("../assets/manor-mark.png")}
        resizeMode="contain"
        style={{ width: 20, height: 20 }}
      />
      <Text style={styles.wordmark}>Manor</Text>
    </View>
  );
}
