import { describe, expect, it } from "vitest";
import { decodeBase32, generateTotp, normalizeTotpSecret, totpSecondsRemaining } from "./totp.js";

// RFC 6238 test vector secret "12345678901234567890" in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("decodes base32", () => {
    expect(decodeBase32(RFC_SECRET).toString("ascii")).toBe("12345678901234567890");
    expect(decodeBase32("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq==")).toEqual(
      decodeBase32(RFC_SECRET),
    );
  });

  it("matches RFC 6238 SHA-1 vectors (8 digits)", () => {
    expect(generateTotp(RFC_SECRET, { now: 59_000, digits: 8 })).toBe("94287082");
    expect(generateTotp(RFC_SECRET, { now: 1_111_111_109_000, digits: 8 })).toBe("07081804");
    expect(generateTotp(RFC_SECRET, { now: 1_234_567_890_000, digits: 8 })).toBe("89005924");
  });

  it("defaults to 6 digits and a 30 second step", () => {
    expect(generateTotp(RFC_SECRET, { now: 59_000 })).toBe("287082");
    expect(generateTotp(RFC_SECRET, { now: 59_000 })).toBe(
      generateTotp(RFC_SECRET, { now: 30_000 }),
    );
  });

  it("normalizes otpauth URIs and raw secrets", () => {
    expect(
      normalizeTotpSecret(
        "otpauth://totp/Example:aki?secret=gezd%20gnbv%20gy3t%20qojq&issuer=Example",
      ),
    ).toBe("GEZDGNBVGY3TQOJQ");
    expect(normalizeTotpSecret(" gezdgnbvgy3tqojq ")).toBe("GEZDGNBVGY3TQOJQ");
    expect(() => normalizeTotpSecret("not!base32")).toThrow();
    expect(() => normalizeTotpSecret("otpauth://totp/x")).toThrow();
  });

  it("reports seconds remaining in the step", () => {
    expect(totpSecondsRemaining(0)).toBe(30);
    expect(totpSecondsRemaining(29_000)).toBe(1);
  });
});
