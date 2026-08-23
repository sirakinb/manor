# CRM: pipeline, contacts, and a home for the numbers

Manor is the agent platform for service businesses, and a service business
runs on three questions: who do we know, what work is moving, and how is the
month going. AlignoCRM (the standalone Next.js/InsForge app) answers them
with contacts, a kanban pipeline, and a dashboard. This brings those three
surfaces into Manor itself — native tables, native API, Manor's dark language
— so the CRM lives where the bots live.

## Design reference

The modern canon: **Attio** for CRM structure (a pipeline is just a list in
kanban clothing; data-dense 13px tables; record drawer with everything about
one person), **Linear** for dark-first restraint, **Pipedrive** for the
original kanban mental model. Manor already speaks Linear's language —
near-black `#0D0D0E`, `#131315` cards, `#202023` borders, violet `#A855F7` —
so the CRM is Attio's bones wearing Manor's skin. Stage colors use a violet
scale (the brand accent stepped through lightness) instead of Aligno's
light-theme purples.

## What ships (v1)

Three surfaces behind one sidebar entry — **CRM**, above Plugins:

1. **Home** — KPI cards (total pipeline, won revenue, open deals, avg deal
   size), value-by-stage bars, value-distribution donut, deal-status ring,
   recent deals; filterable by pipeline. Charts are dependency-free inline
   SVG, ported from Aligno and re-skinned.
2. **Pipeline** — kanban board, drag deals between stages (@dnd-kit/core, the
   same proven wiring as Aligno), multiple pipelines with custom stages,
   create/edit/delete deals, deal cards show value + contact + stage color.
   First visit seeds a default "Sales" pipeline so the board is never empty.
3. **Contacts** — searchable table (name, company, email, phone, tags,
   status), create/edit in a drawer, tags with inline creation, archive and
   delete, bulk select.

Routing: `/app/crm` renders inside the Shell (sidebar stays), a static route
registered above `/app/:botId` so it never collides with a bot id. Internal
nav is a segmented Home / Pipeline / Contacts control, top-left of the pane.

## Data model (additive, `Crm` prefix)

Manor already has `Task`, so every model is prefixed and mapped to
`crm_*` tables. All rows carry `workspaceId`; every query goes through
workspace-scoped repos (same BOLA discipline as rooms).

- `CrmContact` — firstName, lastName, email?, phone?, company?, notes?,
  status(active|archived)
- `CrmTag` — name, color; `CrmContactTag` — join (contactId, tagId)
- `CrmPipeline` — name, position
- `CrmStage` — pipelineId, name, position, color
- `CrmDeal` — pipelineId, stageId, contactId?, title, value (whole dollars,
  Int), status(open|won|lost)

Deliberately not in v1: tasks, activity log, testimonials, apps, owners
(Manor workspaces are effectively single-owner today; owner columns can be
added when teams need them).

## API (oRPC `crm.*`)

- `crm.overview` — one call: pipelines, stages, deals, contact count (the
  dashboard composes client-side, like Aligno, but without its N+1 fetches)
- `crm.contacts.list / create / update / delete` (+ tags included on list)
- `crm.tags.create / assign / unassign`
- `crm.pipelines.list / create` (stages created with the pipeline),
  `crm.pipelines.seed` (idempotent default)
- `crm.deals.create / update / move / delete`

## Phase 2 (explicitly not now)

Bots as CRM operators: `crm_search`, `crm_create_contact`, `crm_move_deal`
connector tools so "Scout, log everyone who replied this week as Qualified"
just works. This is the reason the CRM is *in* Manor rather than beside it —
the schema above is shaped so those tools bolt on without migration.

## Risks

- Shell.tsx is already large; the CRM pane is its own component tree
  (`apps/web/src/pages/crm/`) touching Shell only at the sidebar entry and
  pane switch.
- Drag-and-drop is the one new dependency (@dnd-kit/core). Everything else
  is hand-rolled SVG and existing stack.
