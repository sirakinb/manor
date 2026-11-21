import { describe, expect, it } from "vitest";
import {
  accountDeletionEmail,
  passwordResetEmail,
  signInCodeEmail,
  verificationEmail,
} from "./email.js";

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
});
