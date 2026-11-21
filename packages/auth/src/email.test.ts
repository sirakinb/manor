import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANDROID_APK_URL } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  accountDeletionEmail,
  CATALOGS,
  emailLocale,
  emailText,
  identityCodeEmail,
  passwordResetEmail,
  signInCodeEmail,
  verificationEmail,
} from "./email.js";
import {
  integrationClaimConfirmEmail,
  pluginSubmissionAdminEmail,
  pluginSubmissionReceivedEmail,
  pluginSubmissionReviewedEmail,
} from "./plugin-submission-email.js";
import { referralEmail } from "./referral-email.js";
import { welcomeEmail } from "./welcome-email.js";

describe("account email templates", () => {
  const url = "https://app.example.test/verify?token=fake-token&callbackURL=%2Fsign-in";

  it.each([
    ["verification", () => verificationEmail("user@example.test", url)],
    [
      "password reset",
      () => passwordResetEmail({ id: "user-1", email: "user@example.test", name: "Test" }, url),
    ],
  ] as const)("preserves the exact %s link in HTML and text", async (_name, create) => {
    const message = await create();
    expect(message.to).toBe("user@example.test");
    expect(message.text).toContain(url);
    expect(message.html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
  });

  it.each([signInCodeEmail, accountDeletionEmail])(
    "escapes code content and includes a plain-text fallback",
    async (create) => {
      const message = await create("user@example.test", "<script>fake-code</script>");
      expect(message.text).toContain("<script>fake-code</script>");
      expect(message.html).toContain("&lt;script&gt;fake-code&lt;/script&gt;");
      expect(message.html).not.toContain("<script>");
      expect(message.html).not.toContain("<a ");
    },
  );

  it("names Manor in every subject and body", async () => {
    const messages = await Promise.all([
      verificationEmail("user@example.test", url),
      signInCodeEmail("user@example.test", "042517"),
      passwordResetEmail({ id: "user-1", email: "user@example.test", name: "Test" }, url),
      accountDeletionEmail("user@example.test", "042517"),
    ]);
    expect(messages.map((message) => message.subject)).toEqual([
      "Verify your Manor email",
      "Your Manor sign-in code",
      "Reset your Manor password",
      "Confirm Manor account deletion",
    ]);
    for (const message of messages) {
      expect(message.text).toContain("Manor");
      expect(message.text).not.toContain("Rakazo");
      expect(message.html).not.toContain("Rakazo");
    }
  });

  it.each(["en", "es", "de", "tr", "ja"])(
    "keeps product and confirmation emails on Manor's name in %s, with no upstream links or signature",
    async (locale) => {
      const user = { email: "user@example.test", name: "Test" };
      const identity = await identityCodeEmail(user.email, "042517", locale);
      if (locale === "en") expect(identity.subject).toBe("Your Manor confirmation code");
      const welcome = await welcomeEmail(user, url, locale);
      const referral = await referralEmail(user, url, url, locale);
      for (const message of [identity, welcome, referral]) {
        expect(message.subject + message.text).toContain("Manor");
        for (const body of [message.subject, message.text, message.html!]) {
          expect(body.toLowerCase()).not.toContain("rakazo");
          expect(body).not.toContain("elie222");
          expect(body).not.toContain("Elie");
        }
      }
      // The welcome email links only to Manor's releases page (and its unsubscribe link).
      const links = new Set([...welcome.html!.matchAll(/href="([^"]*)"/g)].map((m) => m[1]));
      expect([...links].sort()).toEqual([ANDROID_APK_URL, url.replaceAll("&", "&amp;")].sort());
      expect(referral.text).not.toContain("GitHub");
    },
  );

  it.each(Object.keys(CATALOGS))(
    "says Manor wherever the %s catalog names the product",
    (locale) => {
      const say = emailText(locale);
      for (const [id, translation] of Object.entries(CATALOGS[locale] ?? {})) {
        const text = say(id, { name: "Rakazo bot", weeks: 2 });
        expect(text.replaceAll("Rakazo bot", ""), id).not.toContain("Rakazo");
        if (translation.includes("Rakazo")) expect(text, id).toContain("Manor");
      }
    },
  );
});

// Every template must retain the same layout and a text alternative.
it("shares the layout across account, product and marketplace emails", async () => {
  const user = { id: "user-1", name: "Alex", email: "alex@example.com" };
  const url = "https://app.example.com";
  const messages = await Promise.all([
    verificationEmail(user.email, url),
    signInCodeEmail(user.email, "123456"),
    passwordResetEmail(user, url),
    accountDeletionEmail(user.email, "123456"),
    identityCodeEmail(user.email, "123456"),
    welcomeEmail(user, url),
    referralEmail(user, url, url),
    pluginSubmissionReceivedEmail(user.email),
    integrationClaimConfirmEmail(user.email, url),
    pluginSubmissionAdminEmail(
      user.email,
      { name: "Example plugin", source: "https://example.com/plugin", email: user.email },
      url,
    ),
    pluginSubmissionReviewedEmail({
      email: user.email,
      name: "Example plugin",
      status: "approved",
      reason: null,
    }),
    pluginSubmissionReviewedEmail({
      email: user.email,
      name: "Example plugin",
      status: "rejected",
      reason: "Example reason",
    }),
  ]);
  for (const message of messages) {
    expect(message.html!.match(/class="email-card"/g)).toHaveLength(1);
    expect(message.html).toContain('role="presentation"');
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.text).not.toContain("<table");
  }
});

describe("email languages", () => {
  const headers = (value: string) => new Headers({ "accept-language": value });

  it("writes in the saved app language, else the asking browser's, else English", () => {
    expect(emailLocale("es", headers("de-DE,de;q=0.9"))).toBe("es");
    expect(emailLocale(null, headers("es-CL,es;q=0.9,en;q=0.8"))).toBe("es");
    expect(emailLocale(undefined, headers("it-IT"))).toBe("en");
    expect(emailLocale("it", headers("es-ES"))).toBe("en");
    expect(emailLocale(null, headers("it-IT,es;q=0.9"))).toBe("es");
    expect(emailLocale(null, headers("en-US,es;q=0.9"))).toBe("en");
    expect(emailLocale(null, headers("*"))).toBe("en");
    expect(emailLocale(null, null)).toBe("en");
  });

  it("writes a code email in Spanish", async () => {
    const message = await signInCodeEmail("user@example.test", "123456", "es");
    expect(message.subject).toBe("Tu código para iniciar sesión en Manor");
    expect(message.html).toContain('lang="es"');
    expect(message.text).toContain("Introduce este código para iniciar sesión en Manor:");
    expect(message.html).toContain('dir="ltr"');
  });

  it("lays a right-to-left language out right to left", async () => {
    const message = await signInCodeEmail("user@example.test", "123456", "he");
    expect(message.html).toContain('lang="he"');
    expect(message.html).toContain('dir="rtl"');
  });

  it("greets by name in Spanish and keeps English as written", async () => {
    const user = { id: "user-1", email: "user@example.test", name: "Ana" };
    expect((await passwordResetEmail(user, "https://example.test/r", "es")).text).toContain(
      "Hola, Ana:",
    );
    const english = await welcomeEmail(user, "https://example.test/u");
    expect(english.subject).toBe("Welcome to Manor");
    expect(english.text).toContain("Hi Ana,");
    expect(english.text).toContain("Manor also has apps for iPhone");
  });

  it.each(Object.entries(CATALOGS))(
    "translates every email string into %s with its placeholders",
    (_locale, catalog) => {
      const dir = dirname(fileURLToPath(import.meta.url));
      const ids = readdirSync(dir)
        .filter((file) => file.endsWith(".tsx"))
        .flatMap((file) =>
          [...readFileSync(join(dir, file), "utf8").matchAll(/say\(\s*("(?:[^"\\]|\\.)*")/g)].map(
            (match) => JSON.parse(match[1] ?? '""') as string,
          ),
        );
      expect(ids.length).toBeGreaterThan(30);
      const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(String).sort();
      for (const id of ids) {
        expect(catalog[id], id).toBeTruthy();
        expect(placeholders(catalog[id] ?? ""), id).toEqual(placeholders(id));
      }
    },
  );
});
