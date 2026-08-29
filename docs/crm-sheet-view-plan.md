# CRM Sheet View — implementation plan

Add a spreadsheet-style view (Zoho CRM Sheet View / Airtable feel) as a third way
to render CRM data, alongside the existing list table and kanban board.

## What exists today

- Contracts: `packages/contracts/src/domain.ts` — CrmContact, CrmDeal, CrmPipeline,
  CrmStage, CrmTag schemas (one source of truth; the sheet must not fork these).
- Data layer: `packages/db/src/crm.ts` — searchContacts (cursor-paginated),
  createContact, updateContact, createDeal, updateDeal, moveDeal.
- Web UI: `apps/web/src/pages/crm/CrmContacts.tsx` — hand-built HTML table,
  search + tag filter, right-side drawer for create/edit.
  `CrmPipelineBoard.tsx` — kanban via @dnd-kit. Tokens in
  `packages/ui-tokens` (`--rk-*`) + `apps/web/src/pages/crm/theme.ts`.
- No TanStack Table, no virtualization lib in apps/web today.

## The interactions that sell the "spreadsheet vibe" (from Zoho Sheet View)

1. Full gridlines, dense rows, column headers — a grid, not a list.
2. Click a cell → active-cell outline; Enter or type → inline edit in place.
   No drawer round-trip for a one-field change.
3. Picklist fields (stage, tags) open a dropdown *inside the cell*.
4. Keyboard nav: arrows move the active cell, Tab/Shift+Tab across, Enter
   commits + moves down, Esc cancels.
5. Quick-add: a floating "+ Contact" / trailing blank row appends a record
   without opening a form.

## Approach

**Hand-rolled grid on TanStack Table core + @tanstack/react-virtual.**
Headless, ~small deps, styles entirely with `--rk-*` tokens so it inherits the
brand layer (including per-client hostname theming). Glide Data Grid was
considered (canvas Excel-feel out of the box) but it's a heavy opinionated
surface that fights the token system; the cell-selection model we need is small
enough to own.

## Scope — v1 (contacts only)

1. **View switcher** in the CRM contacts page header: `List | Sheet`
   (kanban stays on the pipeline page). Persist choice in localStorage.
   Both views share the same query state (search, tag filter, cursor).
2. **`CrmContactsSheet` component** (`apps/web/src/pages/crm/`):
   - Columns: name, email, phone, stage/status, tags, created — derived from
     the CrmContact contract, not redeclared.
   - Row virtualization + infinite scroll on the existing cursor pagination
     (searchContacts already pages server-side).
   - Sticky header row + sticky checkbox column; total-count footer.
3. **Cell model**: single active cell (row id + column id) in component state.
   - Text/email/phone cells: inline `<input>` swapped in on edit.
   - Stage: in-cell select fed by CrmStage data.
   - Tags: in-cell popover multi-select fed by CrmTag data.
4. **Edits commit through `updateContact`** — the exact path the drawer uses,
   so backend validation stays the single authority. Optimistic cell update,
   revert + inline error state on rejection.
5. **Quick-add**: trailing blank row; typing a name creates via `createContact`
   and the row becomes real.
6. **Keyboard nav** per the interaction list above, plus Cmd/Ctrl+C copies the
   active cell value.
7. **Drawer stays**: a row-level expand affordance opens the existing
   ContactDrawer for deep edits (deals, full form) — sheet handles the fast
   80%, drawer the rest.

## Explicitly out of v1

- Deals sheet (v2 — same grid primitive pointed at CrmDeal + moveDeal).
- Bulk multi-row edit, fill-handle drag, column reorder, saved column layouts.
- Any new backend endpoints — v1 is UI-only over existing repos/routes.
- Batch-update API (only if optimistic single-cell commits prove too chatty).

## Surfaces

Web first; Electron gets it free (hosts the web UI). Mobile keeps the list —
a spreadsheet grid degrades badly on touch/small screens, which is an explicit,
acceptable per-platform divergence.

## Sequencing

1. Extract the grid primitive + view switcher, render read-only sheet (1 PR).
2. Cell editing + keyboard nav + picklists (1 PR).
3. Quick-add row + polish (empty states, copy, a11y names) (1 PR).
