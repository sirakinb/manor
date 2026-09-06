import type { ConfigContext } from "expo/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import configure from "../app.config";
import app from "../app.json";
import eas from "../eas.json";

const context = (config: ConfigContext["config"]): ConfigContext => ({
  config,
  projectRoot: "/example",
  staticConfigPath: null,
  packageJsonPath: null,
});

afterEach(() => vi.unstubAllEnvs());

describe("mobile release configuration", () => {
  it("derives the update destination from the linked project", () => {
    vi.stubEnv("EAS_BUILD_PROFILE", "preview");
    const config = configure(
      context({
        name: "Example",
        slug: "example",
        extra: { eas: { projectId: "example-project" } },
        updates: { url: "https://u.expo.dev/old-project", checkAutomatically: "ON_LOAD" },
      }),
    );
    expect(config.updates).toEqual({
      url: "https://u.expo.dev/example-project",
      checkAutomatically: "ON_LOAD",
    });
  });

  it("preserves custom update configuration for an unlinked app", () => {
    vi.stubEnv("EAS_BUILD_PROFILE", "preview");
    const config = { name: "Example", slug: "example", updates: { enabled: false } };
    expect(configure(context(config))).toEqual(config);
  });

  it("requires an HTTPS API for production builds", () => {
    vi.stubEnv("EAS_BUILD_PROFILE", "production");
    const config = context({ name: "Example", slug: "example" });
    for (const value of ["", "invalid", "http://example.com"]) {
      vi.stubEnv("EXPO_PUBLIC_API_URL", value);
      expect(() => configure(config)).toThrow();
    }
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://example.com");
    expect(() => configure(config)).not.toThrow();
  });

  it("isolates native runtimes and keeps store identifiers out of tracked profiles", () => {
    expect(app.expo.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(eas.build.production.channel).toBe("production");
    expect(eas.build.preview.channel).toBe("preview");
    expect(eas.submit.production).toEqual({});
  });
});
