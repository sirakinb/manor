import { createCrmRepos, resolveOrganizationId } from "@rakazo/db";
import {
  findBotCredential,
  loadBotCredentialSecret,
  resolveBotCredentialValue,
} from "./bot-credentials.js";
import { getActiveTeachingSession } from "./bots/teaching-session.js";
import { botMayUseChannels, sendChannelMessage } from "./channels.js";
import { crmAgentTools, executeCrmTool } from "./crm-tools.js";
import { prepareRoutineWebhook } from "./routine-webhook.js";
import type { RunContext } from "./runs/assembly/run-context.js";
import { addRunSecrets } from "./runs/assembly/run-context.js";
import { publishMessage } from "./runs/assembly/run-messages.js";
import type { ToolCall, ToolHandler, ToolHandlers } from "./runs/tools/run-tool-gate.js";
import { executeWorkspaceTool } from "./workspace-tools.js";

/** Manor's own tools: messaging channels, previews, saved logins, webhook routines, CRM. */
export const manorTools: ToolHandlers = {
  async send_channel_message(ctx, call) {
    const { args } = call;
    if (!botMayUseChannels(ctx.bot.id)) {
      return call.finish({
        delivered: false,
        detail: "This bot is not connected to a messaging channel.",
      });
    }
    const result = await sendChannelMessage(
      {
        provider: String(args.provider ?? ""),
        chatId: String(args.chat_id ?? args.chatId ?? ""),
        text: String(args.text ?? ""),
      },
      { signal: ctx.context.signal },
    );
    return call.finish(result);
  },
  async share_preview(ctx, call) {
    const { args } = call;
    const port = Number(args.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
      return call.finish({ error: "port must be an integer between 1024 and 65535" });
    }
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    const previewPath = rawPath ? (rawPath.startsWith("/") ? rawPath : `/${rawPath}`) : "/";
    const title = typeof args.title === "string" ? args.title.trim().slice(0, 80) : "";
    await publishMessage(ctx.deps, ctx.run, "bot", [
      {
        kind: "preview",
        port,
        ...(previewPath !== "/" ? { path: previewPath } : {}),
        ...(title ? { title } : {}),
      },
    ]);
    return call.finish({
      ok: true,
      note: `Preview of port ${port} is open for the user. Keep the server running; it is proxied live from your computer.`,
    });
  },
  async use_credential(ctx, call) {
    const { deps, run, context } = ctx;
    const { name, args } = call;
    const credentials = ctx.tools.botCredentials;
    if (await getActiveTeachingSession(deps.prisma, run.spaceId, run.botId)) {
      return { error: "Teaching is in progress. Stop teaching before using the computer." };
    }
    const field = String(args.field ?? "");
    if (field !== "username" && field !== "password" && field !== "totp") {
      return call.finish({ error: "field must be username, password, or totp" });
    }
    const row = findBotCredential(credentials, String(args.credential ?? ""));
    if (!row) {
      return call.finish({
        error: `No stored credential matches ${JSON.stringify(String(args.credential ?? ""))}. Available: ${credentials.map((item) => item.label).join(", ") || "none"}.`,
      });
    }
    // The secret is read through the async store in the run's tenant context.
    const secret = await loadBotCredentialSecret(deps.prisma, deps.secretStore, run, row.secretId);
    addRunSecrets(
      ctx,
      [secret.password, secret.totp].filter((value): value is string => Boolean(value)),
    );
    const resolved = resolveBotCredentialValue(row, secret, field);
    if (!resolved.ok) return call.finish({ error: resolved.error });
    if (field !== "username") addRunSecrets(ctx, [resolved.text]);
    const result = await deps.sandbox.act(
      await ctx.computer.get("tool", name),
      {
        actions: [{ kind: "clipboard", text: resolved.text }],
        observe: false,
        settleMs: Number(args.settle_ms ?? 350),
      },
      context,
    );
    return call.finish({
      ok: true,
      typed: field,
      credential: row.label,
      completed: result.completed,
      ...(resolved.note ? { note: resolved.note } : {}),
    });
  },
  async routine_prepare_webhook(ctx, call) {
    const { name, args } = call;
    return call.finish(
      await prepareRoutineWebhook(
        ctx.deps,
        {
          botId: ctx.bot.id,
          routineId: String(args.routineId ?? ""),
          groupId: ctx.thread.groupId,
        },
        await ctx.computer.get("tool", name),
        ctx.context,
        (token) => addRunSecrets(ctx, [token]),
      ),
    );
  },
  ...Object.fromEntries(crmAgentTools.map((tool) => [tool.name, crmTool] as const)),
};

async function workspaceTool(ctx: RunContext, call: ToolCall) {
  const result = await executeWorkspaceTool(
    ctx.deps,
    {
      spaceId: ctx.run.spaceId,
      userId: ctx.run.userId,
      botId: ctx.bot.id,
      executionId: call.effectKey,
    },
    call.name,
    call.args,
  );
  return call.finish(result ?? { error: "Unknown workspace tool." });
}

async function crmTool(ctx: RunContext, call: ToolCall) {
  const { deps, run } = ctx;
  // The CRM is organization-scoped, not space-scoped.
  const organizationId = await resolveOrganizationId(deps.prisma, run.spaceId);
  const crmResult = await executeCrmTool(
    createCrmRepos(deps.prisma),
    { userId: run.userId, organizationId },
    call.name,
    call.args,
  );
  if (deps.crmEvent && crmResult && typeof crmResult === "object") {
    const value = crmResult as Record<string, unknown>;
    const contact = value.contact as { id?: string } | undefined;
    const deal = value.deal as { id?: string } | undefined;
    if (contact?.id && (value.created || value.updated)) {
      await deps.crmEvent(
        organizationId,
        value.created ? "contact.created" : "contact.updated",
        contact.id,
        contact,
      );
    }
    if (deal?.id && (value.created || value.updated || value.moved)) {
      await deps.crmEvent(
        organizationId,
        value.created ? "deal.created" : value.moved ? "deal.stage_changed" : "deal.updated",
        deal.id,
        deal,
      );
    }
  }
  return call.finish(crmResult);
}

/** Every workspace_ name is Manor's Workspace tool, never a connector's. */
export function manorToolHandler(name: string): ToolHandler | undefined {
  if (name.startsWith("workspace_")) return workspaceTool;
  return manorTools[name];
}
