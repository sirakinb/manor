/** Shared by the routine UI and backend setup tools. */
export function routineWebhookPath(botId: string, routineId: string): string {
  return `/api/v1/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(routineId)}/webhook`;
}
