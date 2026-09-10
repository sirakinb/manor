import { createDb } from "@rakazo/db";
import { parsePortalTeamInput, provisionPortalTeam } from "./provision-team.js";

// Read identities from private stdin, never command arguments or tracked fixtures.
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = parsePortalTeamInput(JSON.parse(Buffer.concat(chunks).toString("utf8")));
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { prisma, pool } = createDb(process.env.DATABASE_URL);
try {
  const result = await provisionPortalTeam(prisma, input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  try {
    await prisma.$disconnect();
  } finally {
    await pool.end();
  }
}
