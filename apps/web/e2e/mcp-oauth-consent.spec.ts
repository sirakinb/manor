import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("approves an MCP client's OAuth request for a space", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-consent-${stamp}@rakazo.test`, "password12", "MCP Consent");
  await completeOnboarding(page);

  const redirectUri = "https://client.example.test/callback";
  const registered = await page.request.post("/oauth/register", {
    data: { client_name: "Claude", redirect_uris: [redirectUri] },
  });
  expect(registered.status()).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };

  await page
    .context()
    .route("https://client.example.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>Client callback</p>" }),
    );
  const verifier = "v".repeat(64);
  await page.goto(
    `/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "consent-state",
      scope: "crm:read crm:write",
    })}`,
  );
  await expect(page.getByRole("heading", { name: /Connect Claude to/ })).toBeVisible();
  await expect(page.getByText("You will return to client.example.test.")).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-oauth-consent");

  await page.getByRole("button", { name: "crm:write" }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(/client\.example\.test\/callback/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe("consent-state");

  const issued = await page.request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id,
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    },
  });
  expect(issued.status()).toBe(200);
  expect(await issued.json()).toMatchObject({ token_type: "Bearer", scope: "crm:read" });
});
