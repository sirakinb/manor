import {
  WORKSPACE_EXTERNAL_TOOL_NAMES,
  workspaceToolDescriptions,
  externalWorkspaceToolSchemas as workspaceToolSchemas,
  workspaceToolScope,
} from "@rakazo/contracts";
export type Endpoint = { method: string; path: string; scope: string; summary: string };

export const WORKSPACE_MCP_TOOLS = WORKSPACE_EXTERNAL_TOOL_NAMES.map((name) => ({
  name,
  args:
    Object.entries(workspaceToolSchemas[name].shape)
      .map(([key, schema]) => `${key}${schema.isOptional() ? "?" : ""}`)
      .join(", ") || "—",
  scope: workspaceToolScope(name),
  summary: workspaceToolDescriptions[name],
}));
export const WORKSPACE_ENDPOINTS: Endpoint[] = WORKSPACE_MCP_TOOLS.map((tool) => ({
  method: "POST",
  path: `/v1/workspace/tools/${tool.name}`,
  scope: tool.scope,
  summary: tool.summary,
}));

export const SCOPES = [
  { scope: "crm:read", grants: "Read contacts, pipelines, deals, modules, records" },
  { scope: "crm:write", grants: "Create and update CRM data over REST and MCP" },
  { scope: "webhooks:manage", grants: "List, create, and delete webhook endpoints" },
  {
    scope: "workspace:read",
    grants: "Read operations, reports, shared context, skills and activity history",
  },
  {
    scope: "workspace:context:write",
    grants: "Create and update shared context with revision checks",
  },
  { scope: "workspace:skills:write", grants: "Save new versions of shared skills and artifacts" },
  {
    scope: "workspace:activities:write",
    grants: "Log work and evidence; cannot approve or execute actions",
  },
];

export const STATUS_CODES = [
  { code: "400", meaning: "Validation failed; the message says which field" },
  { code: "401", meaning: "Missing, revoked, or malformed token" },
  { code: "403", meaning: "Token lacks the required scope" },
  { code: "404", meaning: "Resource is not in this workspace" },
  { code: "409", meaning: "Revision conflict or idempotency key reused with a different payload" },
];

export const CONTACT_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/crm/contacts",
    scope: "crm:read",
    summary: "List contacts; filter with updated_after",
  },
  { method: "GET", path: "/v1/crm/contacts/:id", scope: "crm:read", summary: "Get one contact" },
  {
    method: "POST",
    path: "/v1/crm/contacts/upsert",
    scope: "crm:write",
    summary: "Create or update by source + external_id or email",
  },
];

export const DEAL_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/crm/pipelines",
    scope: "crm:read",
    summary: "List pipelines with their stages",
  },
  { method: "GET", path: "/v1/crm/deals", scope: "crm:read", summary: "List deals" },
  {
    method: "POST",
    path: "/v1/crm/deals",
    scope: "crm:write",
    summary: "Create a deal in a pipeline stage",
  },
  {
    method: "PATCH",
    path: "/v1/crm/deals/:id",
    scope: "crm:write",
    summary: "Update title, value, contact, or status",
  },
  {
    method: "POST",
    path: "/v1/crm/deals/:id/move",
    scope: "crm:write",
    summary: "Move a deal to another stage",
  },
];

export const MODULE_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/crm/modules",
    scope: "crm:read",
    summary: "List custom modules and their fields",
  },
  {
    method: "POST",
    path: "/v1/crm/modules",
    scope: "crm:write",
    summary: "Create a module (a user-defined sheet)",
  },
  {
    method: "GET",
    path: "/v1/crm/modules/:id/records",
    scope: "crm:read",
    summary: "List records in a module",
  },
  {
    method: "POST",
    path: "/v1/crm/modules/:id/records",
    scope: "crm:write",
    summary: "Create a record",
  },
  {
    method: "PATCH",
    path: "/v1/crm/records/:id",
    scope: "crm:write",
    summary: "Update record values; null clears a field",
  },
  {
    method: "DELETE",
    path: "/v1/crm/records/:id",
    scope: "crm:write",
    summary: "Delete a record",
  },
];

export const WEBHOOK_ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/webhooks",
    scope: "webhooks:manage",
    summary: "List webhook endpoints",
  },
  {
    method: "POST",
    path: "/v1/webhooks",
    scope: "webhooks:manage",
    summary: "Create an endpoint; returns its signing secret once",
  },
  {
    method: "DELETE",
    path: "/v1/webhooks/:id",
    scope: "webhooks:manage",
    summary: "Delete an endpoint",
  },
];

export const MCP_TOOLS = [
  { name: "crm_overview", args: "—", writes: false },
  { name: "crm_find_contacts", args: "query", writes: false },
  { name: "crm_upsert_contact", args: "contact_id?, first_name?, email?, tags?, …", writes: true },
  { name: "crm_sync_contact", args: "source?, external_id?, email?, …", writes: true },
  { name: "crm_create_deal", args: "title, value, pipeline?, stage?, contact_name?", writes: true },
  { name: "crm_update_deal", args: "deal_id, title?, value?, status?", writes: true },
  { name: "crm_move_deal", args: "deal_id, stage", writes: true },
  { name: "crm_list_modules", args: "—", writes: false },
  { name: "crm_create_module", args: "name, fields?", writes: true },
  { name: "crm_list_records", args: "module, cursor?", writes: false },
  { name: "crm_upsert_record", args: "module?, record_id?, values", writes: true },
  { name: "crm_delete_record", args: "record_id", writes: true },
];

export const WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "record.created",
  "record.updated",
];
