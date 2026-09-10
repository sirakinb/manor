import { randomBytes, randomUUID } from "node:crypto";
import { brandById } from "@rakazo/brands";
import { joinOrganization, type PrismaClient } from "@rakazo/db";
import { hashPassword } from "better-auth/crypto";

/** Operator-only provisioning. Never expose this helper through a public endpoint. */
export async function provisionPortalTeam(
  prisma: PrismaClient,
  input: { brandId: string; members: Array<{ email: string; name: string }> },
) {
  const brand = brandById(input.brandId);
  if (!brand || brand.id === "manor") throw new Error("Choose a registered client brand");
  if (!input.members.length) throw new Error("Provide at least one member");
  const members = await Promise.all(
    input.members.map(async (member) => {
      const email = member.email.trim().toLowerCase();
      const name = member.name.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) throw new Error("Invalid member");
      const password = randomBytes(24).toString("base64url");
      return { email, name, password, hash: await hashPassword(password) };
    }),
  );
  if (new Set(members.map((member) => member.email)).size !== members.length)
    throw new Error("Duplicate member");
  return prisma.$transaction(
    async (tx) => {
      let organization = await tx.organization.findUnique({ where: { brandId: brand.id } });
      if (!organization)
        organization = await tx.organization.create({
          data: {
            id: randomUUID(),
            name: brand.name,
            slug: brand.id,
            brandId: brand.id,
            logo: brand.logo.src,
            createdAt: new Date(),
          },
        });
      let space = await tx.space.findFirst({
        where: { organizationId: organization.id, isDefault: true },
      });
      if (!space)
        space = await tx.space.create({
          data: {
            id: randomUUID(),
            organizationId: organization.id,
            name: brand.name,
            isDefault: true,
          },
        });
      const accounts: Array<{ email: string; password: string | null; created: boolean }> = [];
      for (const member of members) {
        let user = await tx.user.findFirst({
          where: { email: { equals: member.email, mode: "insensitive" } },
        });
        const created = !user;
        if (user?.portalBrandId && user.portalBrandId !== brand.id)
          throw new Error("An existing account belongs to another client portal");
        if (!user) {
          user = await tx.user.create({
            data: {
              id: randomUUID(),
              email: member.email,
              name: member.name,
              portalBrandId: brand.id,
            },
          });
          await tx.account.create({
            data: {
              id: randomUUID(),
              userId: user.id,
              accountId: user.id,
              providerId: "credential",
              password: member.hash,
            },
          });
        }
        const membership = await tx.member.findUnique({
          where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
        });
        if (!membership) {
          await joinOrganization(tx as PrismaClient, user, {
            id: organization.id,
            defaultSpaceId: space.id,
          });
        } else {
          await tx.spaceMember.upsert({
            where: { spaceId_userId: { spaceId: space.id, userId: user.id } },
            update: {},
            create: {
              id: randomUUID(),
              spaceId: space.id,
              organizationId: organization.id,
              userId: user.id,
              role: "member",
              createdAt: new Date(),
            },
          });
        }
        accounts.push({ email: member.email, password: created ? member.password : null, created });
      }
      return {
        organizationId: organization.id,
        spaceId: space.id,
        url: `https://${brand.hostnames[0]}`,
        accounts,
      };
    },
    { timeout: 15_000 },
  );
}
