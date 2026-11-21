import type { WorkspaceAccess } from "@rakazo/contracts";
import { workspaceExternalToolsForChannels } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { createWorkspaceRepos } from "@rakazo/db";

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
