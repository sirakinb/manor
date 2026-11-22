import { AI_CONSENT_REQUIRED } from "@rakazo/contracts";
import { ClientError } from "@rakazo/core";
import { aiConsentStatus } from "../account/ai-consent.js";
import {
  addPageComment,
  getPageGrants,
  getPageReview,
  grantPage,
  listPageReviews,
  pageComments,
  resolvePageComment,
  revokePage,
} from "../content/page-collaboration.js";
import { askPageRevision, getPageDraft, publishPageDraft } from "../content/page-revisions.js";
import {
  getPage,
  listPages,
  pinPage,
  removePage,
  renamePage,
  setPageVisibility,
} from "../content/pages.js";
import type { RouterContext } from "./context.js";

export function pagesRoutes(ctx: RouterContext) {
  const { deps, spaceAuthed } = ctx;
  const pageDeps = () => ({
    prisma: deps.prisma,
    secrets: deps.secrets,
    webOrigin: deps.env.webOrigin,
    events: deps.events,
  });
  return {
    // Manor: a team space's pages belong to its shared account, so review and sharing run on the
    // team-space tier like `pages.*`: the shared account owns and comments as one account, and a
    // page shared with a person is reviewed from that person's own space.
    pageReviews: {
      list: spaceAuthed.pageReviews.list.handler(({ context, input }) =>
        listPageReviews(deps.prisma, context.actor, input.cursor),
      ),
      get: spaceAuthed.pageReviews.get.handler(({ context, input }) =>
        getPageReview(deps.prisma, context.actor, input),
      ),
      grants: spaceAuthed.pageReviews.grants.handler(({ context, input }) =>
        getPageGrants(deps.prisma, context.actor, input.pageId),
      ),
      grant: spaceAuthed.pageReviews.grant.handler(({ context, input }) =>
        grantPage(deps, context.actor, input),
      ),
      revoke: spaceAuthed.pageReviews.revoke.handler(({ context, input }) =>
        revokePage(deps, context.actor, input),
      ),
      comments: spaceAuthed.pageReviews.comments.handler(({ context, input }) =>
        pageComments(deps.prisma, context.actor, input),
      ),
      comment: spaceAuthed.pageReviews.comment.handler(({ context, input }) =>
        addPageComment(deps, context.actor, input),
      ),
      resolve: spaceAuthed.pageReviews.resolve.handler(({ context, input }) =>
        resolvePageComment(deps, context.actor, input),
      ),
      askRevision: spaceAuthed.pageReviews.askRevision.handler(async ({ context, input }) => {
        if (!deps.pageRevisions)
          throw new ClientError("SERVICE_UNAVAILABLE", "Page revisions are unavailable");
        const consent = await aiConsentStatus(deps, context.actor, { pageId: input.pageId });
        if (consent.recipients.some((recipient) => !recipient.allowed))
          throw new ClientError("FORBIDDEN", AI_CONSENT_REQUIRED, "AI_CONSENT_REQUIRED");
        return askPageRevision({ ...deps, start: deps.pageRevisions.start }, context.actor, input);
      }),
      draft: spaceAuthed.pageReviews.draft.handler(({ context, input }) =>
        getPageDraft(deps.prisma, context.actor, input),
      ),
      publish: spaceAuthed.pageReviews.publish.handler(({ context, input }) =>
        publishPageDraft(deps, context.actor, input),
      ),
    },
    pages: {
      list: spaceAuthed.pages.list.handler(({ context, input }) =>
        listPages(deps.prisma, context.actor, input),
      ),
      get: spaceAuthed.pages.get.handler(({ context, input }) =>
        getPage(pageDeps(), context.actor, input),
      ),
      rename: spaceAuthed.pages.rename.handler(({ context, input }) =>
        renamePage(deps.prisma, context.actor, input.pageId, input.title, deps.events),
      ),
      setVisibility: spaceAuthed.pages.setVisibility.handler(({ context, input }) =>
        setPageVisibility(
          pageDeps(),
          context.actor,
          input,
          context.signal ?? new AbortController().signal,
        ),
      ),
      pin: spaceAuthed.pages.pin.handler(({ context, input }) =>
        pinPage(deps.prisma, context.actor, input.pageId, input.pinned),
      ),
      remove: spaceAuthed.pages.remove.handler(({ context, input }) =>
        removePage(pageDeps(), context.actor, input.pageId),
      ),
    },
  };
}
