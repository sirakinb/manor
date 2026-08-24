import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View, type ViewStyle } from "react-native";

/**
 * KeyboardAvoidingView compares its own onLayout frame, which is relative to its
 * parent, against the keyboard's absolute position. Under a navigation header
 * those two disagree by the header's height, so the composer stays buried. We
 * measure our top edge in window coordinates to recover that offset — expo-router
 * vendors its own react-navigation, so a separately installed useHeaderHeight
 * would read a different context and quietly return the fallback value.
 */
export function KeyboardAvoider({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const root = useRef<View>(null);
  const [offset, setOffset] = useState(0);

  const measure = useCallback(() => {
    root.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) setOffset(y);
    });
  }, []);

  return (
    <View ref={root} onLayout={measure} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={offset}
        style={[{ flex: 1 }, style]}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
