import { useNavigation, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { createElement, useLayoutEffect } from "react";
import { ManorLockup } from "../components/manor-lockup";
import type { CreateAction } from "./create-chooser";
import { createMenuItems } from "./create-chooser";
import { useI18n } from "./i18n";

/** Liquid Glass home header: account and CRM on the left, Manor's lockup in the middle; activity, search and create on the right. */
export function useHomeHeader({
  nativeHeader,
  ready,
  hasSession,
  initials,
  activityMode,
  toggleActivityMode,
  runCreateAction,
  headerTitle,
}: {
  nativeHeader: boolean;
  ready: boolean;
  hasSession: boolean;
  initials: string;
  activityMode: boolean;
  toggleActivityMode: () => void;
  runCreateAction: (action: CreateAction) => void;
  headerTitle?: () => ReactNode;
}) {
  const navigation = useNavigation();
  const router = useRouter();
  const { t, locale } = useI18n();
  useLayoutEffect(() => {
    if (!nativeHeader) return;
    const signedIn = ready && hasSession;
    navigation.setOptions({
      headerShown: signedIn,
      headerTransparent: true,
      headerStyle: { backgroundColor: "transparent" },
      title: "",
      // Manor's lockup as the native bar title unless an organization menu takes its place (it does
      // not while organization switching is off); iOS 26 only, so CI cannot capture it.
      headerTitle: headerTitle ?? (() => createElement(ManorLockup)),
      unstable_headerLeftItems: () => [
        {
          type: "button" as const,
          label: t("Account"),
          icon: { type: "sfSymbol" as const, name: "person.crop.circle" },
          accessibilityLabel: t("Account"),
          onPress: () => router.push("/account"),
        },
        {
          type: "button" as const,
          accessibilityLabel: "CRM",
          icon: { type: "sfSymbol" as const, name: "chart.bar" },
          onPress: () => router.push("/crm"),
        },
      ],
      unstable_headerRightItems: () => [
        {
          type: "button" as const,
          label: t("Activity"),
          accessibilityLabel: t("Activity"),
          icon: { type: "sfSymbol" as const, name: activityMode ? "bell.fill" : "bell" },
          selected: activityMode,
          onPress: toggleActivityMode,
        },
        {
          type: "button" as const,
          label: t("Search"),
          accessibilityLabel: t("Search"),
          identifier: "home-search-button",
          icon: { type: "sfSymbol" as const, name: "magnifyingglass" },
          onPress: () => router.push("/search"),
        },
        {
          type: "menu" as const,
          label: t("Create"),
          accessibilityLabel: t("Create"),
          icon: { type: "sfSymbol" as const, name: "plus" },
          menu: {
            items: createMenuItems.map(({ id, label, sfSymbol }) => ({
              type: "action" as const,
              label: t(label),
              icon: { type: "sfSymbol" as const, name: sfSymbol },
              onPress: () => runCreateAction(id),
            })),
          },
        },
      ],
    });
  }, [
    nativeHeader,
    navigation,
    ready,
    hasSession,
    initials,
    activityMode,
    toggleActivityMode,
    runCreateAction,
    headerTitle,
    router,
    t,
    locale,
  ]);
}
