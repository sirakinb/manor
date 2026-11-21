import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { crossSpaceCommunicationAllowed } from "./cross-space-communication.js";
import { asSystem, runAsSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("cross-space communication stays in one organization (PostgreSQL)", () => {
  const tag = randomUUID().slice(0, 8);
  const id = (name: string) => `xspace-${tag}-${name}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  // Callers run the gate in a system context; a tenant context cannot see the other Space.
  const allowed = (sender: string, target: string) =>
    runAsSystem("deliver a message to a connected agent in another Space", () =>
      prisma.$transaction((tx) => crossSpaceCommunicationAllowed(tx, id(sender), id(target))),
    );

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const system = asSystem(prisma, "test fixture");
    const now = new Date();
    await system.user.create({
      data: { id: id("user"), name: "Fixture", email: `${id("user")}@example.com` },
    });
    for (const org of ["org-a", "org-b"]) {
      await system.organization.create({
        data: { id: id(org), name: org, slug: id(org), createdAt: now },
      });
    }
    const spaces = [
      ["team", "org-a"],
      ["personal", "org-a"],
      ["other", "org-b"],
    ] as const;
    for (const [space, org] of spaces) {
      await system.space.create({
        data: { id: id(space), organizationId: id(org), name: space },
      });
    }
    const bots = [
      ["team-bot", "team"],
      ["personal-bot", "personal"],
      ["other-bot", "other"],
    ] as const;
    for (const [bot, space] of bots) {
      await system.bot.create({
        data: {
          id: id(bot),
          spaceId: id(space),
          userId: id("user"),
          name: bot,
          color: "blue",
          crossSpaceCommunication: true,
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      const system = asSystem(prisma, "test fixture cleanup");
      await system.organization.deleteMany({ where: { id: { in: [id("org-a"), id("org-b")] } } });
      await system.user.deleteMany({ where: { id: id("user") } });
    }
    await close?.();
  });

  it("lets a shared team space's bot reach a member's personal-space bot in the organization", async () => {
    expect(await allowed("team-bot", "personal-bot")).toBe(true);
    expect(await allowed("personal-bot", "team-bot")).toBe(true);
  });

  it("refuses a bot in another organization even when both opted in", async () => {
    expect(await allowed("team-bot", "other-bot")).toBe(false);
    expect(await allowed("other-bot", "personal-bot")).toBe(false);
  });

  it("refuses within the organization once either bot opts out", async () => {
    await asSystem(prisma, "test fixture").bot.update({
      where: { id: id("personal-bot") },
      data: { crossSpaceCommunication: false },
    });
    expect(await allowed("team-bot", "personal-bot")).toBe(false);
  });
});
