/** The same-origin path to resume after sign-in, from `?next=`; never an external URL. */
export function signInReturnPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

export function signInPathFor(location: { pathname: string; search: string }): string {
  return `/sign-in?${new URLSearchParams({ next: location.pathname + location.search })}`;
}
