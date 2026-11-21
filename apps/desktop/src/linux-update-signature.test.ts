import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyUpdaterFailure } from "./auto-update.js";
import {
  fetchLinuxUpdateSignature,
  linuxUpdatePublicKey,
  linuxUpdateSignatureMessage,
  SignatureUnreachableError,
  sha512File,
  verifyDownloadedLinuxUpdate,
  verifyLinuxUpdate,
} from "./linux-update-signature.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const dirs: string[] = [];
// The repository `scripts/build.mjs` gives the build: the update feed's, from package.json.
const { build } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  build: { publish: Array<{ provider: string; owner: string; repo: string }> };
};
const feed = build.publish.find((entry) => entry.provider === "github")!;

function appImage(contents = "fake appimage") {
  const dir = mkdtempSync(path.join(tmpdir(), "linux-update-"));
  dirs.push(dir);
  const file = path.join(dir, "Rakazo-1.2.3.AppImage");
  writeFileSync(file, contents);
  return file;
}

async function signatureFor(file: string, key = privateKey, version = "1.2.3") {
  const message = linuxUpdateSignatureMessage(version, path.basename(file), await sha512File(file));
  return `${sign(null, message, key).toString("base64")}\n`;
}

function respond(body: string | null, init: ResponseInit = {}) {
  return vi.fn(async (_url: string) => new Response(body, init));
}

