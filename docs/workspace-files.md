# Workspace files

Files provides a file manager for the bot's computer across web, Electron, and mobile. With a VM provider, file operations and Git run in that VM's portable workspace. Rakazo's persisted workspace copy is on the deployment's storage. Neither is the end user's device filesystem. Upload explicitly imports a device file; Download explicitly exports one. The optional desktop sandbox remains a separately configured local execution provider.

## Browse

- Bot files selects the bot's folder on a Team Computer, or the entire workspace on a Private Computer. Shared files selects the Team Computer's shared folder. Relative paths stay inside the selected location; Move can explicitly change locations.
- Create files and folders, upload, download, rename, move, delete, search by path, and show hidden files. Search walks the current folder and descendants, with depth and result limits and dependency/cache pruning.
- Edit UTF-8 text up to 2 MiB. Images and PDFs preview in the web panel (PDF.js and its worker are bundled locally); Markdown uses the shared renderer. Native mobile previews images and Markdown, and opens PDFs through the device's document viewer. Other binary files can be downloaded. Uploads, downloads, and previews are limited to 10 MiB. Larger files can still be renamed, moved, or deleted.
- Attach to chat adds a saved copy to the originating bot's composer, subject to the existing attachment type/count limits. It does not send a message.
- New folders contain a hidden `.gitkeep` file so empty directories survive the existing file-based checkpoint/export contract. This is an ordinary file and may be committed to Git.

The computer must be awake for this file manager. Older read/list RPCs retain access to the persisted home while asleep. New controls use the running computer to ensure file operations, Git, and revision checks see the same filesystem. Normal run/stop/idle checkpoints preserve work; Save is neither a Git commit nor an immediate remote backup.

## Editing safeguards

The shared controller ignores responses from older folder/file requests. Text revisions are content hashes. Save checks the revision inside the computer, before replacing the file. A changed or missing file retains the user's draft and requires reloading; the draft can be downloaded first. Browsing away asks before discarding edits. The web shell keeps drafts in memory when the panel closes or bots switch, and warns before page unload. Native navigation protects unsaved edits and in-progress operations.

The API authorizes the bot before reaching its computer. Mutations claim a bounded computer-level lease, refuse to run while any bot on that computer has active work, and release the lease on success or error. Team execution checks the mutation lease both before and after acquiring a bot lease. Computer idle handling defers while a file mutation is active. This does not stop independently launched background processes or direct desktop edits; revision checks cover changes observed before the file operation.

File operations run through the provider-neutral sandbox command/file interfaces. The POSIX helper requires Python 3 and traverses paths with no-follow directory descriptors. It rejects parent/absolute paths, links, special files, and direct `.git` edits. Uploads and moves refuse replacement; deletion requires a matching revision, including folder descendants. Providers without the required safe filesystem primitives return an explicit error. The in-memory fake provider emulates file operations for offline testing and reports Git as unavailable.

## Git

Changes discovers repositories in the selected location. It shows the branch, changed files, and file diffs; users choose files and a message before committing. Git can be initialized in the current folder. Branch creation and switching require a clean working tree. No remote connection, hosted Git vendor, or push occurs.

Commits include only selected files. Existing repository author settings are used; absent settings fall back to the application identity `Rakazo <workspace@rakazo.invalid>`. Revision checks reject stale commit/branch requests. Initial repositories without a commit can still show diffs. Paths are literal, and Git hooks, external diff programs, signing, filesystem monitors, and remote transports are disabled for these controls. Repositories requiring external worktrees, executable filters, or included configuration must be managed through the bot's terminal instead.

## Verification

Offline tests execute the real filesystem/Git helper against temporary workspaces, exercise authorization and busy-computer rejection through RPC, and test shared controller races and draft preservation. Browser tests cover create/edit/move/upload/download/delete, shared navigation, Markdown/image/PDF previews, attachment staging, retained drafts, stale-file recovery, and Git review controls. Git UI fixtures are paired with real offline Git command tests. The browser tests attach screenshots to the test report. Native mobile uses the same tested controller; its document-viewer handoff and navigation still need device testing.
