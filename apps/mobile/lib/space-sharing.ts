/**
 * Manor keeps its team spaces: an organization's people share one space account, and Team
 * members in Settings shows who is in it. Upstream's sharing of a space by invite link (the
 * Members sheet's Invite, Cancel open invites, Remove and Leave) would add per-person members
 * to a space, which mixes the two models, and the server refuses it. So the app does not offer
 * the Members sheet; turning this on brings upstream's controls back.
 */
export const SPACE_SHARING: boolean = false;
