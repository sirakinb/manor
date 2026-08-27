import type {
  AdapterContext,
  ConnectorCall,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
} from "@rakazo/adapter-kit";
import {
  combineSignals,
  redactConnectorPayload,
  sanitizeConnectorError,
} from "./connector-safety.js";

const FORMS_API = "https://forms.googleapis.com/v1";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const REQUEST_TIMEOUT_MS = 30_000;

export const GOOGLE_FORMS_SCOPES = [
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
] as const;

export interface GoogleFormsTokenBroker {
  isConnected(userId: string, requiredScopes: readonly string[]): Promise<boolean>;
  accessToken(userId: string): Promise<string>;
  disconnect(userId: string): Promise<void>;
}

export interface GoogleFormsConnectorDependencies {
  fetch?: typeof fetch;
}

type QuestionInput = {
  title: string;
  type: "short_text" | "paragraph" | "multiple_choice" | "checkboxes" | "dropdown";
  required?: boolean;
  choices?: string[];
};

const tools: ConnectorTool[] = [
  {
    name: "google_forms_list",
    description: "List Google Forms available to Manor, most recently modified first.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { pageSize: { type: "integer", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  {
    name: "google_forms_get",
    description: "Get a Google Form, including its questions and responder URL.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { formId: { type: "string", minLength: 1 } },
      required: ["formId"],
      additionalProperties: false,
    },
  },
  {
    name: "google_forms_create",
    description: "Create a Google Form with an optional description and questions.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        description: { type: "string" },
        questions: { type: "array", items: questionSchema() },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "google_forms_add_questions",
    description: "Append questions to an existing Google Form.",
    inputSchema: {
      type: "object",
      properties: {
        formId: { type: "string", minLength: 1 },
        questions: { type: "array", minItems: 1, items: questionSchema() },
      },
      required: ["formId", "questions"],
      additionalProperties: false,
    },
  },
  {
    name: "google_forms_list_responses",
    description: "List responses submitted to a Google Form.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        formId: { type: "string", minLength: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 5000 },
        filter: { type: "string" },
      },
      required: ["formId"],
      additionalProperties: false,
    },
  },
];

export class GoogleFormsConnector implements ManagedConnectorProvider {
  constructor(
    private readonly tokens: GoogleFormsTokenBroker,
    private readonly dependencies: GoogleFormsConnectorDependencies = {},
  ) {}