beforeEach(() => {
  vi.stubEnv("RAKAZO_DESKTOP_UPDATE_REPOSITORY", `${feed.owner}/${feed.repo}`);
  vi.stubEnv("RAKAZO_LINUX_UPDATE_PUBLIC_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("linuxUpdateSignatureMessage", () => {
  it("is the versioned three-line format the release workflow signs", () => {
    expect(
      linuxUpdateSignatureMessage("1.2.3", "Rakazo-1.2.3.AppImage", "ab12").toString("utf8"),
    ).toBe("rakazo-linux-update-v1\n1.2.3\nRakazo-1.2.3.AppImage\nab12\n");
  });

  it("hashes the whole file with SHA-512", async () => {
    const file = appImage("abc");
    expect(await sha512File(file)).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
  });
});

describe("verifyLinuxUpdate", () => {
  it("accepts a file signed by the key", async () => {
    const file = appImage();
    expect(await verifyLinuxUpdate(file, await signatureFor(file), "1.2.3", publicKey)).toBe(true);
  });

  it("rejects a file changed after signing", async () => {
    const file = appImage();
    const signature = await signatureFor(file);
    writeFileSync(file, "tampered appimage");
    expect(await verifyLinuxUpdate(file, signature, "1.2.3", publicKey)).toBe(false);
  });

  it("rejects a signed older build relabelled as a newer version", async () => {
    const file = appImage();
    const signature = await signatureFor(file);
    expect(await verifyLinuxUpdate(file, signature, "1.3.0", publicKey)).toBe(false);
  });

  it("rejects a signature from another key", async () => {
    const file = appImage();
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(await verifyLinuxUpdate(file, await signatureFor(file, other), "1.2.3", publicKey)).toBe(
      false,
    );
  });

  it("has no release key unless the build supplies one", async () => {
    const file = appImage();
    expect(linuxUpdatePublicKey()).toBeNull();
    const error = await verifyLinuxUpdate(file, await signatureFor(file), "1.2.3").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("not configured");
    expect(classifyUpdaterFailure(error).kind).toBe("signature");
  });

  it("checks against the release key the build supplies", async () => {
    const file = appImage();
    vi.stubEnv(
      "RAKAZO_LINUX_UPDATE_PUBLIC_KEY",
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    expect(await verifyLinuxUpdate(file, await signatureFor(file), "1.2.3")).toBe(true);
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(await verifyLinuxUpdate(file, await signatureFor(file, other), "1.2.3")).toBe(false);
  });

  it("rejects malformed signatures and file names", async () => {
    const file = appImage();
    expect(await verifyLinuxUpdate(file, "", "1.2.3", publicKey)).toBe(false);
    expect(await verifyLinuxUpdate(file, "not base64!", "1.2.3", publicKey)).toBe(false);
    const renamed = path.join(path.dirname(file), "rakazo.sh");
    writeFileSync(renamed, "fake appimage");
    expect(await verifyLinuxUpdate(renamed, await signatureFor(renamed), "1.2.3", publicKey)).toBe(
      false,
    );
  });
});

describe("fetchLinuxUpdateSignature", () => {
  it("reads the signature beside the AppImage in the update feed's release", async () => {
    const fetchUrl = respond("signature\n");
    expect(await fetchLinuxUpdateSignature("1.2.3", "Rakazo-1.2.3.AppImage", fetchUrl)).toBe(
      "signature\n",
    );
    expect(fetchUrl).toHaveBeenCalledWith(
      `https://github.com/${feed.owner}/${feed.repo}/releases/download/v1.2.3/Rakazo-1.2.3.AppImage.sig`,
      expect.any(AbortSignal),
    );
  });

  it("does not look for a signature without the feed's repository", async () => {
    vi.stubEnv("RAKAZO_DESKTOP_UPDATE_REPOSITORY", "");
    const fetchUrl = respond("signature");
    await expect(
      fetchLinuxUpdateSignature("1.2.3", "Rakazo-1.2.3.AppImage", fetchUrl),
    ).rejects.toThrow("cannot be located");
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("refuses versions and names that could point elsewhere", async () => {
    const fetchUrl = respond("signature");
    for (const [version, name] of [
      ["1.2.3/../../x", "Rakazo-1.2.3.AppImage"],
      ["1.2.3", "../Rakazo-1.2.3.AppImage"],
      ["1.2.3", "Rakazo-1.2.3.exe"],
    ] as const) {
      await expect(fetchLinuxUpdateSignature(version, name, fetchUrl)).rejects.toThrow();
    }
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("treats a missing signature as a signature failure", async () => {
    const error = await fetchLinuxUpdateSignature(
      "1.2.3",
      "Rakazo-1.2.3.AppImage",
      respond("Not Found", { status: 404 }),
    ).catch((caught: unknown) => caught);
    expect(classifyUpdaterFailure(error).kind).toBe("signature");
  });

  it("gives up on a request that never answers", async () => {
    const hanging = vi.fn(
      (_url: string, signal: AbortSignal) =>
        new Promise<Response>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    );
    const error = await fetchLinuxUpdateSignature(
      "1.2.3",
      "Rakazo-1.2.3.AppImage",
      hanging,
      10,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SignatureUnreachableError);
    expect(classifyUpdaterFailure(error).kind).not.toBe("signature");
  });

  it("stops reading an oversized signature", async () => {
    const large = "a".repeat(4_096);
    await expect(
      fetchLinuxUpdateSignature("1.2.3", "Rakazo-1.2.3.AppImage", respond(large)),
    ).rejects.toThrow("too large");
    await expect(
      fetchLinuxUpdateSignature(
        "1.2.3",
        "Rakazo-1.2.3.AppImage",
        respond("small", { headers: { "content-length": "4096" } }),
      ),
    ).rejects.toThrow("too large");
  });
});

describe("verifyDownloadedLinuxUpdate", () => {
  it.each([
    ["a server error", async () => respond("Unavailable", { status: 503 })],
    [
      "a network failure",
      async () =>
        vi.fn(async () => {
          throw new TypeError("fetch failed");
        }),
    ],
  ])("keeps the download after %s", async (_case, fetchFor) => {
    const file = appImage();
    const error = await verifyDownloadedLinuxUpdate(
      { version: "1.2.3", downloadedFile: file },
      await fetchFor(),
      publicKey,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SignatureUnreachableError);
    expect(classifyUpdaterFailure(error).kind).not.toBe("signature");
    expect(existsSync(file)).toBe(true);
  });

  it("keeps a verified download", async () => {
    const file = appImage();
    await verifyDownloadedLinuxUpdate(
      { version: "1.2.3", downloadedFile: file },
      respond(await signatureFor(file)),
      publicKey,
    );
    expect(existsSync(file)).toBe(true);
  });

  it.each([
    [
      "tampered",
      async (file: string) => {
        const signature = await signatureFor(file);
        writeFileSync(file, "tampered appimage");
        return respond(signature);
      },
    ],
    ["missing", async () => respond("Not Found", { status: 404 })],
    ["oversized", async () => respond("a".repeat(4_096))],
  ])("deletes a download whose signature is %s", async (_case, fetchFor) => {
    const file = appImage();
    const fetchUrl = await fetchFor(file);
    const error = await verifyDownloadedLinuxUpdate(
      { version: "1.2.3", downloadedFile: file },
      fetchUrl,
      publicKey,
    ).catch((caught: unknown) => caught);
    expect(classifyUpdaterFailure(error).kind).toBe("signature");
    expect(existsSync(file)).toBe(false);
  });
});
