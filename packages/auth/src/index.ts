import type { TransactionalEmail, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import { emailAllowed, parseAllowlist, signupPolicyFromEnv } from "@rakazo/core";
import { bootstrapUserSpace, type PrismaClient } from "@rakazo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { bearer, organization } from "better-auth/plugins";
import { assertPortalAccess, portalBrandId } from "./portal.js";

export { assertPortalAccess, requirePortalMembership } from "./portal.js";

export interface AuthEnv {
  secret: string;
  baseURL: string;
  webOrigin: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  googleClientId?: string;
  googleClientSecret?: string;
  extraOrigins?: string[];
  email?: TransactionalEmailProvider;
  onEmailError?: (error: unknown) => void;
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

/** Signup and session authorization use the same destination-host resolution. */
export function signupBrandId(
  headers: ConstructorParameters<typeof Headers>[0] | undefined,
): string | null {
  return portalBrandId(new Headers(headers));
}

export function createAuth(prisma: PrismaClient, env: AuthEnv) {
  const googleEnabled = Boolean(env.googleClientId && env.googleClientSecret);
  // Better Auth defers user.create.after until its transaction finishes, after
  // the initial session is created. Only a verified new-user request may wait
  // for that bootstrap; existing-account sign-ins must already have access.
  const newUserContexts = new WeakSet<object>();
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
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: env.email
        ? async ({ user, url }) => {
            // Keep the response timing generic. Production providers track and retry the promise,
            // while the composition root drains accepted delivery during graceful shutdown.
            void env.email
              ?.send(passwordResetEmail(user, url))
              .catch((error) => env.onEmailError?.(error));
          }
        : undefined,
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
            // Messaging identities are deliberately FK-free, so clear them
            // here or the unique address would point at a deleted bot forever.
            prisma.messagingIdentity.deleteMany({
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
          before: async (user, context) => {
            await assertSignupAllowed(prisma, env, String(user.email ?? ""));
            const brandId = portalBrandId(
              new Headers(context?.headers ?? context?.request?.headers),
            );
            if (
              brandId &&
              !(await prisma.organization.findUnique({ where: { brandId }, select: { id: true } }))
            )
              throw new APIError("FORBIDDEN", { message: "This portal is not available." });
            if (context) newUserContexts.add(context);
          },
          // Better Auth 1.6 passes the endpoint context (request + headers) as
          // the second argument; null when the write did not come from a route.
          after: async (user, context) => {
            const brandId = portalBrandId(
              new Headers(context?.headers ?? context?.request?.headers),
            );
            await bootstrapUserSpace(prisma, user, env, { brandId });
            if (brandId)
              await prisma.user.update({
                where: { id: user.id },
                data: { portalBrandId: brandId },
              });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await prisma.user.updateMany({
              where: {
                id: session.userId,
                OR: [{ lastSignedInAt: null }, { lastSignedInAt: { lt: session.createdAt } }],
              },
              data: { lastSignedInAt: session.createdAt },
            });
          },
          before: async (session, context) => {
            if (context && newUserContexts.has(context)) return;
            await assertPortalAccess(
              prisma,
              session.userId,
              new Headers(context?.headers ?? context?.request?.headers),
            );
          },
        },
      },
    },
  });
}

export function passwordResetEmail(
  user: { id: string; email: string; name: string },
  resetUrl: string,
): TransactionalEmail {
  const name = user.name.trim() || "there";
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);
  return {
    to: user.email,
    subject: "Reset your Rakazo password",
    text: [
      `Hi ${name},`,
      "",
      "Reset your Rakazo password using this link:",
      resetUrl,
      "",
      "This link expires in one hour. If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `<p>Hi ${safeName},</p><p>Reset your Rakazo password:</p><p><a href="${safeUrl}">Reset password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this email.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
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
