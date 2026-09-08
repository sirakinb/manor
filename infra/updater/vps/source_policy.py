"""Shared operator-installed boundary for automatic application maintenance releases."""
PROTECTED_PREFIXES = (
    "infra/", ".github/", "packages/db/", "apps/mobile/", "apps/desktop/",
    # These packages ship inside installed native clients as well as the web app.
    "packages/contracts/", "packages/core/", "packages/chat-ui/", "packages/ui-tokens/", "packages/brands/",
)


def automatic_source_compatible(files):
    names = [name for name in files if name]
    return bool(names) and all(
        not name.startswith(PROTECTED_PREFIXES)
        and not name.endswith(("package.json", "pnpm-lock.yaml"))
        for name in names
    )
