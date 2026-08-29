import * as z from "zod";
import { Id } from "./ids.js";

// ── CRM custom modules ──────────────────────────────────────────────────────
// User-defined sheets (Airtable/Zoho-style): a module owns typed fields, and
// records store one JSON value per field id. One validation path serves every
// surface — web RPC, public REST, MCP tools, and in-product agents.

export const CRM_MODULE_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "checkbox",
  "select",
  "email",
  "phone",
  "url",
] as const;
export const CrmModuleFieldTypeSchema = z.enum(CRM_MODULE_FIELD_TYPES);
export type CrmModuleFieldType = z.infer<typeof CrmModuleFieldTypeSchema>;

export const CrmModuleFieldSchema = z.object({
  id: Id,
  label: z.string(),
  type: CrmModuleFieldTypeSchema,
  /// Choices for "select" fields; empty for every other type.
  options: z.array(z.string()),
  position: z.number().int(),
});
export type CrmModuleField = z.infer<typeof CrmModuleFieldSchema>;

export const CrmModuleSchema = z.object({
  id: Id,
  name: z.string(),
  position: z.number().int(),
  fields: z.array(CrmModuleFieldSchema),
  recordCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type CrmModule = z.infer<typeof CrmModuleSchema>;

export const CrmRecordValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type CrmRecordValue = z.infer<typeof CrmRecordValueSchema>;

export const CrmModuleRecordSchema = z.object({
  id: Id,
  moduleId: Id,
  /// Keyed by field id. Fields with no value are simply absent.
  values: z.record(z.string(), CrmRecordValueSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmModuleRecord = z.infer<typeof CrmModuleRecordSchema>;

export const CRM_MODULE_NAME_MAX = 80;
export const CRM_MODULE_FIELD_LABEL_MAX = 80;
export const CRM_MODULE_FIELD_MAX = 40;
export const CRM_MODULE_SELECT_OPTION_MAX = 60;
export const CRM_MODULE_SELECT_OPTIONS_MAX = 50;
export const CRM_MODULE_TEXT_VALUE_MAX = 8000;

export const CrmModuleFieldInput = z.object({
  label: z.string().trim().min(1).max(CRM_MODULE_FIELD_LABEL_MAX),
  type: CrmModuleFieldTypeSchema,
  options: z
    .array(z.string().trim().min(1).max(CRM_MODULE_SELECT_OPTION_MAX))
    .max(CRM_MODULE_SELECT_OPTIONS_MAX)
    .default([]),
});
export type CrmModuleFieldInput = z.infer<typeof CrmModuleFieldInput>;

type FieldShape = Pick<CrmModuleField, "id" | "label" | "type" | "options">;

export type NormalizedRecordValues =
  | { ok: true; values: Record<string, CrmRecordValue> }
  | { ok: false; error: string };

/**
 * Validate and coerce raw record values against a module's fields. Keys may be
 * field ids or exact field labels (labels are what external agents see).
 * `null` clears a field. Unknown keys and type mismatches are errors, so a
 * misbehaving caller can never write shapes the sheet cannot render.
 */
export function normalizeModuleRecordValues(
  fields: FieldShape[],
  raw: Record<string, unknown>,
): NormalizedRecordValues {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const byLabel = new Map<string, FieldShape[]>();
  for (const field of fields) {
    const key = field.label.toLowerCase();
    byLabel.set(key, [...(byLabel.get(key) ?? []), field]);
  }
  const values: Record<string, CrmRecordValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    let field = byId.get(key);
    if (!field) {
      const matches = byLabel.get(key.toLowerCase()) ?? [];
      if (matches.length > 1) {
        return { ok: false, error: `Field label "${key}" is ambiguous; use the field id` };
      }
      field = matches[0];
    }
    if (!field) {
      return {
        ok: false,
        error: `Unknown field "${key}". Fields: ${fields.map((f) => f.label).join(", ")}`,
      };
    }
    if (value === null || value === undefined || value === "") {
      values[field.id] = null;
      continue;
    }
    const coerced = coerceValue(field, value);
    if (!coerced.ok) return coerced;
    values[field.id] = coerced.value;
  }
  return { ok: true, values };
}

function coerceValue(
  field: FieldShape,
  value: unknown,
): { ok: true; value: CrmRecordValue } | { ok: false; error: string } {
  const fail = (expected: string) => ({
    ok: false as const,
    error: `Field "${field.label}" expects ${expected}`,
  });
  switch (field.type) {
    case "checkbox": {
      if (typeof value === "boolean") return { ok: true, value };
      if (value === "true" || value === "false") return { ok: true, value: value === "true" };
      return fail("true or false");
    }
    case "number": {
      const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
      if (!Number.isFinite(parsed)) return fail("a number");
      return { ok: true, value: parsed };
    }
    case "date": {
      if (typeof value !== "string") return fail("a date string");
      const trimmed = value.trim();
      if (!Number.isFinite(new Date(trimmed).getTime())) {
        return fail("a date like 2026-08-29");
      }
      return { ok: true, value: trimmed.slice(0, 40) };
    }
    case "select": {
      if (typeof value !== "string") return fail("one of its options");
      const match = field.options.find(
        (option) => option.toLowerCase() === value.trim().toLowerCase(),
      );
      if (!match) {
        return fail(`one of: ${field.options.join(", ") || "(no options defined yet)"}`);
      }
      return { ok: true, value: match };
    }
    default: {
      if (typeof value === "number" || typeof value === "boolean") {
        return { ok: true, value: String(value) };
      }
      if (typeof value !== "string") return fail("text");
      return { ok: true, value: value.slice(0, CRM_MODULE_TEXT_VALUE_MAX) };
    }
  }
}
