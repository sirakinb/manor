# Run diagnostics

Open **Run logs** in a bot's chat toolbar or computer panel. A failed run's banner
also offers **View logs**. Web and Electron share this panel; mobile opens a
dedicated Run logs screen from the thread.

The view lists the latest 20 runs for the selected bot and current member, including
routine tests. Select a run to see its status, model, timestamps, attempts and
chronological events. Open views refresh every five seconds; earlier events load
in pages of 100. Diagnostics remain available after the transient error banner is
dismissed, for as long as the underlying run and event records are retained.

Tool calls record start and finish events, duration and completed/failed/paused
status. Completion means the tool returned; it does not verify the external
business outcome. Failed runs store a categorical stage and error classification
in their existing terminal event. The worker also emits one structured failure
log with the run and attempt IDs and the same classification. No migration is
needed. Older runs can show an unknown stage, and lack tool completion events;
the service cannot reconstruct diagnostics it never recorded.

`runs.history` and `runs.diagnostics` enforce the current user's space and ownership
on every request. They select metadata, not task prompts, checkpoint state,
credentials, tool arguments, outputs, or arbitrary event payloads. Error summaries
use fixed text and allowlisted network codes. Copy/share exports only the loaded
diagnostic pages. Detailed service logs remain an operator concern; these endpoints
do not provide host access or automatic repair privileges.

Computer panels can be resized from their leading edge with a pointer or the
arrow keys; Home/End choose the minimum/maximum and double-click restores the
default. Width persists on the device and is constrained to leave chat room.
Smaller windows use a full-width overlay. **Expand computer** opens the existing
full-window computer viewer. The computer's running state is independent of the
agent run's status.

Offline tests cover ownership, metadata filtering, pagination and selection races.
The browser harness exercises a real failing scripted routine, diagnostic reload,
resizing and mobile web layouts with screenshots. Native mobile's screen and share
sheet still require device verification.
