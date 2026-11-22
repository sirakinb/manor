/** Manor: routes that render a full-pane place (Workspace, CRM, docs) instead of a chat. */
export function isPlaceRoute(pathname: string): boolean {
  return (
    pathname === "/app/crm" ||
    pathname === "/app/docs" ||
    pathname === "/app/workspace" ||
    pathname.startsWith("/app/workspace/")
  );
}
