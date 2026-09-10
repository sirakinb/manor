# Shared spaces

A personal space keeps each member's agents and resources private. A team space
uses one account for its agents, groups, conversations, files, memory, tools,
model settings, and connected platforms. All members of its organization join
the team space, including members added later. Other spaces remain separate.

Choose **Team** when creating a space. The sidebar identifies team spaces, and
Integrations displays the active space and its audience. Web and Electron use
the same interface; mobile uses the same API contracts and access checks.

## Identity and access

The authenticated person remains the account shown in Settings and the subject
of organization membership, presence, account preferences, and administration.
Space resource handlers resolve an internal account after checking that person's
membership. Internal accounts cannot sign in and are excluded from the team list.
Each team space has a different internal account, so provider identities and
credentials cannot fall back to a member's personal account.

Messages record the human author's identifier and display name. Runs record the
initiator separately from their execution account. Approval events record the
person answering; persistent approval rules belong to the team account. Chat
subscriptions recheck membership before delivering each event, and notification
recipients come from the current membership list. Existing thread locking and
message idempotency serialize simultaneous sends; retry keys are also separated
by sender in a shared space.

## Existing spaces

The schema migration is additive. Existing spaces retain their previous access
until explicitly converted. The operator helper `shareUnstartedSpace` supports
spaces whose agents have not run and whose external accounts, stored secrets,
and computers have not been configured. It preserves agent and conversation
identifiers and moves their resource ownership in one serializable transaction.
Re-running it returns the same account.

Run conversion while writes to the affected space are stopped, after a verified
backup. The helper refuses spaces with existing execution or provider state;
those need a separate migration that preserves provider account identities,
encrypted credentials, and active work. Do not directly change `accountUserId`
or bulk rewrite owners to bypass that check.

Read/unread and thumbs-up state currently belong to the shared conversation.
Per-member read receipts and reactions are separate enhancements.

## Verification

The offline integration suite tests two authenticated members, simultaneous
messages, author attribution, shared documents and connections, private-space
isolation, revoked membership, future membership, internal account sign-in
denial, and conversion without changing agent or thread identifiers. The web
E2E test opens two browser sessions and captures their common agent,
conversation, and Integrations views.