  describe() {
    return {
      id: "google-workspace",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }

  async catalog(context: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]> {
    if (query && !"google forms forms responses".includes(query.trim().toLowerCase())) return [];
    const connected = await this.tokens.isConnected(context.userId, GOOGLE_FORMS_SCOPES);
    return [
      {
        connectorId: "google-workspace",
        slug: "google-forms",
        name: "Google Forms",
        logo: null,
        connected,
        noAuth: false,
        accountLink: {
          provider: "google",
          scopes: [...GOOGLE_FORMS_SCOPES],
        },
      },
    ];
  }

  async listConnectedExternalIds(context: AdapterContext): Promise<string[]> {
    return (await this.tokens.isConnected(context.userId, GOOGLE_FORMS_SCOPES))
      ? ["google-forms"]
      : [];
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    if (!(await this.tokens.isConnected(context.userId, GOOGLE_FORMS_SCOPES))) return [];
    return tools.map((tool) => ({
      ...tool,
      route: { connectorId: "google-workspace", resourceId: "google-forms", toolName: tool.name },
    }));
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    let token: string | undefined;
    try {
      token = await this.tokens.accessToken(context.userId);
      const result = await this.executeTool(
        call.route?.toolName ?? call.tool,
        call.args,
        token,
        context,
      );
      yield { type: "result", data: redactConnectorPayload(result, [token]) };
    } catch (error) {
      yield { type: "error", message: sanitizeConnectorError(error, token ? [token] : []) };
    }
  }

  async begin(): Promise<{
    authorizationUrl: null;
    state: string;
    accountLink: {
      provider: string;
      scopes: string[];
    };
  }> {
    return {
      authorizationUrl: null,
      state: "google-forms",
      accountLink: {
        provider: "google",
        scopes: [...GOOGLE_FORMS_SCOPES],
      },
    };
  }

  async complete(request: { state: string }): Promise<{ connectionRef: string }> {
    return { connectionRef: request.state };
  }

  async connectionReady(context: AdapterContext): Promise<boolean> {
    return this.tokens.isConnected(context.userId, GOOGLE_FORMS_SCOPES);
  }

  async revoke(_connectionRef: string, context: AdapterContext): Promise<void> {
    const token = await this.tokens.accessToken(context.userId);
    const response = await this.fetch(TOKEN_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: combineSignals(context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    });
    if (!response.ok && response.status !== 400)
      throw new Error(`Google authorization revocation failed (${response.status})`);
    await this.tokens.disconnect(context.userId);
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    token: string,
    context: AdapterContext,
  ): Promise<unknown> {
    if (name === "google_forms_list") {
      const pageSize = boundedInteger(args.pageSize, 25, 1, 100);
      const params = new URLSearchParams({
        q: "mimeType = 'application/vnd.google-apps.form' and trashed = false",
        fields: "files(id,name,webViewLink,createdTime,modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: String(pageSize),
      });
      return this.request(`${DRIVE_API}/files?${params}`, { method: "GET" }, token, context);
    }
    if (name === "google_forms_get") {
      const formId = requiredString(args.formId, "formId");
      return this.request(
        `${FORMS_API}/forms/${encodeURIComponent(formId)}`,
        { method: "GET" },
        token,
        context,
      );
    }
    if (name === "google_forms_create") {
      const title = requiredString(args.title, "title");
      const created = await this.request<{ formId?: string }>(
        `${FORMS_API}/forms`,
        { method: "POST", body: JSON.stringify({ info: { title, documentTitle: title } }) },
        token,
        context,
      );
      if (!created.formId) throw new Error("Google Forms did not return a form id");
      const questions = parseQuestions(args.questions);
      const description = optionalString(args.description, "description");
      const requests = [
        ...(description
          ? [{ updateFormInfo: { info: { description }, updateMask: "description" } }]
          : []),
        ...questionRequests(questions),
      ];
      if (requests.length > 0) {
        await this.batchUpdate(created.formId, requests, token, context);
      }
      return this.request(
        `${FORMS_API}/forms/${encodeURIComponent(created.formId)}`,
        { method: "GET" },
        token,
        context,
      );
    }
    if (name === "google_forms_add_questions") {
      const formId = requiredString(args.formId, "formId");
      const questions = parseQuestions(args.questions);
      if (questions.length === 0) throw new Error("questions must contain at least one question");
      const form = await this.request<{ items?: unknown[] }>(
        `${FORMS_API}/forms/${encodeURIComponent(formId)}`,
        { method: "GET" },
        token,
        context,
      );
      return this.batchUpdate(
        formId,
        questionRequests(questions, form.items?.length ?? 0),
        token,
        context,
      );
    }
    if (name === "google_forms_list_responses") {
      const formId = requiredString(args.formId, "formId");
      const params = new URLSearchParams({
        pageSize: String(boundedInteger(args.pageSize, 100, 1, 5000)),
      });
      const filter = optionalString(args.filter, "filter");
      if (filter) params.set("filter", filter);
      return this.request(
        `${FORMS_API}/forms/${encodeURIComponent(formId)}/responses?${params}`,
        { method: "GET" },
        token,
        context,
      );
    }
    throw new Error(`Unknown Google Forms tool ${name}`);
  }

  private batchUpdate(formId: string, requests: unknown[], token: string, context: AdapterContext) {
    return this.request(
      `${FORMS_API}/forms/${encodeURIComponent(formId)}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests }) },
      token,
      context,
    );
  }

  private async request<T = unknown>(
    url: string,
    init: RequestInit,
    token: string,
    context: AdapterContext,
  ): Promise<T> {
    const response = await this.fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: combineSignals(context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    });
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    if (!response.ok) {
      throw new Error(body?.error?.message || `Google API request failed (${response.status})`);
    }
    return body as T;
  }

  private fetch(url: string, init: RequestInit) {
    return (this.dependencies.fetch ?? globalThis.fetch)(url, init);
  }
}

function questionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1 },
      type: {
        type: "string",
        enum: ["short_text", "paragraph", "multiple_choice", "checkboxes", "dropdown"],
      },
      required: { type: "boolean" },
      choices: { type: "array", items: { type: "string", minLength: 1 } },
    },
    required: ["title", "type"],
    additionalProperties: false,
  };
}

function parseQuestions(value: unknown): QuestionInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("questions must be an array");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`questions[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const title = requiredString(row.title, `questions[${index}].title`);
    const allowed = new Set<QuestionInput["type"]>([
      "short_text",
      "paragraph",
      "multiple_choice",
      "checkboxes",
      "dropdown",
    ]);
    if (typeof row.type !== "string" || !allowed.has(row.type as QuestionInput["type"])) {
      throw new Error(`questions[${index}].type is unsupported`);
    }
    const type = row.type as QuestionInput["type"];
    const choices =
      row.choices === undefined
        ? undefined
        : stringArray(row.choices, `questions[${index}].choices`);
    if (["multiple_choice", "checkboxes", "dropdown"].includes(type) && !choices?.length) {
      throw new Error(`questions[${index}].choices must not be empty`);
    }
    return { title, type, required: row.required === true, choices };
  });
}

function questionRequests(questions: QuestionInput[], startIndex = 0) {
  return questions.map((question, index) => ({
    createItem: {
      item: {
        title: question.title,
        questionItem: {
          question: {
            required: question.required ?? false,
            ...(question.type === "short_text" || question.type === "paragraph"
              ? { textQuestion: { paragraph: question.type === "paragraph" } }
              : {
                  choiceQuestion: {
                    type:
                      question.type === "multiple_choice"
                        ? "RADIO"
                        : question.type === "checkboxes"
                          ? "CHECKBOX"
                          : "DROP_DOWN",
                    options: question.choices?.map((value) => ({ value })) ?? [],
                  },
                }),
          },
        },
      },
      location: { index: startIndex + index },
    },
  }));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value.trim() || undefined;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((entry, index) => requiredString(entry, `${name}[${index}]`));
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`pageSize must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}
