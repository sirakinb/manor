# Manor product priorities

Manor is an AI agent platform for service businesses: a home for business data,
customer records, and a team of agents. This roadmap describes intended work,
not a list of finished capabilities. The maintainer sets the direction; forks can
adapt it to their own businesses.

## 1. Agent workspace

Make the workspace a configurable home for a company's relevant data, connected
tools, and operations. A business should be able to shape its own workspace from
a blank canvas instead of adopting another company's structure.

- Bring data from connected business tools into useful operational views.
- Let people and agents work from the same business context.
- Make sections and workflows adaptable to the business. For property management,
  examples include leases, utilities, and email campaigns.
- Show whether connected data is current and whether recurring processes ran.

The current workspace has specific operational sections. Generalizing its setup
and configuration is part of this priority. See [workspace implementation](docs/workspace.md).

## 2. CRM as the system of record

Keep customer relationships and their next steps in Manor, connected to the work
agents do for the business.

- Connect websites and lead forms to contact intake.
- Use agent routines to organize incoming information and update customer records.
- Build follow-up sequences around contacts and deals.
- Track lead progress and conversion results alongside business operations.

See [CRM documentation](docs/CRM.md) for the existing foundation. Intake connections
and sequences should be verified individually rather than assumed to be complete.

## 3. Reliable business agents

Make it straightforward to create an agent with a useful business role, then expand
the team as the business needs it. Example roles include intake, content, and payments.

- Reduce the steps between creating an agent and completing its first useful task.
- Improve consistency for scheduled routines and webhook-triggered work.
- Make responsibilities, approval boundaries, outcomes, and failures clear.
- Keep models and integrations optional and interchangeable through shared contracts.

## First-run experience

The intended path is to clone Manor, run a guided VPS setup command, and create
one agent that removes a specific source of friction in the business. That guided
source-checkout command is planned. Today, use the [VPS deployment guide](docs/DEPLOY.md)
or the separate [published-image setup](docs/self-host.md#published-images-no-checkout).

## Dropped directions

- **Maintenance agent:** stop pursuing an agent that changes and updates Manor itself.
  The complexity does not serve the current product priorities.
- **Coding CLIs inside VMs for SSH-based development:** stop pursuing this as a Manor
  product workflow for tools such as Codex, Cursor, or Claude Code. This does not
  remove ordinary SSH access used to administer a self-hosted server.

Related code and documentation may still be present. Removing them is a separate
implementation task; this roadmap change does not disable existing installations.

## Supporting backlog

These earlier ideas remain unprioritized and need a current implementation check
before work starts:

- Improve agent activity visibility and friendly tool names.
- Improve attachments, empty states, settings, and integration-logo loading.
- Avoid duplicate work across connected integrations and the agent computer.
- Filter generated filesystem artifacts from sandbox file listings.
- Evaluate integration-tool discovery improvements when they reduce setup friction.

The current logo and sprite set are the approved baseline. Expanding or redesigning
them is not a current priority; forks can use their own branding.
