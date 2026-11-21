import type { TransactionalEmail, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import { emailAllowed, isMessagingEmail, parseAllowlist, signupPolicyFromEnv } from "@rakazo/core";
import { bootstrapUserSpace, type PrismaClient } from "@rakazo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
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
  return betterAuth({
    appName: "Rakazo",
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: buildTrustedOrigins(env),
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
    emailVerification: {
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: env.email
        ? async ({ user, url }) => {
            const verificationUrl = new URL(url);
            verificationUrl.searchParams.set(
              "callbackURL",
              new URL("/sign-in", env.webOrigin).href,
            );
            await env.email!.send(verificationEmail(user.email, verificationUrl.href));
          }
        : undefined,
    },
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        for (const value of [ctx.body?.email, ctx.body?.newEmail]) {
          if (typeof value === "string" && isMessagingEmail(value)) {
            throw new APIError("BAD_REQUEST", { message: "Email is not available" });
          }
        }
        let policy =
          ctx.path === "/sign-up/email" || ctx.path === "/sign-in/email"
            ? await resolveSignupPolicy(prisma, env)
            : undefined;
        if (ctx.path === "/sign-up/email") {
          if (!policy?.enabled) {
            throw new APIError("BAD_REQUEST", { message: "Registration is closed" });
          }
          if (!emailAllowed(String(ctx.body?.email ?? ""), policy.allowlist)) {
            throw new APIError("BAD_REQUEST", { message: "Email is not allowed to register" });
          }
          if (policy.allowlist.length > 0 && !env.email) {
            throw new APIError("BAD_REQUEST", { message: "Registration requires email delivery" });
          }
        }
        // Return a request-local override; mutating the shared auth options
        // would leak a concurrent request's policy into another signup.
        return {
          context: {
            context: {
              ...(policy
                ? {
                    options: {
                      emailAndPassword: { requireEmailVerification: policy.allowlist.length > 0 },
                    },
                  }
                : {}),
              internalAdapter: {
                ...ctx.context.internalAdapter,
                // Authorize at lookup: bearer conversion happens after before
                // hooks, and auth mutations also read sessions through here.
                findSession: async (token: string) => {
                  const session = await ctx.context.internalAdapter.findSession(token);
                  if (!session || isMessagingEmail(session.user.email)) return null;
                  if (session.user.emailVerified) return session;
                  policy ??= await resolveSignupPolicy(prisma, env);
                  return policy.allowlist.length === 0 ? session : null;
                },
              },
            },
          },
        };
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            // The auth adapter can still be inside the signup transaction.
            const user = await ctx?.context.internalAdapter.findUserById(session.userId);
            const policy = await resolveSignupPolicy(prisma, env);
            if (
              !user ||
              isMessagingEmail(user.email) ||
              (!user.emailVerified && policy.allowlist.length > 0)
            ) {
              throw new APIError("FORBIDDEN", { message: "Email verification required" });
            }
            const headers = new Headers(ctx?.headers ?? ctx?.request?.headers);
            // Unverified signup must not provision resources or claim the
            // deployment owner. Bootstrap only at the first admitted session.
            const membership = await prisma.spaceMember.findFirst({ where: { userId: user.id } });
            if (!membership) {
              if (!policy.enabled || !emailAllowed(user.email, policy.allowlist)) {
                throw new APIError("FORBIDDEN", { message: "Registration is closed" });
              }
              // Manor: an account belongs to the portal it signed up on. That brand is
              // recorded at user creation when the signup had to wait for verification;
              // otherwise this is the signup request itself and its host decides.
              const pinned = await prisma.user.findUnique({
                where: { id: user.id },
                select: { portalBrandId: true },
              });
              const brandId = pinned?.portalBrandId ?? portalBrandId(headers);
              await bootstrapUserSpace(prisma, user, env, { brandId });
              if (brandId && !pinned?.portalBrandId)
                await prisma.user.update({
                  where: { id: user.id },
                  data: { portalBrandId: brandId },
                });
            }
            // Manor: every session, first or returning, must belong on this portal.
            await assertPortalAccess(prisma, session.userId, headers);
          },
          after: async (session) => {
            await prisma.user.updateMany({
              where: {
                id: session.userId,
                OR: [{ lastSignedInAt: null }, { lastSignedInAt: { lt: session.createdAt } }],
              },
              data: { lastSignedInAt: session.createdAt },
            });
          },
        },
      },
      user: {
        create: {
          // Better Auth 1.6 passes the endpoint context (request + headers) as
          // the second argument; null when the write did not come from a route.
          before: async (user, context) => {
            if (isMessagingEmail(user.email)) {
              throw new APIError("BAD_REQUEST", { message: "Email is not available" });
            }
            await assertSignupAllowed(prisma, env, String(user.email ?? ""));
            const brandId = portalBrandId(
              new Headers(context?.headers ?? context?.request?.headers),
            );
            if (
              brandId &&
              !(await prisma.organization.findUnique({ where: { brandId }, select: { id: true } }))
            )
              throw new APIError("FORBIDDEN", { message: "This portal is not available." });
          },
          // Provisioning waits for the first admitted session (above). Only the portal the
          // signup arrived on is recorded here, so a later verified sign-in joins that
          // client's organization rather than whichever host it happens to use.
          after: async (user, context) => {
            const brandId = portalBrandId(
              new Headers(context?.headers ?? context?.request?.headers),
            );
            if (brandId)
              await prisma.user.updateMany({
                where: { id: user.id, portalBrandId: null },
                data: { portalBrandId: brandId },
              });
          },
        },
        update: {
          before: async (user) => {
            if (user.email && isMessagingEmail(user.email)) {
              throw new APIError("BAD_REQUEST", { message: "Email is not available" });
            }
          },
        },
      },
    },
  });
}

export function verificationEmail(email: string, url: string): TransactionalEmail {
  return {
    to: email,
    subject: "Verify your Rakazo email",
    text: `Verify your email, then return to Rakazo to sign in:\n\n${url}\n\nThis link expires in one hour. If you did not register, ignore this email.`,
    html: `<p><a href="${escapeHtml(url)}">Verify email</a>, then return to Rakazo to sign in.</p><p>This link expires in one hour. If you did not register, ignore this email.</p>`,
  };
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

/** Assemble Better Auth trustedOrigins, adding localhost↔127.0.0.1 twins for loopback. */
export function buildTrustedOrigins(env: Pick<AuthEnv, "webOrigin" | "baseURL" | "extraOrigins">) {
  const configured = [env.webOrigin, env.baseURL, ...(env.extraOrigins ?? [])];
  const twins = [env.webOrigin, env.baseURL].flatMap(loopbackTwinOrigins);
  return [...new Set([...configured, ...twins])];
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/** Same-scheme/port localhost and 127.0.0.1 variants when `origin` is loopback. */
function loopbackTwinOrigins(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (!isLoopbackHost(url.hostname)) return [];
    const twins: string[] = [];
    for (const host of ["localhost", "127.0.0.1"] as const) {
      if (host === url.hostname) continue;
      const twin = new URL(origin);
      twin.hostname = host;
      twins.push(twin.origin);
    }
    return twins;
  } catch {
    return [];
  }
}

export const blockedAuthPaths = [
  "/organization/create",
  "/organization/invite",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
];
