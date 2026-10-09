import { describe, expect, it } from "vitest";
import { signInPathFor, signInReturnPath } from "./return-path";

describe("sign-in return path", () => {
  it("round-trips a same-origin path and rejects external ones", () => {
    const path = signInPathFor({ pathname: "/oauth/authorize", search: "?client_id=a&state=b" });
    expect(signInReturnPath(path.slice("/sign-in".length))).toBe(
      "/oauth/authorize?client_id=a&state=b",
    );
    expect(signInReturnPath("?next=//evil.test")).toBeNull();
    expect(signInReturnPath("?next=/\\evil.test")).toBeNull();
    expect(signInReturnPath("?next=https://evil.test")).toBeNull();
    expect(signInReturnPath("")).toBeNull();
  });
});
