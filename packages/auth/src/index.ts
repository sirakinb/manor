import { emailAllowed, parseAllowlist, signupPolicyFromEnv } from "@rakazo/core";
import { bootstrapUserSpace, type PrismaClient } from "@rakazo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { bearer, organization } from "better-auth/plugins";

export interface AuthEnv {
  secret: string;
  baseURL: string;
  webOrigin: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  googleClientId?: string;
  googleClientSecret?: string;
  extraOrigins?: string[];
  beforeDeleteUser?: (userId: string) => Promise<void>;
}

export async function resolveSignupPolicy(
  prisma: Pick<PrismaClient, "deploymentSettings">,
  env: Pick<AuthEnv, "signupsEnabled" | "signupAllowlist">,
): Promise<{ enabled: boolean; allowlist: string[] }> {
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
    select: { signupsEnabled: true, signupAllowlist: true, signupPolicyInitialized: true },
  });
  if (settings?.signupPolicyInitialized) {
    return {
      enabled: settings.signupsEnabled,
      allowlist: parseAllowlist(settings.signupAllowlist),
    };
  }
  return signupPolicyFromEnv(env);
}

/**
 * Enforced on user creation rather than on the sign-up route, because social
 * sign-in never touches a "sign-up" path — Google lands on /sign-in/social and
 * /callback/google, which a route-name check silently waves through.
 */
export async function assertSignupAllowed(
  prisma: Pick<PrismaClient, "deploymentSettings">,
  env: Pick<AuthEnv, "signupsEnabled" | "signupAllowlist">,
  email: string,
): Promise<void> {
  const policy = await resolveSignupPolicy(prisma, env);
  if (!policy.enabled) {
    throw new APIError("BAD_REQUEST", { message: "Registration is closed" });
  }
  if (email && !emailAllowed(email, policy.allowlist)) {
    throw new APIError("BAD_REQUEST", { message: "Email is not allowed to register" });
  }
}

export function createAuth(prisma: PrismaClient, env: AuthEnv) {
  const googleEnabled = Boolean(env.googleClientId && env.googleClientSecret);
  return betterAuth({
    appName: "Rakazo",
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: [env.webOrigin, env.baseURL, ...(env.extraOrigins ?? [])],
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      // Signup policy is mutable deployment state, so the user-create hook below
      // enforces it instead of freezing an environment value at process start.
      disableSignUp: false,
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { disableImplicitLinking: true },
    },
    ...(googleEnabled
      ? {
          socialProviders: {
            google: {
              clientId: env.googleClientId!,
              clientSecret: env.googleClientSecret!,
              accessType: "offline" as const,
              prompt: "select_account consent",
            },
          },
        }
      : {}),
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await env.beforeDeleteUser?.(user.id);
          const memberships = await prisma.member.findMany({
            where: { userId: user.id },
            select: {
              organizationId: true,
              organization: { select: { members: { select: { userId: true } } } },
            },
          });
          const personalOrganizationIds = memberships
            .filter(({ organization }) =>
              organization.members.every((member) => member.userId === user.id),
            )
            .map(({ organizationId }) => organizationId);

          await prisma.$transaction([
            prisma.deploymentSettings.updateMany({
              where: { ownerUserId: user.id },
              data: { ownerUserId: null },
            }),
            // Phone identities are deliberately FK-free, so clear them here
            // or the unique phoneE164 would point at a deleted bot forever.
            prisma.phoneIdentity.deleteMany({
              where: { userId: user.id },
            }),
            prisma.organization.deleteMany({
              where: { id: { in: personalOrganizationIds } },
            }),
          ]);
        },
      },
    },
    plugins: [
      bearer(),
      organization({
        allowUserToCreateOrganization: false,
        creatorRole: "owner",
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            await assertSignupAllowed(prisma, env, String(user.email ?? ""));
          },
          after: async (user) => {
            await bootstrapUserSpace(prisma, user, env);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export const blockedAuthPaths = [
  "/organization/create",
  "/organization/invite",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
];
