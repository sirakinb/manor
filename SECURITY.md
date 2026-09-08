<!-- Modified for Manor: private reporting route, scope, and support links. -->
# Manor security policy

## Reporting vulnerabilities

Use [Manor's private vulnerability reporting form](https://github.com/sirakinb/manor/security/advisories/new).
Reports go to this repository's maintainers. Do not open public issues or pull requests with
vulnerability details.

Please include:

- Steps to reproduce
- Impact (what an attacker could do)
- Whether the issue is already public
- The affected version or commit and platform: web, desktop, mobile, or self-hosted server

Use a minimal reproduction with fake data. Do not include credentials, customer data, or private
host diagnostics.

We will acknowledge your report and work on a fix. Please do not file a public issue for unfixed vulnerabilities.

## General support

For non-security bugs and self-hosting questions, use [Manor issues](https://github.com/sirakinb/manor/issues/new/choose).

## Scope

This policy covers Manor's web, desktop, mobile, and server code in **this repository**.

Out of scope:

- Third-party AI models and their APIs
- Composio, E2B, and other external services
- Operator-only misconfiguration, such as exposed secrets or open databases. Unsafe application
  defaults or product bugs that cause exposure are in scope.

## Supported versions

Security fixes target the current `main` branch and the latest published release for each platform.
Older builds may require an upgrade.

There is no bug bounty program at this time.
