/**
 * Manor: a session acts only in the organization its portal allows (the account's primary one on
 * the main portal, the brand's on a brand portal), and the server refuses creating, switching and
 * inviting into organizations. So the app offers no organization switcher, no "Create
 * organization", no member management and no invitations; turning this on brings upstream's
 * controls back. Its own module so browser specs can read it.
 */
export const ORGANIZATION_SWITCHING: boolean = false;
