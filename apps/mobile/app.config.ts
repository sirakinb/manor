import type { ConfigContext, ExpoConfig } from "expo/config";

const RELEASE_PROFILES = new Set(["production", "android-apk"]);

export default ({ config }: ConfigContext): ExpoConfig => {
  if (RELEASE_PROFILES.has(process.env.EAS_BUILD_PROFILE ?? "")) {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) {
      throw new Error(
        "EXPO_PUBLIC_API_URL must be set in the EAS production environment before building a release.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(apiUrl);
    } catch {
      throw new Error("EXPO_PUBLIC_API_URL must be a valid URL.");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("EXPO_PUBLIC_API_URL must use HTTPS for production builds.");
    }
  }

  const projectId = config.extra?.eas?.projectId;
  return {
    ...config,
    // Keep the build and its update destination on the same linked project.
    ...(typeof projectId === "string" && projectId
      ? { updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` } }
      : {}),
  } as ExpoConfig;
};
