import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator } from "@rakazo/adapters";
import type { Bot, Me, Space, SpaceNavigation, ThreadSnapshot } from "@rakazo/contracts";
import {
  requireMembership,
  shareUnstartedSpace,
  spaceNotificationRecipients,
  spaceResourceActor,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

const withDb =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;
type Handles = Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts").createApp>>;

withDb("shared spaces keep team resources separate from personal accounts", () => {
  let handles: Handles;
  let ownerCookie: string;
  let peerCookie: string;
  let outsiderCookie: string;
  let owner: Me;
  let peer: Me;
  let team: Space;
  let personal: Space;
  let bot: Bot;
  let organizationId: string;
  let accountUserId: string;
  const dataDir = mkdtempSync(path.join(tmpdir(), "shared-space-test-"));
  const suffix = randomUUID();
  const userIds: string[] = [];
  const orgIds: string[] = [];

  async function raw(cookie: string, procedure: string, input: unknown = {}, spaceId?: string) {
    return handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
        ...(spaceId ? { "x-rakazo-space-id": spaceId } : {}),
      },
      body: JSON.stringify({ json: input }),
    });
  }
  async function rpc<T>(
    cookie: string,
    procedure: string,
    input: unknown = {},
    spaceId?: string,
  ): Promise<T> {
    const response = await raw(cookie, procedure, input, spaceId);
    const body = await response.json();
    if (!response.ok) throw new Error(`${procedure}: ${response.status} ${JSON.stringify(body)}`);
    return body.json as T;
  }
  async function signup(name: string) {
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        name,
        email: `${name.toLowerCase()}-${suffix}@example.test`,
        password: "test-password-12",
      }),
    });
    expect(response.status).toBeLessThan(400);
    const cookie = sessionCookieHeader(response);
    const me = await rpc<Me>(cookie, "me");
    userIds.push(me.userId);
    const space = await handles.prisma.space.findUniqueOrThrow({ where: { id: me.spaceId } });
    orgIds.push(space.organizationId);
    return { cookie, me, organizationId: space.organizationId };
  }
  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      composio: new ComposioEmulator(),
      encryptionKey: "offline-shared-space-encryption-key",
    });
    const a = await signup("Alex");
    const b = await signup("Blair");
    const c = await signup("Casey");
    ownerCookie = a.cookie;
    owner = a.me;
    organizationId = a.organizationId;
    peerCookie = b.cookie;
    peer = b.me;
    outsiderCookie = c.cookie;
    await handles.prisma.organization.delete({ where: { id: b.organizationId } });
    await handles.prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: peer.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    personal = await rpc<Space>(
      peerCookie,
      "spaces/create",
      { name: "Blair personal" },
      owner.spaceId,
    );
    team = await rpc<Space>(
      ownerCookie,
      "spaces/create",
      { name: "Team projects", shared: true },
      owner.spaceId,
    );
    accountUserId = (await handles.prisma.space.findUniqueOrThrow({ where: { id: team.id } }))
      .accountUserId!;
    userIds.push(accountUserId);
    bot = await rpc<Bot>(
      ownerCookie,
      "bots/create",
      {
        name: "Event agent",
        title: "Events",
        description: "Coordinate events",
        instructions: "Help the team with events",
        notifyOnFinish: true,
      },
      team.id,
    );
  });
  afterAll(async () => {
    if (handles) {
      await handles.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      await handles.prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await handles.stop();
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns the same agents to both people and preserves each person's identity", async () => {
    expect(team.shared).toBe(true);
    expect((await rpc<Bot[]>(peerCookie, "bots/list", {}, team.id)).map((b) => b.id)).toEqual([
      bot.id,
    ]);
    const me = await rpc<Me>(peerCookie, "me", {}, team.id);
    expect(me.userId).toBe(peer.userId);
    expect(me.name).toBe("Blair");
    const navigation = await rpc<SpaceNavigation>(peerCookie, "spaces/list", {}, personal.id);
    expect(navigation.spaces.find((s) => s.id === team.id)?.bots.map((b) => b.id)).toEqual([
      bot.id,
    ]);
    expect(navigation.spaces.find((s) => s.id === personal.id)?.shared).toBe(false);
    expect(await rpc<Array<{ id: string }>>(peerCookie, "team/list", {}, team.id)).toHaveLength(2);
    expect(
      (await raw(outsiderCookie, "bots/get", { botId: bot.id }, team.id)).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await raw(ownerCookie, "bots/list", {}, personal.id)).status).toBeGreaterThanOrEqual(
      400,
    );
    await expect(requireMembership(handles.prisma, accountUserId, team.id)).rejects.toThrow();
  });

  it("serializes simultaneous messages into one shared conversation and records both authors", async () => {
    await Promise.all([
      rpc(
        ownerCookie,
        "threads/send",
        { botId: bot.id, text: "Plan the venue", clientNonce: `${suffix}-a` },
        team.id,
      ),
      rpc(
        peerCookie,
        "threads/send",
        { botId: bot.id, text: "Plan the invitations", clientNonce: `${suffix}-b` },
        team.id,
      ),
    ]);
    const snapshot = await rpc<ThreadSnapshot>(
      peerCookie,
      "threads/get",
      { botId: bot.id },
      team.id,
    );
    const messages = snapshot.messages.filter((m) => m.role === "user");
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((m) => m.authorName))).toEqual(new Set(["Alex", "Blair"]));
    expect(new Set(messages.map((m) => m.authorUserId))).toEqual(
      new Set([owner.userId, peer.userId]),
    );
    expect(
      (await rpc<ThreadSnapshot>(ownerCookie, "threads/get", { botId: bot.id }, team.id)).threadId,
    ).toBe(snapshot.threadId);
    const runs = await handles.prisma.run.findMany({ where: { botId: bot.id } });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.userId === accountUserId)).toBe(true);
    expect(runs.every((r) => [owner.userId, peer.userId].includes(r.initiatedByUserId!))).toBe(
      true,
    );
    await rpc(peerCookie, "threads/stop", { botId: bot.id }, team.id);
  });

  it("shares uploaded documents and team connections, while keeping personal connections out", async () => {
    const artifact = await rpc<{ id: string }>(
      peerCookie,
      "artifacts/create",
      {
        botId: bot.id,
        name: "brief.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("Shared event brief").toString("base64"),
      },
      team.id,
    );
    const document = await rpc<{ contentBase64: string }>(
      ownerCookie,
      "artifacts/get",
      { botId: bot.id, artifactId: artifact.id },
      team.id,
    );
    expect(Buffer.from(document.contentBase64, "base64").toString()).toBe("Shared event brief");
    await rpc(
      ownerCookie,
      "connections/begin",
      { connectorId: "composio", provider: "GMAIL", displayName: "Team mailbox" },
      team.id,
    );
    await rpc(
      peerCookie,
      "connections/begin",
      { connectorId: "composio", provider: "SLACK", displayName: "Personal chat" },
      personal.id,
    );
    const shared = await rpc<Array<{ id: string; displayName: string }>>(
      peerCookie,
      "connections/list",
      {},
      team.id,
    );
    expect(shared.map((c) => c.displayName)).toEqual(["Team mailbox"]);
    const own = await rpc<Array<{ displayName: string }>>(
      peerCookie,
      "connections/list",
      {},
      personal.id,
    );
    expect(own.map((c) => c.displayName)).toEqual(["Personal chat"]);
    expect(
      (await raw(ownerCookie, "connections/list", {}, personal.id)).status,
    ).toBeGreaterThanOrEqual(400);
    await rpc(peerCookie, "connections/revoke", { connectionId: shared[0]!.id }, team.id);
    expect(
      (await rpc<Array<{ status: string }>>(ownerCookie, "connections/list", {}, team.id))[0]
        ?.status,
    ).toBe("revoked");
  });

  it("rejects stale access after a member is removed", async () => {
    expect(
      new Set(
        await spaceNotificationRecipients(handles.prisma, {
          spaceId: team.id,
          userId: accountUserId,
        }),
      ),
    ).toEqual(new Set([owner.userId, peer.userId]));
    const actor = await requireMembership(handles.prisma, peer.userId, team.id);
    await handles.prisma.spaceMember.delete({
      where: { spaceId_userId: { spaceId: team.id, userId: peer.userId } },
    });
    await expect(spaceResourceActor(handles.prisma, actor)).rejects.toThrow();
    expect(
      await spaceNotificationRecipients(handles.prisma, {
        spaceId: team.id,
        userId: accountUserId,
      }),
    ).toEqual([owner.userId]);
    expect(
      (await raw(peerCookie, "threads/get", { botId: bot.id }, team.id)).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await raw(peerCookie, "connections/list", {}, team.id)).status).toBeGreaterThanOrEqual(
      400,
    );
  });

  it("preserves existing agent and conversation IDs when migrating an unstarted space", async () => {
    const old = await rpc<Bot>(
      ownerCookie,
      "bots/create",
      {
        name: "Existing agent",
        title: "",
        description: "",
        instructions: "",
        notifyOnFinish: true,
      },
      owner.spaceId,
    );
    const memory = await handles.prisma.memoryDocument.findFirstOrThrow({
      where: { spaceId: owner.spaceId, scope: "user", path: "MEMORY.md" },
    });
    const duplicate = await handles.prisma.memoryDocument.create({
      data: {
        spaceId: owner.spaceId,
        userId: peer.userId,
        scope: memory.scope,
        path: memory.path,
        content: "Conflicting personal memory",
      },
    });
    await expect(shareUnstartedSpace(handles.prisma, owner.spaceId)).rejects.toThrow(
      "conflicting memory",
    );
    expect(
      (await handles.prisma.space.findUniqueOrThrow({ where: { id: owner.spaceId } }))
        .accountUserId,
    ).toBeNull();
    await handles.prisma.memoryDocument.update({
      where: { id: duplicate.id },
      data: { content: memory.content },
    });
    const id = await shareUnstartedSpace(handles.prisma, owner.spaceId);
    expect(
      await handles.prisma.memoryDocument.count({
        where: { spaceId: owner.spaceId, scope: "user", path: "MEMORY.md", userId: id },
      }),
    ).toBe(1);
    userIds.push(id);
    expect(await shareUnstartedSpace(handles.prisma, owner.spaceId)).toBe(id);
    const shared = await rpc<Bot>(peerCookie, "bots/get", { botId: old.id }, owner.spaceId);
    expect(shared.id).toBe(old.id);
    expect(shared.threadId).toBe(old.threadId);
    const future = await signup("Drew");
    await handles.prisma.organization.delete({ where: { id: future.organizationId } });
    await handles.prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: future.me.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    expect((await rpc<Bot[]>(future.cookie, "bots/list", {}, team.id)).map((b) => b.id)).toEqual([
      bot.id,
    ]);
    await expect(shareUnstartedSpace(handles.prisma, personal.id)).rejects.toThrow(
      "reviewed migration",
    );
  });
});
