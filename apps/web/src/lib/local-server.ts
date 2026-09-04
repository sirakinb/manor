/**
 * True for loopback hostnames, where the API runs on this machine. The desktop
 * "use this Mac" choice only applies there: against a hosted server, the host
 * would be the VPS, not the user's laptop.
 */
export function isLocalServer(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}
