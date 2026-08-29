import type {
  CrmModule,
  CrmModuleField,
  CrmModuleFieldType,
  CrmModuleRecord,
  CrmRecordValue,
} from "@rakazo/contracts";
import { normalizeModuleRecordValues } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import type { CrmActorScope } from "./crm.js";
import { IsolationError } from "./scope.js";

/** Record values that don't fit the module's fields. Callers map this to a 400/tool error. */
export class CrmModuleValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmModuleValueError";
  }
}

type FieldRow = {
  id: string;
  label: string;
  type: string;
  options: unknown;
  position: number;
};

function mapField(row: FieldRow): CrmModuleField {
  return {
    id: row.id,
    label: row.label,
    type: row.type as CrmModuleFieldType,
    options: Array.isArray(row.options) ? row.options.filter((o) => typeof o === "string") : [],
    position: row.position,
  };
}

function mapModule(row: {
  id: string;
  name: string;
  position: number;
  createdAt: Date;
  fields: FieldRow[];
  _count: { records: number };
}): CrmModule {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    fields: [...row.fields].sort((a, b) => a.position - b.position).map(mapField),
    recordCount: row._count.records,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapRecord(row: {
  id: string;
  moduleId: string;
  values: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CrmModuleRecord {
  const values: Record<string, CrmRecordValue> = {};
  if (row.values && typeof row.values === "object" && !Array.isArray(row.values)) {
    for (const [key, value] of Object.entries(row.values)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        values[key] = value;
      }
    }
  }
  return {
    id: row.id,
    moduleId: row.moduleId,
    values,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const MODULE_INCLUDE = { fields: true, _count: { select: { records: true } } } as const;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}\n${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const index = decoded.indexOf("\n");
  if (index < 0) return null;
  const createdAt = new Date(decoded.slice(0, index));
  if (!Number.isFinite(createdAt.getTime())) return null;
  return { createdAt, id: decoded.slice(index + 1) };
}

export function createCrmModuleRepos(prisma: PrismaClient) {
  async function requireModule(actor: CrmActorScope, moduleId: string) {
    const row = await prisma.crmModule.findUnique({
      where: { id: moduleId },
      include: MODULE_INCLUDE,
    });
    if (!row || row.workspaceId !== actor.workspaceId) throw new IsolationError();
    return row;
  }

  async function requireRecord(actor: CrmActorScope, recordId: string) {
    const row = await prisma.crmModuleRecord.findUnique({ where: { id: recordId } });
    if (!row || row.workspaceId !== actor.workspaceId) throw new IsolationError();
    return row;
  }

  async function getModule(actor: CrmActorScope, moduleId: string): Promise<CrmModule> {
    return mapModule(await requireModule(actor, moduleId));
  }

  return {
    getModule,

    async listModules(actor: CrmActorScope): Promise<CrmModule[]> {
      const rows = await prisma.crmModule.findMany({
        where: { workspaceId: actor.workspaceId },
        include: MODULE_INCLUDE,
        orderBy: { position: "asc" },
      });
      return rows.map(mapModule);
    },

    async createModule(
      actor: CrmActorScope,
      input: { name: string; fields: { label: string; type: string; options: string[] }[] },
    ): Promise<CrmModule> {
      const last = await prisma.crmModule.findFirst({
        where: { workspaceId: actor.workspaceId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const row = await prisma.crmModule.create({
        data: {
          workspaceId: actor.workspaceId,
          name: input.name,
          position: (last?.position ?? -1) + 1,
          fields: {
            create: input.fields.map((field, position) => ({
              label: field.label,
              type: field.type,
              options: field.options,
              position,
            })),
          },
        },
        include: MODULE_INCLUDE,
      });
      return mapModule(row);
    },

    async updateModule(
      actor: CrmActorScope,
      input: { moduleId: string; name?: string },
    ): Promise<CrmModule> {
      await requireModule(actor, input.moduleId);
      const row = await prisma.crmModule.update({
        where: { id: input.moduleId },
        data: { name: input.name },
        include: MODULE_INCLUDE,
      });
      return mapModule(row);
    },

    async deleteModule(actor: CrmActorScope, moduleId: string): Promise<void> {
      await requireModule(actor, moduleId);
      await prisma.crmModule.delete({ where: { id: moduleId } });
    },

    async createModuleField(
      actor: CrmActorScope,
      input: { moduleId: string; label: string; type: string; options: string[] },
    ): Promise<CrmModule> {
      const module = await requireModule(actor, input.moduleId);
      const position = module.fields.reduce((max, field) => Math.max(max, field.position), -1) + 1;
      await prisma.crmModuleField.create({
        data: {
          moduleId: input.moduleId,
          label: input.label,
          type: input.type,
          options: input.options,
          position,
        },
      });
      return getModule(actor, input.moduleId);
    },

    async updateModuleField(
      actor: CrmActorScope,
      input: { moduleId: string; fieldId: string; label?: string; options?: string[] },
    ): Promise<CrmModule> {
      const module = await requireModule(actor, input.moduleId);
      if (!module.fields.some((field) => field.id === input.fieldId)) {
        throw new IsolationError();
      }
      await prisma.crmModuleField.update({
        where: { id: input.fieldId },
        data: { label: input.label, options: input.options },
      });
      return getModule(actor, input.moduleId);
    },

    async deleteModuleField(
      actor: CrmActorScope,
      input: { moduleId: string; fieldId: string },
    ): Promise<CrmModule> {
      const module = await requireModule(actor, input.moduleId);
      if (!module.fields.some((field) => field.id === input.fieldId)) {
        throw new IsolationError();
      }
      await prisma.crmModuleField.delete({ where: { id: input.fieldId } });
      return getModule(actor, input.moduleId);
    },

    async listModuleRecords(
      actor: CrmActorScope,
      input: { moduleId: string; cursor?: string; limit?: number },
    ): Promise<{ data: CrmModuleRecord[]; nextCursor: string | null }> {
      await requireModule(actor, input.moduleId);
      const limit = input.limit ?? 100;
      const after = input.cursor ? decodeCursor(input.cursor) : null;
      const rows = await prisma.crmModuleRecord.findMany({
        where: {
          workspaceId: actor.workspaceId,
          moduleId: input.moduleId,
          ...(after
            ? {
                OR: [
                  { createdAt: { gt: after.createdAt } },
                  { createdAt: after.createdAt, id: { gt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        data: page.map(mapRecord),
        nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    },

    async createModuleRecord(
      actor: CrmActorScope,
      input: { moduleId: string; values: Record<string, unknown> },
    ): Promise<CrmModuleRecord> {
      const module = await requireModule(actor, input.moduleId);
      const normalized = normalizeModuleRecordValues(module.fields.map(mapField), input.values);
      if (!normalized.ok) throw new CrmModuleValueError(normalized.error);
      const values: Record<string, CrmRecordValue> = {};
      for (const [key, value] of Object.entries(normalized.values)) {
        if (value !== null) values[key] = value;
      }
      const row = await prisma.crmModuleRecord.create({
        data: { workspaceId: actor.workspaceId, moduleId: input.moduleId, values },
      });
      return mapRecord(row);
    },

    async updateModuleRecord(
      actor: CrmActorScope,
      input: { recordId: string; values: Record<string, unknown> },
    ): Promise<CrmModuleRecord> {
      const record = await requireRecord(actor, input.recordId);
      const module = await requireModule(actor, record.moduleId);
      const normalized = normalizeModuleRecordValues(module.fields.map(mapField), input.values);
      if (!normalized.ok) throw new CrmModuleValueError(normalized.error);
      const merged = mapRecord(record).values;
      for (const [key, value] of Object.entries(normalized.values)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      const row = await prisma.crmModuleRecord.update({
        where: { id: input.recordId },
        data: { values: merged },
      });
      return mapRecord(row);
    },

    async deleteModuleRecord(actor: CrmActorScope, recordId: string): Promise<void> {
      const record = await requireRecord(actor, recordId);
      await prisma.crmModuleRecord.delete({ where: { id: record.id } });
    },
  };
}
