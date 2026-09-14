import { createHash, randomBytes } from "node:crypto";

export function hashLocalDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintLocalDeviceToken(): { token: string; prefix: string } {
  const token = `mnrc_${randomBytes(32).toString("hex")}`;
  return { token, prefix: token.slice(0, 12) };
}
