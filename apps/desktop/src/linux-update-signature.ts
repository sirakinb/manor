import type { KeyObject } from "node:crypto";
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * Public half of the Ed25519 key the release workflow signs Linux AppImages with, as PEM. It is
 * injected at build time (`scripts/build.mjs`) and never committed; a build without it cannot
 * verify an update, so it does not offer Linux updates at all.
 */
export function linuxUpdatePublicKey(): string | null {
  const key = process.env.RAKAZO_LINUX_UPDATE_PUBLIC_KEY?.trim();
  return key ? `${key}\n` : null;
}

function requiredPublicKey(): string {
  const key = linuxUpdatePublicKey();
  if (key === null) throw new Error("Linux update signature key is not configured.");
  return key;
}

const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * Releases of the repository the update feed reads (`owner/repo`), which `scripts/build.mjs`
 * takes from the `publish` entry in package.json.
 */
function releasesUrl(): string {
  const repository = process.env.RAKAZO_DESKTOP_UPDATE_REPOSITORY?.trim() ?? "";
  if (!REPOSITORY.test(repository)) throw new Error("Linux update signature cannot be located.");
  return `https://github.com/${repository}/releases/download`;
}

const MAX_SIGNATURE_BYTES = 1_024;
const UPDATE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.AppImage$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;

/**
 * Signing a short message instead of the AppImage keeps verification streaming. The version is
 * signed so a feed cannot relabel an older signed build as a newer release.
 */
export function linuxUpdateSignatureMessage(version: string, fileName: string, sha512Hex: string) {
  return Buffer.from(`rakazo-linux-update-v1\n${version}\n${fileName}\n${sha512Hex}\n`, "utf8");
}

export async function sha512File(file: string) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function verifyLinuxUpdate(
  file: string,
  signature: string,
  version: string,
  publicKey: KeyObject | string = requiredPublicKey(),
) {
  const fileName = path.basename(file);
  const encoded = signature.trim();
  if (!VERSION.test(version) || !UPDATE_FILE.test(fileName) || !SIGNATURE.test(encoded))
    return false;
  const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  if (key.asymmetricKeyType !== "ed25519") return false;
  const message = linuxUpdateSignatureMessage(version, fileName, await sha512File(file));
  return verify(null, message, key, Buffer.from(encoded, "base64"));
}

export type SignatureFetch = (url: string, signal: AbortSignal) => Promise<Response>;

/** The release could not be reached; the download is kept so a later check can verify it. */
export class SignatureUnreachableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Could not reach the update server.", options);
    this.name = "SignatureUnreachableError";
  }
}

/** Reads the `.sig` published beside the AppImage in the official release. */
export async function fetchLinuxUpdateSignature(
  version: string,
  fileName: string,
  fetchUrl: SignatureFetch,
  timeoutMs = 30_000,
) {
  if (!VERSION.test(version) || !UPDATE_FILE.test(fileName)) {
    throw new Error("Linux update signature cannot be located.");
  }
  const releases = releasesUrl();
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchUrl(`${releases}/v${version}/${fileName}.sig`, signal);
  } catch (error) {
    throw new SignatureUnreachableError({ cause: error });
  }
  if (response.status === 404 || (response.ok && response.body === null)) {
    await response.body?.cancel();
    throw new Error("Linux update signature is missing.");
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    throw new SignatureUnreachableError();
  }
  if (Number(response.headers.get("content-length") ?? 0) > MAX_SIGNATURE_BYTES) {
    await response.body.cancel();
    throw new Error("Linux update signature is too large.");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_SIGNATURE_BYTES) throw new Error("Linux update signature is too large.");
      chunks.push(chunk);
      if (signal.aborted) throw signal.reason;
    }
  } catch (error) {
    if (size > MAX_SIGNATURE_BYTES) throw error;
    throw new SignatureUnreachableError({ cause: error });
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Fails closed: an update without a valid signature is removed before it can be installed. */
export async function verifyDownloadedLinuxUpdate(
  payload: { version: string; downloadedFile: string },
  fetchUrl: SignatureFetch,
  publicKey: KeyObject | string = requiredPublicKey(),
) {
  try {
    const signature = await fetchLinuxUpdateSignature(
      payload.version,
      path.basename(payload.downloadedFile),
      fetchUrl,
    );
    if (!(await verifyLinuxUpdate(payload.downloadedFile, signature, payload.version, publicKey))) {
      throw new Error("Linux update signature is invalid.");
    }
  } catch (error) {
    if (!(error instanceof SignatureUnreachableError))
      await rm(payload.downloadedFile, { force: true }).catch(() => undefined);
    throw error;
  }
}
