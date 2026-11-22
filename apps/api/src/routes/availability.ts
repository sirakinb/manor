import { chooseForSpace, listOwnItems, setAvailability } from "../spaces/name-claims.js";
import type { RouterContext } from "./context.js";

export function availabilityRoutes(ctx: RouterContext) {
  const { deps, authed, spaceAuthed } = ctx;
  return {
    availability: {
      // Manor: the item is one visible in this space, which in a team space is the shared account's.
      set: spaceAuthed.availability.set.handler(({ context, input }) =>
        setAvailability(deps.prisma, context.actor, input),
      ),
      // The person's own items, offered when they create a new space; the shared account is
      // not a member of that new space, so these stay with the signed-in person.
      items: authed.availability.items.handler(({ context }) =>
        listOwnItems(deps.prisma, context.actor),
      ),
      chooseForSpace: authed.availability.chooseForSpace.handler(async ({ context, input }) => {
        await chooseForSpace(deps.prisma, context.actor, input);
        return { ok: true as const };
      }),
    },
  };
}
