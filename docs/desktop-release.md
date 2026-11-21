<!-- Modified for Manor: repository visibility description. -->
# Desktop releases (Manor)

The `release-desktop` workflow builds, signs, notarizes, attests, and publishes
the Manor desktop app from a `vMAJOR.MINOR.PATCH` tag on `main` of the Manor
source repository. Installers and the auto-update feed land in the public
release repository `sirakinb/manor-desktop`, which the app's updater reads
without any token. The app ships pointed at `https://manor.pentridgemedia.com`
(`BUNDLED_SERVER_URL` in `apps/desktop/src/setup-config.ts`); a fresh install
opens straight to sign-in, and **Change Server…** in the app menu covers
self-hosters and white-label clients.

## Release repository

Create `sirakinb/manor-desktop` as a public repository with one commit (a
README is enough). Then create a fine-grained personal access token limited to
that repository with **Contents: read and write**, and store it as
`DESKTOP_RELEASE_TOKEN` on the source repository. The workflow refuses to
publish without it and never uses the source repository's own token for
publishing.

## Repository secrets

macOS (required):

| Secret | Value |
| --- | --- |
| `DESKTOP_RELEASE_TOKEN` | Fine-grained PAT with Contents write on `sirakinb/manor-desktop` |
| `DESKTOP_MAC_CSC_LINK` | Base64 of the `Developer ID Application` certificate exported as `.p12` |
| `DESKTOP_MAC_CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_API_KEY_ID` | App Store Connect API key ID (the `XXXXXXXXXX` in `AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_ISSUER` | Issuer ID shown on App Store Connect > Users and Access > Integrations |
| `APPLE_API_KEY_P8` | Contents of the `AuthKey_*.p8` file |

The API key needs the Developer role. The workflow writes it to a mode 600 file
in the runner's temp directory for the packaging step and deletes it afterwards.

`patches/app-builder-lib@26.15.3.patch` carries electron-builder PR #10101:
without it `CSC_LINK` signing fails while creating the temporary keychain. Drop
the patch once an electron-builder release includes that fix.

Windows signs through Azure Artifact Signing once it is configured, logging in
with GitHub OIDC instead of a stored secret. Create a Public Trust certificate
profile, then an app registration with the Artifact Signing Certificate Profile
Signer role on the signing account, and a `desktop-release` environment in the
repository settings. Give the app registration a federated credential whose
subject is exactly the one printed under "Federated token details" in the
release's Azure login step. This repository's OIDC subject includes owner and
repository IDs, so the plain `repo:<owner>/<repo>:environment:desktop-release`
form does not match.

| Secret | Value |
| --- | --- |
| `DESKTOP_WIN_AZURE_TENANT_ID` | Directory (tenant) ID of the app registration |
| `DESKTOP_WIN_AZURE_CLIENT_ID` | Application (client) ID of the app registration |

| Variable | Value |
| --- | --- |
| `DESKTOP_WIN_SIGNING_ENDPOINT` | The signing account's URI, such as `https://eus.codesigning.azure.net/` |
| `DESKTOP_WIN_SIGNING_ACCOUNT` | The signing account name |
| `DESKTOP_WIN_SIGNING_PROFILE` | The certificate profile name |
| `DESKTOP_WIN_PUBLISHER` | The certificate's common name, exactly as validated |

Windows builds are always signed: there is no unsigned installer, and the
release stops if any Windows setting is missing. The release is only published
when every platform produced its installer and update feed.

Set a secret from a file without echoing it:

```sh
base64 -i devid.p12 | gh secret set DESKTOP_MAC_CSC_LINK
gh secret set APPLE_API_KEY_P8 < AuthKey_XXXXXXXXXX.p8
```

## Signing

Set these up before the next desktop release. The build job checks each
platform's settings before it installs anything and names any that are
missing.

- **macOS:** `DESKTOP_MAC_CSC_LINK`, `DESKTOP_MAC_CSC_KEY_PASSWORD`,
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and `APPLE_API_KEY_P8` (secrets, see
  above). `DESKTOP_MAC_PROVISIONING_PROFILE` is optional and only adds the
  system passkey association.
- **Windows:** Azure Artifact Signing with the `desktop-release` environment,
  the secrets `DESKTOP_WIN_AZURE_TENANT_ID` and `DESKTOP_WIN_AZURE_CLIENT_ID`,
  and the variables `DESKTOP_WIN_SIGNING_ENDPOINT`,
  `DESKTOP_WIN_SIGNING_ACCOUNT`, `DESKTOP_WIN_SIGNING_PROFILE` and
  `DESKTOP_WIN_PUBLISHER` (see above).
- **Linux:** an Ed25519 key pair for AppImage update signatures. Store the
  private key (PEM) as the secret `DESKTOP_LINUX_UPDATE_SIGNING_KEY` and the
  public key (PEM) as the variable `DESKTOP_LINUX_UPDATE_PUBLIC_KEY`. The
  build compiles the public key into the app (`RAKAZO_LINUX_UPDATE_PUBLIC_KEY`),
  and each release publishes `<AppImage>.sig` beside the AppImage in
  `sirakinb/manor-desktop`. An installed Linux build downloads an update only
  when it has the key, and installs it only when the signature checks out. A
  build made without the key offers no Linux updates and says so in its update
  status. Changing the key later strands installs made with the old one, so
  keep the private key backed up.

```sh
openssl genpkey -algorithm ed25519 -out linux-update.pem
openssl pkey -in linux-update.pem -pubout -out linux-update.pub.pem
gh secret set DESKTOP_LINUX_UPDATE_SIGNING_KEY < linux-update.pem
gh variable set DESKTOP_LINUX_UPDATE_PUBLIC_KEY < linux-update.pub.pem
```

## Cut a release

Follow `.agents/skills/release/SKILL.md`: one release PR writes the
`CHANGELOG.md` section from the pull requests merged since the last tag and
bumps `version` in `apps/desktop/package.json`. Once it merges, tag the merge
commit `v<version>` and push the tag.

```sh
git tag v0.1.1
git push origin v0.1.1
```

The workflow refuses tags that do not match the desktop version, have no
matching changelog section, are not on `main`, or are not newer than the latest
published release. The release text is that changelog section followed by the
merged pull requests.

## License review before publication

Follow the [distribution review](licensing.md) for each installer or mobile binary.
Verify required license texts, attribution, asset permissions, and applicable dependency
obligations in the actual artifact before publishing it. Source-level attribution alone
does not establish that a downloadable build includes the required notices.
