import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { createRepos } from "./repos.js";
import { IsolationError } from "./scope.js";

// These exercise real Postgres because the point of rooms is a schema change:
// a thread with no bot, participants, and cross-tenant refusal.
const url = process.env.ROOMS_TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("rooms", () => {
  const prisma = createDb(url ?? "").prisma;
  const repos = createRepos(prisma);
  const suffix = Math.random().toString(36).slice(2, 8);

  const owner = {
    userId: `u-owner-${suffix}`,
    workspaceId: `w-owner-${suffix}`,
    email: "owner@test",
    isDeploymentOwner: true,
  };
  const stranger = {
    userId: `u-other-${suffix}`,
    workspaceId: `w-other-${suffix}`,
    email: "other@test",
    isDeploymentOwner: false,
  };
  let scoutId = "";
  let quillId = "";
  let strangerBotId = "";

  beforeAll(async () => {
    for (const actor of [owner, stranger]) {
      await prisma.organization.create({
        data: {
          id: actor.workspaceId,
          name: actor.workspaceId,
          slug: actor.workspaceId,
          createdAt: new Date(),
        },
      });
    }
    const mk = async (actor: typeof owner, name: string) =>
      (
        await prisma.bot.create({
          data: {
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            name,
            title: "",
            description: "",
            instructions: "",
            color: "#8033cc",
          },
        })
      ).id;
    scoutId = await mk(owner, "Scout");
    quillId = await mk(owner, "Quill");
    strangerBotId = await mk(stranger, "Intruder");
  });

  it("creates a room holding several bots", async () => {
    const room = await repos.createRoom(owner, { name: "Outreach", botIds: [scoutId, quillId] });
    expect(room.name).toBe("Outreach");
    expect(room.botIds).toEqual([scoutId, quillId]);

    // The room is a thread with no owning bot — the change this feature rests on.
    const row = await prisma.thread.findUniqueOrThrow({ where: { id: room.id } });
    expect(row.kind).toBe("room");
    expect(row.botId).toBeNull();
  });

  it("refuses a bot from another workspace", async () => {
    await expect(
      repos.createRoom(owner, { name: "Sneaky", botIds: [scoutId, strangerBotId] }),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("adds and removes participants", async () => {
    const room = await repos.createRoom(owner, { name: "Solo", botIds: [scoutId] });
    const added = await repos.setRoomParticipant(owner, {
      roomId: room.id,
      botId: quillId,
      member: true,
    });
    expect(added.botIds).toContain(quillId);

    const removed = await repos.setRoomParticipant(owner, {
      roomId: room.id,
      botId: quillId,
      member: false,
    });
    expect(removed.botIds).not.toContain(quillId);
  });

  it("will not let another workspace read or change a room", async () => {
    const room = await repos.createRoom(owner, { name: "Private", botIds: [scoutId] });
    await expect(repos.getRoom(stranger, room.id)).rejects.toBeInstanceOf(IsolationError);
    await expect(
      repos.setRoomParticipant(stranger, {
        roomId: room.id,
        botId: strangerBotId,
        member: true,
      }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(repos.deleteRoom(stranger, room.id)).rejects.toBeInstanceOf(IsolationError);
  });

  it("lists only this workspace's rooms", async () => {
    const mine = await repos.listRooms(owner);
    const theirs = await repos.listRooms(stranger);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs).toEqual([]);
  });

  it("leaves direct threads alone", async () => {
    const thread = await prisma.thread.create({
      data: { workspaceId: owner.workspaceId, userId: owner.userId, botId: scoutId },
    });
    expect(thread.kind).toBe("direct");
    expect(thread.botId).toBe(scoutId);
    // A direct thread is not a room, so it never appears in the room list.
    const rooms = await repos.listRooms(owner);
    expect(rooms.some((room) => room.id === thread.id)).toBe(false);
  });
});
