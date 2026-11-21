import { bootstrapUserSpace, ensureOwnSpace } from "@rakazo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "./index.js";

// Better Auth's real routes over its offline memory adapter; the space functions are the db's.
vi.mock("better-auth/adapters/prisma", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return {
    prismaAdapter: (prisma: { authData: Record<string, unknown[]> }) =>
      memoryAdapter(prisma.authData),
  };
});
vi.mock("@rakazo/db", () => ({
  bootstrapUserSpace: vi.fn(async () => ({ spaceId: "space-new", organizationId: "org-new" })),
  ensureOwnSpace: vi.fn(async () => "space-own"),
  leaveInvitedSpaces: vi.fn(async () => ({ ownedOrganizationIds: [] })),
  recordSecurityEvent: vi.fn(async () => undefined),
}));

const baseURL = "http://auth.example.test";
const mainOrigin = "http://web.example.test";
const brandOrigin = "https://jrhmanor.agentworkspace.cloud";
const password = "offline-password-1234";

type Member = { userId: string; organizationId: string; brandId: string | null; role: string };

/**
 * The accounts table lives in Better Auth's memory adapter; organizations and spaces are plain
 * rows so each case states exactly what the person belongs to when they sign in.
 */
function fixture() {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const members: Member[] = [];
  const spaceMembers: { userId: string; spaceId: string }[] = [];
  const pins = new Map<string, string | null>();
  const prisma = {
    authData: data,
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        signupsEnabled: true,
        signupAllowlist: "",
        signupPolicyInitialized: true,
      })),
    },
    // Each brand's organization exists, so sign-up on its host is open.
    organization: { findUnique: vi.fn(async () => ({ id: "org-brand" })) },
    spaceMember: {
      findFirst: vi.fn(
        async ({ where }: { where: { userId: string } }) =>
          spaceMembers.find((row) => row.userId === where.userId) ?? null,
      ),
    },
    member: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            userId: string;
            role?: { not: string };
            organization: { brandId: string | null };
          };
        }) => {
          const row = members.find(
            (candidate) =>
              candidate.userId === where.userId &&
              candidate.brandId === where.organization.brandId &&
              (!where.role || candidate.role !== where.role.not),
          );
          return row ? { organizationId: row.organizationId } : null;
        },
      ),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        portalBrandId: pins.get(where.id) ?? null,
      })),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        portalBrandId: pins.get(where.id) ?? null,
        isSpaceAccount: false,
      })),
      update: vi.fn(
        async ({
          where,
          data: change,
        }: {
          where: { id: string };
          data: { portalBrandId: string };
        }) => {
          pins.set(where.id, change.portalBrandId);
          return {};
        },
      ),
      // The sign-up pins the portal it arrived on; the last-sign-in stamp passes through here too.
      updateMany: vi.fn(
        async ({
          where,
          data: change,
        }: {
          where: { id: string };
          data: { portalBrandId?: string };
        }) => {
          if (change.portalBrandId && !pins.get(where.id)) pins.set(where.id, change.portalBrandId);
          return { count: 1 };
        },
      ),
    },
  };
  // A first session joins the brand's organization, or makes a personal one, with a space there.
  vi.mocked(bootstrapUserSpace).mockImplementation(async (_prisma, user, _env, options) => {
    const organizationId = options?.brandId ? `org-${options.brandId}` : "org-personal";
    members.push({
      userId: user.id,
      organizationId,
      brandId: options?.brandId ?? null,
      role: "owner",
    });
    spaceMembers.push({ userId: user.id, spaceId: `space-${organizationId}` });
    return { spaceId: `space-${organizationId}`, organizationId };
  });
  const auth = createAuth(prisma as never, {
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL,
    webOrigin: mainOrigin,
    extraOrigins: [brandOrigin],
    signupsEnabled: "true",
    signupAllowlist: "",
    logger: { level: "error", log: vi.fn() },
  });
  const post = (origin: string, path: string, body: unknown) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      }),
    );
  /** Signs up as someone with no organization yet, then returns their user id. */
  const signUp = async (origin: string, email: string) => {
    const response = await post(origin, "/sign-up/email", { email, password, name: "Ada" });
    expect(response.status, await response.clone().text()).toBe(200);
    return String(data.user?.find((row) => row.email === email)?.id);
  };
  const signIn = (origin: string, email: string) =>
    post(origin, "/sign-in/email", { email, password });
  return { members, spaceMembers, pins, signUp, signIn };
}

beforeEach(() => vi.clearAllMocks());

describe("a person's own space on sign-in", () => {
  it("gives a brand member taken out of the brand's default space their own space there", async () => {
    const f = fixture();
    const userId = await f.signUp(brandOrigin, "staff@example.test");
    // The brand's organization still holds them; the one-person migration removed their space.
    f.spaceMembers.splice(0, f.spaceMembers.length);
    vi.clearAllMocks();

    expect((await f.signIn(brandOrigin, "staff@example.test")).status).toBe(200);
    expect(ensureOwnSpace).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ id: userId }),
      "org-jrh",
    );
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("leaves a main-portal person with a personal organization in it", async () => {
    const f = fixture();
    const userId = await f.signUp(mainOrigin, "ada@example.test");
    vi.clearAllMocks();

    expect((await f.signIn(mainOrigin, "ada@example.test")).status).toBe(200);
    // ensureOwnSpace returns the space they already have there; nothing new is bootstrapped.
    expect(ensureOwnSpace).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ id: userId }),
      "org-personal",
    );
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("keeps a team-space member in the team space", async () => {
    const f = fixture();
    const userId = await f.signUp(brandOrigin, "teammate@example.test");
    // The brand's default space is a team space with a shared account; they stay a member of it.
    f.spaceMembers.splice(0, f.spaceMembers.length, { userId, spaceId: "team-space" });
    vi.clearAllMocks();

    expect((await f.signIn(brandOrigin, "teammate@example.test")).status).toBe(200);
    expect(ensureOwnSpace).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ id: userId }),
      "org-jrh",
    );
    expect(bootstrapUserSpace).not.toHaveBeenCalled();
  });

  it("bootstraps an account with no organization on the brand it first signs in on", async () => {
    // A directory-made account reaches its first session with no organization and no space.
    const f = fixture();
    const userId = await f.signUp(brandOrigin, "directory@example.test");

    expect(bootstrapUserSpace).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ id: userId }),
      expect.anything(),
      { brandId: "jrh" },
    );
    expect(ensureOwnSpace).not.toHaveBeenCalled();
    expect(f.pins.get(userId)).toBe("jrh");
  });

  it("never creates a space on a portal the account does not belong to", async () => {
    const f = fixture();
    const userId = await f.signUp(brandOrigin, "pinned@example.test");
    f.members.push({ userId, organizationId: "org-personal", brandId: null, role: "owner" });
    vi.clearAllMocks();

    // Pinned to the brand, so the main portal refuses before anything is created.
    expect((await f.signIn(mainOrigin, "pinned@example.test")).status).toBe(403);
    expect(ensureOwnSpace).not.toHaveBeenCalled();
  });
});
