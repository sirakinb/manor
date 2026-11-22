import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../database/client.js";
import { crossSpaceCommunicationAllowed } from "./cross-space-communication.js";

const sender = {
  id: "sender",
  spaceId: "space-a",
  organizationId: "org-1",
  crossSpaceCommunication: true,
  archivedAt: null,
};
const recipient = {
  id: "recipient",
  spaceId: "space-b",
  organizationId: "org-1",
  crossSpaceCommunication: true,
  archivedAt: null,
};

describe("cross-space bot communication", () => {
  it.each([
    { name: "both opted in, same organization", bots: [sender, recipient], allowed: true },
    {
      name: "different organizations",
      bots: [sender, { ...recipient, organizationId: "org-2" }],
      allowed: false,
    },
    {
      name: "a shared team space's bot and a member's personal-space bot in one organization",
      bots: [
        { ...sender, spaceId: "team-space" },
        { ...recipient, spaceId: "personal-space" },
      ],
      allowed: true,
    },
    {
      name: "a Space with no organization",
      bots: [sender, { ...recipient, organizationId: null }],
      allowed: false,
    },
    {
      name: "neither Space has an organization",
      bots: [
        { ...sender, organizationId: null },
        { ...recipient, organizationId: null },
      ],
      allowed: false,
    },
    {
      name: "sender off",
      bots: [{ ...sender, crossSpaceCommunication: false }, recipient],
      allowed: false,
    },
    {
      name: "recipient off",
      bots: [sender, { ...recipient, crossSpaceCommunication: false }],
      allowed: false,
    },
    {
      name: "missing permission",
      bots: [sender, { ...recipient, crossSpaceCommunication: undefined }],
      allowed: false,
    },
    { name: "missing bot", bots: [sender], allowed: false },
    {
      name: "archived bot",
      bots: [sender, { ...recipient, archivedAt: new Date() }],
      allowed: false,
    },
    {
      name: "same space",
      bots: [
        { ...sender, crossSpaceCommunication: false },
        { ...recipient, spaceId: sender.spaceId, crossSpaceCommunication: false },
      ],
      allowed: true,
    },
    {
      name: "same space, no organization",
      bots: [
        { ...sender, organizationId: null },
        { ...recipient, spaceId: sender.spaceId, organizationId: null },
      ],
      allowed: true,
    },
  ])("$name", async ({ bots, allowed }) => {
    const prisma = { $queryRaw: vi.fn(async () => bots) };
    expect(
      await crossSpaceCommunicationAllowed(
        prisma as unknown as PrismaClient,
        sender.id,
        recipient.id,
      ),
    ).toBe(allowed);
  });
});
