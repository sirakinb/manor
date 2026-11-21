#!/usr/bin/env node
// Manor's Actor requires organizationId; upstream's test actors lack it. Adds one
// `organizationId` line after `spaceId` in every object literal that has userId, spaceId
// and isDeploymentOwner but no organizationId. Uses the file's only organization id
// string if it has exactly one, else "org-1".
// Usage: node scripts/add-actor-organization.mjs apps/api/src apps/worker/src
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const pnpmDir = join(import.meta.dirname, "../node_modules/.pnpm");
const tsDir = readdirSync(pnpmDir)
  .filter((d) => /^typescript@[56]\./.test(d))
  .sort()
  .at(-1);
const ts = createRequire(import.meta.url)(join(pnpmDir, tsDir, "node_modules/typescript"));
const files = (p) =>
  statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : [p];

for (const file of process.argv
  .slice(2)
  .flatMap(files)
  .filter((f) => /\.test\.tsx?$/.test(f))) {
  const text = readFileSync(file, "utf8");
  const ids = new Set([...text.matchAll(/organizationId: "([^"]+)"/g)].map((m) => m[1]));
  const id = ids.size === 1 ? [...ids][0] : "org-1";
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const inserts = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = node.properties;
      const name = (p) => p.name && ts.isIdentifier(p.name) && p.name.text;
      const names = new Set(props.map(name));
      const space = props.find((p) => name(p) === "spaceId");
      if (
        space &&
        names.has("userId") &&
        names.has("isDeploymentOwner") &&
        !names.has("organizationId") &&
        !props.some(ts.isSpreadAssignment)
      ) {
        const comma = text.indexOf(",", space.end);
        const line = text.slice(text.lastIndexOf("\n", space.getStart()) + 1, space.getStart());
        const multiline = /^\s*$/.test(line) && text.slice(space.end, comma + 1).trim() === ",";
        inserts.push(
          multiline
            ? [comma + 1, `\n${line}organizationId: "${id}",`]
            : [space.end, `, organizationId: "${id}"`],
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!inserts.length) continue;
  let out = text;
  for (const [at, s] of inserts.sort((a, b) => b[0] - a[0]))
    out = out.slice(0, at) + s + out.slice(at);
  writeFileSync(file, out);
  console.log(`${file}: ${inserts.length}`);
}
