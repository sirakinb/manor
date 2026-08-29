import { describe, expect, it } from "vitest";
import { normalizeModuleRecordValues } from "./crm-modules.js";

const fields = [
  { id: "f1", label: "Unit", type: "text" as const, options: [] },
  { id: "f2", label: "Rent", type: "number" as const, options: [] },
  { id: "f3", label: "Move-in", type: "date" as const, options: [] },
  { id: "f4", label: "Active", type: "checkbox" as const, options: [] },
  { id: "f5", label: "Status", type: "select" as const, options: ["Current", "Past"] },
];

describe("normalizeModuleRecordValues", () => {
  it("accepts field ids and case-insensitive labels", () => {
    const result = normalizeModuleRecordValues(fields, { f1: "4B", rent: 1450 });
    expect(result).toEqual({ ok: true, values: { f1: "4B", f2: 1450 } });
  });

  it("coerces per field type", () => {
    const result = normalizeModuleRecordValues(fields, {
      Rent: "1,450",
      "Move-in": "2026-09-01",
      Active: "true",
      Status: "current",
    });
    expect(result).toEqual({
      ok: true,
      values: { f2: 1450, f3: "2026-09-01", f4: true, f5: "Current" },
    });
  });

  it("clears fields on null or empty string", () => {
    const result = normalizeModuleRecordValues(fields, { Unit: null, Rent: "" });
    expect(result).toEqual({ ok: true, values: { f1: null, f2: null } });
  });

  it("rejects unknown keys with the field list", () => {
    const result = normalizeModuleRecordValues(fields, { Landlord: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown field "Landlord"');
  });

  it("rejects type mismatches and out-of-set select values", () => {
    expect(normalizeModuleRecordValues(fields, { Rent: "soon" }).ok).toBe(false);
    expect(normalizeModuleRecordValues(fields, { Active: "maybe" }).ok).toBe(false);
    expect(normalizeModuleRecordValues(fields, { Status: "Evicted" }).ok).toBe(false);
    expect(normalizeModuleRecordValues(fields, { "Move-in": "not a date" }).ok).toBe(false);
  });

  it("rejects ambiguous labels but allows exact ids", () => {
    const dupes = [
      { id: "a", label: "Name", type: "text" as const, options: [] },
      { id: "b", label: "name", type: "text" as const, options: [] },
    ];
    expect(normalizeModuleRecordValues(dupes, { Name: "x" }).ok).toBe(false);
    expect(normalizeModuleRecordValues(dupes, { a: "x" })).toEqual({
      ok: true,
      values: { a: "x" },
    });
  });

  it("stringifies numbers and booleans into text fields", () => {
    expect(normalizeModuleRecordValues(fields, { Unit: 4 })).toEqual({
      ok: true,
      values: { f1: "4" },
    });
  });
});
