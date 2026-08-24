import { Image, StyleSheet, View } from "react-native";

/**
 * Manor's ridged scanline texture, matching #root::after in apps/web/src/styles.css:
 * a 1px white line at 1.7% every 4px. The tile is a 4x4 PNG so it repeats
 * seamlessly instead of costing one View per line.
 */
export function Ridges() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}>
      {/* Sized in percentages, not absoluteFill: an Image with no explicit width
          collapses to the tile's intrinsic 4x4. */}
      <Image
        source={require("../assets/ridge.png")}
        resizeMode="repeat"
        style={{ width: "100%", height: "100%" }}
      />
    </View>
  );
}
