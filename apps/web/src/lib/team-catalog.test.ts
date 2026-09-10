import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCompiledCatalog, extractFromFileWithBabel, getCatalogs } from "@lingui/cli/api";
import { type ExtractedMessage, getConfig } from "@lingui/conf";
import { setupI18n } from "@lingui/core";
import { expect, it } from "vitest";

it("ships readable team activity labels when production removes inline source messages", async () => {
  const config = getConfig({ cwd: fileURLToPath(new URL("../..", import.meta.url)) });
  const [catalog] = await getCatalogs(config);
  const filename = fileURLToPath(new URL("../components/TeamMembers.tsx", import.meta.url));
  const source: ExtractedMessage[] = [];
  await extractFromFileWithBabel(
    filename,
    readFileSync(filename, "utf8"),
    (entry) => source.push(entry),
    { linguiConfig: config },
    { plugins: ["typescript", "jsx"] },
  );
  expect(source.map((entry) => entry.message)).toEqual(
    expect.arrayContaining(["Active now", "Last active", "Last sign-in"]),
  );
  for (const locale of config.locales) {
    const { messages } = await catalog!.getTranslations(locale, {
      sourceLocale: config.sourceLocale!,
      fallbackLocales: config.fallbackLocales || {},
    });
    const compiled = createCompiledCatalog(locale, messages, { namespace: "json" });
    expect(compiled.errors).toEqual([]);
    const i18n = setupI18n({
      locale,
      messages: { [locale]: JSON.parse(compiled.source).messages },
    });
    for (const { id, message } of source) {
      // Production Trans receives only the generated id, without an English fallback.
      expect(i18n._(id)).not.toBe(id);
      expect(i18n._(id)).toBe(locale === "en" ? message : messages[id]);
    }
  }
});
