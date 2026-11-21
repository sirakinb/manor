import { ORPCError } from "@orpc/server";
import {
  getPage,
  listPages,
  PageListCursorError,
  PageShareConflictError,
  pinPage,
  removePage,
  renamePage,
  setPageVisibility,
} from "../pages.js";
import type { RouterContext } from "./context.js";

export function pagesRoutes(ctx: RouterContext) {
  const { deps, spaceAuthed } = ctx;
  const pageDeps = () => ({
    prisma: deps.prisma,
    secrets: deps.secrets,
    webOrigin: deps.env.webOrigin,
  });
  return {
    pages: {
      list: spaceAuthed.pages.list.handler(async ({ context, input }) => {
        try {
          return await listPages(deps.prisma, context.actor, input);
        } catch (error) {
          if (error instanceof PageListCursorError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
      }),
      get: spaceAuthed.pages.get.handler(({ context, input }) =>
        getPage(pageDeps(), context.actor, input),
      ),
      rename: spaceAuthed.pages.rename.handler(({ context, input }) =>
        renamePage(deps.prisma, context.actor, input.pageId, input.title),
      ),
      setVisibility: spaceAuthed.pages.setVisibility.handler(async ({ context, input }) => {
        try {
          return await setPageVisibility(
            pageDeps(),
            context.actor,
            input,
            context.signal ?? new AbortController().signal,
          );
        } catch (error) {
          if (error instanceof PageShareConflictError) {
            throw new ORPCError("CONFLICT", { message: error.message });
          }
          throw error;
        }
      }),
      pin: spaceAuthed.pages.pin.handler(({ context, input }) =>
        pinPage(deps.prisma, context.actor, input.pageId, input.pinned),
      ),
      remove: spaceAuthed.pages.remove.handler(({ context, input }) =>
        removePage(pageDeps(), context.actor, input.pageId),
      ),
    },
  };
}
