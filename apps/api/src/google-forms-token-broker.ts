import type { GoogleFormsTokenBroker } from "@rakazo/adapters";
import type { Auth } from "@rakazo/auth";
import type { PrismaClient } from "@rakazo/db";

export function createGoogleFormsTokenBroker(
  prisma: PrismaClient,
  auth: Auth,
): GoogleFormsTokenBroker {
  return {
    async isConnected(userId, requiredScopes) {
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "google" },
        select: { accessToken: true, scope: true },
      });
      if (!account?.accessToken) return false;
      const granted = parseScopes(account.scope);
      return requiredScopes.every((scope) => granted.has(scope));
    },
    async accessToken(userId) {
      const token = await auth.api.getAccessToken({
        body: { providerId: "google", userId },
      });
      if (!token.accessToken) throw new Error("Google Forms is not connected");
      return token.accessToken;
    },
    async disconnect(userId) {
      await prisma.account.updateMany({
        where: { userId, providerId: "google" },
        data: {
          accessToken: null,
          refreshToken: null,
          idToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          scope: null,
        },
      });
    },
  };
}

export function parseScopes(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}
