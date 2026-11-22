# Routines

A routine is a prompt a bot runs on its own: on a schedule, when something changes, or when another
service calls it.

## Ask for one in chat

The quickest way is to ask:

- "Every weekday at 8am, summarize my inbox."
- "Remind me in 20 minutes to call Dana."
- "Every Monday, check our competitors' pricing pages and tell me what changed."

The bot creates the routine and reports each run back in the same chat. The saved routine appears
in the same Routines editor used for manual setup, on web and desktop; mobile shows its trigger.

For a scheduled task, include the cadence and timezone. For an event-driven task,
identify the source, the fields needed, and the work to perform on each submission.
Give exact email wording and an accessible PDF reference when the task includes
sending a fixed message with an attachment. Missing content should be requested,
not invented. Sending still follows the agent's configured action approvals.

## Create or edit one yourself

On web or desktop, click the bot's name at the top of its chat to open the bot panel. In
**Routines**, choose **New routine** if the list is empty, or **+** (labeled **Create routine**) if
it already has routines. To edit a routine, select it from the list.

1. **Name** the routine and write the **Instruction**: what it should do each time it runs.
2. Under **When to run**, choose **Add trigger**.
3. Choose **Save**.

Under **Advanced** you can give a routine its own **Model** and **Thinking** level, for example a
cheaper model for a simple daily check.

## Triggers

### On a schedule

Every hour, every day, weekdays, every week, every month, or a custom interval. **Advanced...**
accepts a cron expression. Times use your timezone, set in **Settings → General**.

### When something changes

The bot checks something at a set interval (**Check every**, from 5 minutes to a day) and runs only
when it changed. **What to watch** can be files or folders on the computer, a command's output, or a
tool from a connected app. A tool's arguments can hold a date that moves with the calendar: ask the
bot to watch, say, what is due before `{{today+2d}}`. Turn on **Post "No changes" in chat** if you want a note every time. A
watch can't be combined with a schedule.

### Webhook

Gives you a URL and key. Any service that can send a POST request can start the routine.

### Git event

Gives you a URL to add as a GitHub webhook, so pushes, issues and pull requests can start the
routine.

### Email

Runs when mail arrives at the bot's own address, such as `scout@bots.example.com`. The first
time, pick the part before the @; it stays the bot's for good. Forward or CC mail to it, by hand
or with a mailbox rule, and the routine runs with that email. A rule has to forward, not redirect:
redirected mail keeps its original sender and recipients, so it never names the bot. Choose who can start it: **Only me**, or **Anyone at** your own
email domain. Mail from anyone else, and mail sent BCC, starts nothing, but the bot keeps every
email in its inbox either way. If mail from your own address can't be verified, the chat says so;
your email provider then needs DKIM signing turned on for your domain. Appears only when your
server [receives email](./self-host-inbound-email.md).

### Slack message

Runs when the bot receives a message in Slack. Needs [Slack connected](./messaging-apps.md).

> [!NOTE]
> A routine run started by a webhook, an email or a Slack message follows your
> [approval](./approvals.md) mode and Always allow list. Since outside text could steer it, tools
> that change something are checked even if they never ask in your own chats. Nobody may be
> watching, so an approval card it posts expires after 30 minutes by default and the action isn't done.
> `UNATTENDED_APPROVAL_EXPIRE_AFTER_MS` changes that window. Always allow on a
> tool such as shell or the browser lets outside text use it freely.

## Test, pause and review

- **Test run** runs a saved routine now.
- Turn off **Active** to pause a routine without deleting it.
- **Run history** shows each past run and its result.
- A running routine shows **Running** in the list, with **Stop**.

## On mobile

The mobile app lists a bot's routines from its profile. Tap **+** to create one. Tapping a routine
shows its instruction, schedule, next run and run history, with a switch to pause it and a button to
test it; **Edit routine** changes its name, instruction and schedules, or deletes it. Webhook, Git event, Slack
message and change triggers, and a routine's own model, are set up in chat or the web or desktop
app; mobile shows them and keeps them as they are.

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
