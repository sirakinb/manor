# Workspace layout and report workflow refinement

Keep the dark Manor shell and existing typography. Use restrained teal accents,
neutral surfaces, readable text, compact rows, and content-driven heights. No
Hallmark. Beautiful UI's existing primitives and the original workspace's
report/utilities workflows inform the implementation. Mobbin's cloud MCP is
connected. Reviewed references include Buffer's compact metric strip
(https://mobbin.com/screens/79315ae7-1468-487a-ac2f-6691b937f3d2) and Railway's
quiet billing hierarchy (https://mobbin.com/screens/ba45644f-9b71-40cf-a958-a307056b53b1).

- AI team: compact bot roster above a full-width platform sync list. Distinguish
  report jobs from data refreshes and link reporting controls to Reports.
- Utilities: searchable, filtered bill queue with expandable charge details;
  property mappings in a separate view. Avoid a long wall of nested cards.
- Social: reach and follower changes in a balanced, compact chart row, followed
  by posts at their natural height. Preserve missing data instead of inventing it.
- Reports: voice/email generation by date range and audience; monthly and weekly
  draft previews; recipients and reviewer addresses beside report schedules.
  Preview/generation never sends mail. A separate test-email action sends only to
  the explicitly entered test recipient and never changes approval/delivery state.
- Preserve server authorization and existing send/post confirmations. Generation
  runs through the background worker and optional ingestion/narrative adapter.
  Add weekly email report generation without silently activating a new schedule.
- Verify synthetic database boundaries and queue failure/replay behavior, report
  pipeline tests, and browser flows/screenshots for all four screens. Deploy after
  verification and a database backup; keep the old system cutover separate.
