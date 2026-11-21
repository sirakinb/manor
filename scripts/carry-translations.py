#!/usr/bin/env python3
"""Fill empty translations in message catalogs from an older revision.

Used during an upstream sync: the catalogs take upstream's version, which drops
Manor's own translations. This copies every non-empty msgstr for the same msgid
(and msgctxt) from <rev> into entries that are empty now.

Usage: scripts/carry-translations.py <git-rev> <catalog.po>... [--from <old-path>]

The catalogs live in packages/i18n/locales/<locale>/messages.po; run it after
`pnpm intl:extract`. --from reads each catalog from another path at <rev>, for a
revision where the catalogs were elsewhere. Its {locale} is the catalog's folder
name, e.g. --from 'apps/web/src/locales/{locale}/messages.po' for revisions
before upstream v0.10.0.
"""

import os
import re
import subprocess
import sys


def parse(text):
    entries = []
    for block in re.split(r"\n\s*\n", text.strip("\n")):
        fields, current = {}, None
        for line in block.split("\n"):
            match = re.match(r'^(msgctxt|msgid|msgstr)\s+(".*")\s*$', line)
            if match:
                current = match.group(1)
                fields[current] = [match.group(2)]
            elif line.startswith('"') and current:
                fields[current].append(line.strip())
            elif not line.startswith("#"):
                current = None
        entries.append((block, fields))
    return entries


def value(parts):
    return "".join(part[1:-1] for part in parts) if parts else ""


def carry(path, rev, source=None):
    old = source.format(locale=os.path.basename(os.path.dirname(path))) if source else path
    shown = subprocess.run(["git", "show", f"{rev}:{old}"], capture_output=True, text=True)
    if shown.returncode != 0:
        print(f"{path}: {old} not in {rev}, skipped")
        return
    known = {}
    for _, fields in parse(shown.stdout):
        if "msgid" in fields and value(fields.get("msgstr")):
            known[(value(fields.get("msgctxt")), value(fields["msgid"]))] = fields["msgstr"]
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    blocks, filled = [], 0
    for block, fields in parse(text):
        key = (value(fields.get("msgctxt")), value(fields.get("msgid"))) if "msgid" in fields else None
        if key and key[1] and not value(fields.get("msgstr")) and key in known:
            lines, skipping = [], False
            for line in block.split("\n"):
                if line.startswith("msgstr"):
                    parts = known[key]
                    lines.append("msgstr " + parts[0])
                    lines.extend(parts[1:])
                    skipping = True
                elif skipping and line.startswith('"'):
                    continue
                else:
                    skipping = False
                    lines.append(line)
            block = "\n".join(lines)
            filled += 1
        blocks.append(block)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n\n".join(blocks) + "\n")
    print(f"{path}: filled {filled}")


if __name__ == "__main__":
    args, source = sys.argv[1:], None
    if "--from" in args[:-1]:
        at = args.index("--from")
        source, args = args[at + 1], args[:at] + args[at + 2 :]
    if len(args) < 2:
        sys.exit(__doc__)
    for catalog in args[1:]:
        carry(catalog, args[0], source)
