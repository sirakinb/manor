import { describe, expect, it } from "vitest";
import {
  accountDeletionEmail,
  identityCodeEmail,
  passwordResetEmail,
  signInCodeEmail,
  verificationEmail,
} from "./email.js";

import {
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

  it("keeps product and confirmation emails on Manor's name, with no upstream links or signature", async () => {
    const user = { email: "user@example.test", name: "Test" };
    const identity = await identityCodeEmail(user.email, "042517");
    expect(identity.subject).toBe("Your Manor confirmation code");
    const messages = [identity, await welcomeEmail(user, url), await referralEmail(user, url, url)];
    for (const message of messages) {
      expect(message.text).toContain("Manor");
      for (const body of [message.text, message.html!]) {
        expect(body.toLowerCase()).not.toContain("rakazo");
        expect(body).not.toContain("elie222");
        expect(body).not.toContain("Elie");
      }
    }
  });
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
