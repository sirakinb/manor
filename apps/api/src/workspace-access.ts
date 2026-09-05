import { type WorkspaceAccess, workspaceExternalToolsForChannels } from "@rakazo/contracts";
import { createWorkspaceRepos, type PrismaClient } from "@rakazo/db";

/** Resolve only from an authenticated actor or integration principal. */
export async function workspaceAccess(
  prisma: PrismaClient,
  organizationId: string,
): Promise<WorkspaceAccess> {
  const [organization, { workspace }] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true },
    }),
    createWorkspaceRepos(prisma).status({ organizationId }),
  ]);
  const sources = workspace
    ? await prisma.workspaceSource.findMany({
        where: { workspaceId: workspace.id },
        select: { name: true, status: true },
        orderBy: { name: "asc" },
      })
    : [];
  return {
    organization,
    workspace,
    sources,
    tools: workspaceExternalToolsForChannels(workspace?.channels ?? null),
  };
}
