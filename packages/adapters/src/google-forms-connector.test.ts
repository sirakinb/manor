import type { AdapterContext, ConnectorEvent } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_FORMS_SCOPES,
  GoogleFormsConnector,
  type GoogleFormsTokenBroker,
} from "./google-forms-connector.js";

const context: AdapterContext = {
  operationId: "google-forms-test",
  traceId: "google-forms-test",
  spaceId: "workspace-example",
  userId: "user-example",
  signal: new AbortController().signal,
};

function broker(connected = true): GoogleFormsTokenBroker {
  return {
    isConnected: vi.fn(async () => connected),
    accessToken: vi.fn(async () => "fake-google-access-token"),
    disconnect: vi.fn(async () => {}),
  };
}

async function collect(events: AsyncIterable<ConnectorEvent>) {
  const output: ConnectorEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

describe("GoogleFormsConnector", () => {
  it("advertises an account-link flow only when configured scopes are connected", async () => {
    const tokens = broker(true);
    const connector = new GoogleFormsConnector(tokens);

    await expect(connector.catalog(context)).resolves.toEqual([
      expect.objectContaining({
        connectorId: "google-workspace",
        slug: "google-forms",
        connected: true,
        accountLink: { provider: "google", scopes: [...GOOGLE_FORMS_SCOPES] },
      }),
    ]);
    await expect(connector.discoverTools(context)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "google_forms_list_responses",
          readOnly: true,
          route: expect.objectContaining({ connectorId: "google-workspace" }),
        }),
        expect.objectContaining({ name: "google_forms_create" }),
      ]),
    );
    await expect(connector.begin()).resolves.toMatchObject({
      authorizationUrl: null,
      state: "google-forms",
      accountLink: { provider: "google" },
    });
    expect(tokens.isConnected).toHaveBeenCalledWith(context.userId, GOOGLE_FORMS_SCOPES);
  });

  it("hides tools when the Google account lacks the required grants", async () => {
    const connector = new GoogleFormsConnector(broker(false));
    await expect(connector.discoverTools(context)).resolves.toEqual([]);
    await expect(connector.listConnectedExternalIds(context)).resolves.toEqual([]);
  });

  it("creates a form and translates typed questions into Forms batchUpdate requests", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const connector = new GoogleFormsConnector(broker(), {
      fetch: vi.fn(async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/v1/forms") && init.method === "POST") {
          return Response.json({ formId: "form-123" });
        }
        if (url.endsWith("/forms/form-123:batchUpdate")) return Response.json({ replies: [] });
        if (url.endsWith("/forms/form-123")) {
          return Response.json({ formId: "form-123", responderUri: "https://forms.test/r/123" });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    });

    const events = await collect(
      connector.execute(
        {
          tool: "google_forms_create",
          executionId: "effect-1",
          args: {
            title: "Customer survey",
            description: "Tell us what you think",
            questions: [
              { title: "Name", type: "short_text", required: true },
              {
                title: "Favorite color",
                type: "multiple_choice",
                choices: ["Blue", "Green"],
              },
            ],
          },
        },
        context,
      ),
    );

    expect(events).toEqual([
      { type: "result", data: { formId: "form-123", responderUri: "https://forms.test/r/123" } },
    ]);
    const createBody = JSON.parse(String(requests[0]?.init.body));
    expect(createBody).toEqual({
      info: { title: "Customer survey", documentTitle: "Customer survey" },
    });
    const updateBody = JSON.parse(String(requests[1]?.init.body));
    expect(updateBody.requests).toEqual([
      {
        updateFormInfo: {
          info: { description: "Tell us what you think" },
          updateMask: "description",
        },
      },
      expect.objectContaining({
        createItem: expect.objectContaining({
          item: expect.objectContaining({
            questionItem: { question: { required: true, textQuestion: { paragraph: false } } },
          }),
        }),
      }),
      expect.objectContaining({
        createItem: expect.objectContaining({
          item: expect.objectContaining({
            questionItem: {
              question: {
                required: false,
                choiceQuestion: {
                  type: "RADIO",
                  options: [{ value: "Blue" }, { value: "Green" }],
                },
              },
            },
          }),
        }),
      }),
    ]);
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer fake-google-access-token",
    });
  });

  it("lists forms through Drive and responses through Forms without leaking tokens", async () => {
    const seen: string[] = [];
    const connector = new GoogleFormsConnector(broker(), {
      fetch: vi.fn(async (input) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("drive/v3/files")) return Response.json({ files: [{ id: "form-1" }] });
        if (url.includes("/responses?"))
          return Response.json({ responses: [{ responseId: "r1" }] });
        return Response.json(
          { error: { message: "Bearer fake-google-access-token is invalid" } },
          { status: 401 },
        );
      }),
    });

    await expect(
      collect(
        connector.execute(
          { tool: "google_forms_list", executionId: "effect-2", args: { pageSize: 10 } },
          context,
        ),
      ),
    ).resolves.toEqual([{ type: "result", data: { files: [{ id: "form-1" }] } }]);
    await expect(
      collect(
        connector.execute(
          {
            tool: "google_forms_list_responses",
            executionId: "effect-3",
            args: { formId: "form-1", pageSize: 20 },
          },
          context,
        ),
      ),
    ).resolves.toEqual([{ type: "result", data: { responses: [{ responseId: "r1" }] } }]);
    await expect(
      collect(
        connector.execute(
          { tool: "google_forms_get", executionId: "effect-4", args: { formId: "missing" } },
          context,
        ),
      ),
    ).resolves.toEqual([{ type: "error", message: "Bearer [redacted] is invalid" }]);
    expect(seen[0]).toContain("mimeType+%3D+%27application%2Fvnd.google-apps.form%27");
    expect(seen[1]).toContain("/forms/form-1/responses?pageSize=20");
  });

  it("clears stored credentials on revoke, including an already-revoked token", async () => {
    for (const status of [200, 400]) {
      const tokens = broker();
      const connector = new GoogleFormsConnector(tokens, {
        fetch: vi.fn(async () => new Response(null, { status })),
      });

      await expect(connector.revoke("connection-1", context)).resolves.toBeUndefined();
      expect(tokens.disconnect).toHaveBeenCalledWith(context.userId);
    }
  });

  it("keeps credentials when revocation fails for an unexpected reason", async () => {
    const tokens = broker();
    const connector = new GoogleFormsConnector(tokens, {
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
    });

    await expect(connector.revoke("connection-1", context)).rejects.toThrow(
      "Google authorization revocation failed (503)",
    );
    expect(tokens.disconnect).not.toHaveBeenCalled();
  });

  it("appends new questions after existing form items", async () => {
    let updateBody: { requests?: Array<{ createItem?: { location?: { index?: number } } }> } = {};
    const connector = new GoogleFormsConnector(broker(), {
      fetch: vi.fn(async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith("/forms/form-1") && init.method === "GET") {
          return Response.json({ items: [{ itemId: "one" }, { itemId: "two" }] });
        }
        if (url.endsWith("/forms/form-1:batchUpdate")) {
          updateBody = JSON.parse(String(init.body));
          return Response.json({ replies: [] });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    });

    await expect(
      collect(
        connector.execute(
          {
            tool: "google_forms_add_questions",
            executionId: "effect-5",
            args: {
              formId: "form-1",
              questions: [{ title: "Anything else?", type: "paragraph" }],
            },
          },
          context,
        ),
      ),
    ).resolves.toEqual([{ type: "result", data: { replies: [] } }]);
    expect(updateBody.requests?.[0]?.createItem?.location?.index).toBe(2);
  });
});
