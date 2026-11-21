/**
 * Manor: a team space is shared through its organization and acts as one shared account, so
 * upstream's invite-link sharing (invite links, joining by link, the members list with remove
 * and leave) is off and the server refuses it. Team members show in Settings > Team members.
 * Turning this on brings upstream's controls back once the server allows them.
 */
export const SPACE_SHARING: boolean = false;
