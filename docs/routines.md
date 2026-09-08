# Routines from chat

Describe a recurring task in the agent's conversation. The agent can create its
name, instructions, and a schedule or webhook trigger. The saved routine appears
in the same Routines editor used for manual setup, on web and Electron. Mobile
chat uses the same backend tools; its routine detail screen shows the trigger.

For a scheduled task, include the cadence and timezone. For an event-driven task,
identify the source, the fields needed, and the work to perform on each submission.
Give exact email wording and an accessible PDF reference when the task includes
sending a fixed message with an attachment. Missing content should be requested,
not invented. Sending still follows the agent's configured action approvals.

## Webhook setup on the virtual computer

1. `schedule_create` with `trigger: "webhook"` saves the routine. It returns its ID
   and an editor link; this step does not connect the external source.
2. `routine_prepare_webhook` prepares that routine in the bot's direct conversation.
   It reuses the encrypted bot key and derives a token limited to this routine.
3. A private temporary JSON file on the virtual computer holds the POST URL,
   authorization header, token URL alternative, and routine instructions. It is
   outside the portable workspace and its Git snapshots. The tool returns its
   location, never the token. Delete the file after transferring its configuration.
4. The agent uses its computer to configure the external sender. `API_URL` must
   identify the deployment's publicly reachable API; a loopback address cannot
   receive events from a hosted form. Account sign-in or consent may require takeover.
5. Verify the source connection and a permitted synthetic submission. Report
   webhook delivery and downstream actions separately; a successful POST does not
   mean an email has been delivered.

The computer handoff requires a virtual computer with a POSIX shell. For a desktop
computer or a conversation pinned to plugins, use the routine editor's webhook
details or switch to a virtual computer for setup.

## Delivery contract

The editor and setup tool use `/api/v1/bots/:botId/routines/:routineId/webhook`.
Only the selected active webhook routine runs. A removed, paused, or non-webhook
routine returns 404 without falling back to a general bot message. The legacy
bot-wide webhook endpoint remains available for existing senders.

POST a JSON object with `Authorization: Bearer <token>`. Senders that cannot set
headers can use `?token=<token>`; keep that URL private. Rotating the bot webhook
key invalidates existing routine setup tokens as well as the old bot key.

Use an `Idempotency-Key` header (or a stable `id` / `event_id` field) per submission.
Retries for the same routine and event reuse the same message and run. Distinct
submissions create independent runs even while the bot is busy, rather than being
added as instructions to its current task. Without a stable ID, deliveries cannot
be deduplicated. A dispatch failure returns 503; retry with the same event ID.

## Google Form to welcome email

For a Google Form, an Apps Script installable form-submit trigger can forward
responses to Manor. See Google's [installable trigger guide](https://developers.google.com/apps-script/guides/triggers/installable).
Use the [FormResponse ID and respondent data](https://developers.google.com/apps-script/reference/forms/form-response)
to identify the submission and recipient, and [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)
to POST the event. A Google Forms API watch instead requires a
[Cloud Pub/Sub integration](https://developers.google.com/workspace/forms/api/guides/push-notifications).

Keep the approved subject, message, and PDF reference in the routine instructions.
Map the form's email field explicitly, verify that the bot can access the PDF and
the intended sending account, and test with a designated recipient. Form fields
are untrusted data and must not replace the routine's instructions or attachment.
Test the installed trigger through a browser submission: Apps Script's programmatic
form submission does not fire that trigger.
