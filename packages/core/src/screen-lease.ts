export function screenLeaseId(runId: string, fence: number): string {
  return `${runId}:${fence}`;
}

export function parseScreenLeaseId(leaseId: string): { ownerId: string; fence: number } {
  const separator = leaseId.lastIndexOf(":");
  if (separator <= 0) return { ownerId: leaseId, fence: 0 };
  const fence = Number(leaseId.slice(separator + 1));
  if (!Number.isInteger(fence) || fence < 0) return { ownerId: leaseId, fence: 0 };
  return { ownerId: leaseId.slice(0, separator), fence };
}

export function canTakeScreenLease(
  existing: string | undefined,
  incoming: string | undefined,
): boolean {
  if (!incoming) return false;
  if (!existing || existing === incoming) return true;
  const current = parseScreenLeaseId(existing);
  const next = parseScreenLeaseId(incoming);
  // Fences only order requests within one run. Across runs the execution lease
  // has already serialised things, and a fresh run always starts at fence 1 —
  // so comparing fences here would wedge the screen behind a finished run.
  if (next.ownerId !== current.ownerId) return true;
  return next.fence > current.fence;
}

export function canReleaseScreenLease(
  existing: string | undefined,
  incoming: string | undefined,
): boolean {
  if (!incoming || !existing || existing === incoming) return true;
  const current = parseScreenLeaseId(existing);
  const next = parseScreenLeaseId(incoming);
  return next.ownerId === current.ownerId && next.fence >= current.fence;
}
