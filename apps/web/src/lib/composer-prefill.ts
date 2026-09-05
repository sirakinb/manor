export type ComposerPrefill = { key: string; text: string };

/** Route state is untrusted; accept a bounded draft only for the exact bot route. */
export function composerPrefillFromState(
  state: unknown,
  routeKey: string,
  routeBotId?: string,
  activeBotId?: string,
): ComposerPrefill | undefined {
  if (!routeBotId || routeBotId !== activeBotId || !state || typeof state !== "object") return;
  const prefill = (state as { composerPrefill?: unknown }).composerPrefill;
  if (!prefill || typeof prefill !== "object") return;
  const value = prefill as { botId?: unknown; text?: unknown };
  if (
    value.botId !== routeBotId ||
    typeof value.text !== "string" ||
    value.text.length > 4000 ||
    !value.text.trim()
  )
    return;
  return { key: routeKey, text: value.text };
}
