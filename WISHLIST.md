# Manor Wishlist

Parked ideas and follow-ups. Roughly ordered by value within each section.

## Transparency / activity feed

- **Thinking-token streaming** (parked 2026-08-21, plan agreed):
  Pi already emits `thinking_delta` / `thinking_end`; our adapter drops them.
  1. `packages/adapters/src/pi-runtime.ts` (~L108): handle `thinking_delta` in `agent.subscribe`, push `{ type: "thinking", text }`
  2. `adapter-kit`: add `"thinking"` to the runtime event union
  3. `packages/adapters/src/executor.ts`: batch deltas (reuse the 250ms `pendingProgress` flush pattern, ~L745) → append as `thread.progress` with a `thinking: true` payload flag (inherits `clearRunProgress` cleanup; nothing persists to history)
  4. `apps/web` Activity card: rolling collapsible "thinking" block (muted italic, last ~300 chars) interleaved with tool lines; same header toggle
  - Caveat: providers only emit thinking when enabled (`thinkingBudgets` in pi-ai); degrades gracefully per model
- Persist activity per run so finished runs can be inspected (currently live-only, cleared on bot switch)
- Friendly display names for tools (`computer_act` → "Computer", `gmail_send_email` → "Gmail")

## Brand / UI

- Grow the sprite family past 7 (or add a variation badge) so 8+ bots don't twin; regen pipeline was in `/tmp/manor-sprites` (gen_gemini.py + postprocess.py — wiped on reboot, recreate if needed; re-run all sprites together so scale normalization holds)
- `// empty` mono placeholders for empty states (empty column style from Aligno) — empty thread, no routines, no plugins connected
- Door-swing arc from the logo as a loading spinner
- Option to mask the scanline ridge overlay off the live computer pane
- Deeper purple-tint sweep of Shell's remaining hardcoded neutral grays
- Lazy-load / proxy plugin catalog logos (console 404 noise, broken logo hosts)

## Product

- Attachments v2: multi-file, drag-and-drop onto the thread, image preview blocks in chat (needs a MessageBlock type extension)
- Code-level guard against plugin/computer double-work (suppress browser navigation to apps with a connected plugin) if the prompt-level fix regresses
- Post-onboarding settings surface: consolidate AI model switcher, plugins, usage into a real settings page

## Infrastructure

- Filter `._*` AppleDouble files in sandbox `listFiles` (exFAT artifact; breaks `sandbox-conformance.test.ts` and pollutes agent file listings) — or move dev off exFAT entirely
- Composio meta-tools mode: consider making it the default (vs direct_tools fallback) once model behavior with search+execute is validated
- Docker-on-sparse-image fragility: superseded by cloud deployment (see task #3); if local dev continues long-term, reformat SSD to APFS
