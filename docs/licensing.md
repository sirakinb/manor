# Licensing and distribution review

Reviewed on 2026-09-08. This records verified source-level findings and remaining
release work; it is not a certification of every dependency, asset, or binary.

## Source and attribution

- The root `LICENSE` matches the upstream Rakazo license byte for byte. It is
  Apache-2.0 and retains `Copyright 2026 Rakazo contributors`.
- `NOTICE` and the README identify Rakazo as the original project and distinguish
  Manor's modifications. Git history is retained.
- Documentation changed in this cleanup carries modification notices. Future
  edits to upstream files must retain existing notices and identify modifications.
  This review has not audited modification notices in every previously changed file.
- `THIRD_PARTY_NOTICES.md` supplies full MIT notices for the adapted Beautiful UI
  and ThreeUI components, plus the SIL Open Font License for Geist. The bundled
  Geist Pixel font has an adjacent `OFL.txt` so static web builds carry that notice.
- The marketing site uses its existing Geist font instead of the bundled Aeonik
  file, whose public-source redistribution permission was not established.
  Removing a file from the current tree does not remove copies in Git history.

The relevant terms are [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0),
[Beautiful UI's license](https://github.com/TurboKach/ai-native-react-components/blob/main/LICENSE),
[ThreeUI's license](https://github.com/MengTo/threeui/blob/main/LICENSE), and
[Geist's OFL](https://github.com/vercel/geist-font/blob/main/OFL.txt).

## Dependency findings

A preliminary `pnpm licenses list --json` scan of the available installed workspace
found packages under LGPL-3.0-or-later (the platform-specific sharp/libvips package),
EPL-2.0 (`elkjs`), MPL-2.0 (`lightningcss`), and CC-BY-4.0 (`caniuse-lite`), alongside
MIT, Apache, BSD, ISC, and other licenses. These are review items, not findings
that a package is prohibited. Build tools and shipped runtime dependencies have
different distribution implications.

The scan used an existing installation, not a fresh install for a release. Repeat
it against the exact release lockfile on each target platform. Inspect full license
texts and the actual shipped dependency set; package metadata alone is insufficient.

## Before distributing a build

For each web bundle, container image, desktop installer, and mobile binary:

1. Inventory its bundled code, fonts, images, media, native libraries, and OS
   packages. Verify origins and redistribution permission, including brand assets.
2. Include the root `LICENSE`, `NOTICE`, and applicable third-party license texts
   in the artifact, with readable access for recipients. Inspect the built artifact;
   a file in the source repository is not proof it reached the installer.
3. Preserve dependency notices and satisfy any applicable attribution, corresponding
   source, relinking, or source-offer requirements for the actual distribution.
4. Verify modification notices for derived files, including older Manor changes.
5. Record the artifact hash, inventory, license review, and any unresolved questions.
   Do not describe a release as license-cleared while required permissions or
   distribution obligations are unresolved.

The web build emits the root `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`
under `dist/licenses/`; CI compares them with their source files. Electron includes
that web distribution in its resources. This covers those identified notices, not
an inventory of all bundled dependencies.

The application container copies the source tree, including its root license files.
The selective-copy updater/supervisor images, computer image, desktop packaging,
and mobile packaging need artifact-specific verification. This public-page change
has not rebuilt or certified those artifacts. Historical asset permissions and the
remaining image/media provenance also need review before claiming full clearance.

## Project name and support

Manor's support and private security reporting belong to this repository. Attribution
to upstream does not imply upstream endorsement or responsibility for Manor.
Apache-2.0 does not grant a general trademark license. The availability of the Manor
name and third-party brand assets has not been determined by this source review.
