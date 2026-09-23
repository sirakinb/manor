import type { TransactionalEmail, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { CrmIntegrationService } from "./crm-integrations.js";

/** Public, unauthenticated form submissions. Everything under it uses the forms' own CORS list. */
export const PUBLIC_FORM_PREFIX = "/v1/public/";

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const MAX_NOTES_CHARS = 4_000;

type PublicFormRow = {
  id: string;
  organizationId: string;
  slug: string;
  kind: string;
  title: string;
  enabled: boolean;
  crmTag: string;
  allowedOrigins: string[];
  message: string | null;
  notifyEmail: string | null;
  senderName: string | null;
  signature: string | null;
  eventStartsAt: Date | null;
  eventMinutes: number | null;
  eventTimeZone: string | null;
  joinUrl: string | null;
  bookingUrl: string | null;
};

type Message = Pick<TransactionalEmail, "subject" | "text" | "html">;

const EventSubmission = z.object({
  first_name: z.string().trim().min(1).max(120),
  email: z.email().max(320),
});

const ScorecardSubmission = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email().max(320),
  business_type: z.string().trim().max(200).optional(),
  score: z.number().int().min(0).max(36),
  weakest_areas: z.array(z.string().trim().max(160)).max(12).optional(),
  answers: z
    .array(z.object({ question: z.string().trim().max(500), value: z.number().int() }))
    .max(20)
    .optional(),
});

/** `/v1/public/forms/<slug>` and the shorter `/v1/public/<slug>` both name a form by its slug. */
export function slugFromPath(path: string): string | null {
  if (!path.startsWith(PUBLIC_FORM_PREFIX)) return null;
  const slug = path.slice(PUBLIC_FORM_PREFIX.length).replace(/^forms\//, "");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

/** Fixed-window limiter. In memory, so each API process limits on its own. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const at = now();
    if (hits.size > 10_000) {
      for (const [stale, hit] of hits) if (hit.resetAt <= at) hits.delete(stale);
    }
    const hit = hits.get(key);
    if (!hit || hit.resetAt <= at) {
      hits.set(key, { count: 1, resetAt: at + windowMs });
      return true;
    }
    if (hit.count >= limit) return false;
    hit.count += 1;
    return true;
  };
}

/** A browser may submit only from an origin listed on the enabled form it posts to. */
export async function publicFormAllowsOrigin(
  prisma: PrismaClient,
  path: string,
  origin: string,
): Promise<boolean> {
  const slug = slugFromPath(path);
  if (!slug || !origin) return false;
  const form = await prisma.publicForm.findUnique({
    where: { slug },
    select: { enabled: true, allowedOrigins: true },
  });
  return Boolean(form?.enabled && form.allowedOrigins.includes(origin));
}

// ---------------------------------------------------------------------------------------------
// Event forms

/** "Thursday, September 24, 7:00 to 8:00 PM EDT" in the event's own time zone. */
export function describeEventTime(
  startsAt: Date,
  minutes: number | null,
  timeZone: string | null,
): string {
  const zone = timeZone || "UTC";
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(startsAt);
  const time = (date: Date, withZone: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      ...(withZone ? { timeZoneName: "short" } : {}),
    }).format(date);
  if (!minutes) return `${day}, ${time(startsAt, true)}`;
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
  const start = time(startsAt, false).replace(/\s?[AP]M$/, "");
  return `${day}, ${start} to ${time(endsAt, true)}`;
}

/** Google Calendar "add event" link. */
export function calendarUrl(form: PublicFormRow): string | null {
  if (!form.eventStartsAt) return null;
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const endsAt = new Date(form.eventStartsAt.getTime() + (form.eventMinutes ?? 60) * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: form.title,
    dates: `${stamp(form.eventStartsAt)}/${stamp(endsAt)}`,
    ...(form.eventTimeZone ? { ctz: form.eventTimeZone } : {}),
    ...(form.joinUrl ? { location: form.joinUrl, details: `Join: ${form.joinUrl}` } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function eventConfirmation(form: PublicFormRow, firstName: string): Message {
  const when = form.eventStartsAt
    ? describeEventTime(form.eventStartsAt, form.eventMinutes, form.eventTimeZone)
    : null;
  const calendar = calendarUrl(form);
  const signOff = form.signature ? `- ${form.signature}` : null;
  const text = [
    `Hey ${firstName},`,
    "",
    `You're registered for ${form.title}.`,
    ...(form.joinUrl ? [`Here's your link:`, form.joinUrl] : []),
    ...(when ? ["", when] : []),
    ...(form.message ? ["", form.message] : []),
    ...(calendar ? ["", "Add it to your calendar:", calendar] : []),
    ...(signOff ? ["", signOff] : []),
  ].join("\n");
  const html = card([
    `<p>Hey ${escapeHtml(firstName)},</p>`,
    `<p>You're registered for ${escapeHtml(form.title)}.</p>`,
    form.joinUrl ? button(form.joinUrl, joinLabel(form.joinUrl)) : "",
    when ? `<p style="color:#555;font-size:14px">${escapeHtml(when)}</p>` : "",
    form.message ? `<p style="color:#555;font-size:14px">${escapeHtml(form.message)}</p>` : "",
    calendar ? link(calendar, "Add to your calendar") : "",
    signOff ? `<p>${escapeHtml(signOff)}</p>` : "",
  ]);
  return { subject: `You're in: ${form.title}`, text, html };
}

/** "Join on Zoom" / "Join on Google Meet" when the link says which service it is. */
export function joinLabel(joinUrl: string): string {
  const host = new URL(joinUrl).hostname;
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return "Join on Zoom";
  if (host === "meet.google.com") return "Join on Google Meet";
  return "Join";
}

// ---------------------------------------------------------------------------------------------
// Scorecard forms

const SCORE_CHOICES: Record<number, string> = {
  0: "Not handled",
  2: "Partially handled",
  3: "Systematized",
};
export const SCORECARD_MAX = 36;

/** Answers count 0, 2, or 3 points; without answers the submitted score is used. */
export function scoreScorecard(input: z.infer<typeof ScorecardSubmission>) {
  const answers = input.answers ?? [];
  const score = answers.length
    ? Math.min(
        SCORECARD_MAX,
        answers.reduce(
          (sum, answer) => sum + (answer.value in SCORE_CHOICES ? answer.value : 0),
          0,
        ),
      )
    : input.score;
  const band =
    score <= 12
      ? "Foundation first"
      : score <= 24
        ? "Ready to automate one workflow"
        : "Ready for advanced automation";
  const answerLines = answers.map(
    (answer, index) =>
      `${index + 1}. ${SCORE_CHOICES[answer.value] ?? "Unanswered"}: ${answer.question}`,
  );
  return { score, band, answerLines };
}

function scorecardResults(
  form: PublicFormRow,
  firstName: string,
  score: number,
  band: string,
  focus: string[],
): Message {
  const signOff = form.signature ? `- ${form.signature}` : null;
  const text = [
    `Hey ${firstName},`,
    "",
    `Your ${form.title} score is ${score}/${SCORECARD_MAX}.`,
    band,
    ...(focus.length ? ["", "Start here:", ...focus.map((item) => `- ${item}`)] : []),
    ...(form.bookingUrl ? ["", "Book a free discovery call:", form.bookingUrl] : []),
    ...(signOff ? ["", signOff] : []),
  ].join("\n");
  const html = card([
    `<p>Hey ${escapeHtml(firstName)},</p>`,
    `<p>Your ${escapeHtml(form.title)} score is <strong>${score}/${SCORECARD_MAX}</strong>.</p>`,
    `<p>${escapeHtml(band)}</p>`,
    focus.length
      ? `<p>Start here:</p><ul>${focus.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "",
    form.bookingUrl ? button(form.bookingUrl, "Book a free discovery call") : "",
    signOff ? `<p>${escapeHtml(signOff)}</p>` : "",
  ]);
  return { subject: `Your ${form.title} score`, text, html };
}

// ---------------------------------------------------------------------------------------------
// Routes

export function mountPublicFormRoutes(
  app: Hono,
  deps: {
    prisma: PrismaClient;
    service: CrmIntegrationService;
    email?: TransactionalEmailProvider;
  },
) {
  const allow = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);
  const send = async (form: PublicFormRow, to: string, message: Message, label: string) => {
    try {
      await deps.email?.send({ to, fromName: form.senderName ?? undefined, ...message });
    } catch (error) {
      console.error(`Public form ${label} email failed`, error);
    }
  };

  /** Upsert the contact under the form's source and add the form's tag without touching others. */
  const saveContact = async (
    form: PublicFormRow,
    contact: { email: string; firstName: string; lastName?: string; company?: string },
  ) => {
    const result = await deps.service.upsertContact(form.organizationId, {
      source: form.slug,
      external_id: contact.email,
      email: contact.email,
      first_name: contact.firstName,
      ...(contact.lastName ? { last_name: contact.lastName } : {}),
      ...(contact.company ? { company: contact.company } : {}),
    });
    const tag = await deps.prisma.crmTag.upsert({
      where: { organizationId_name: { organizationId: form.organizationId, name: form.crmTag } },
      create: { organizationId: form.organizationId, name: form.crmTag },
      update: {},
    });
    await deps.prisma.crmContactTag.upsert({
      where: { contactId_tagId: { contactId: result.contact.id, tagId: tag.id } },
      create: { contactId: result.contact.id, tagId: tag.id },
      update: {},
    });
    return result.contact;
  };

  const submitEvent = async (c: Context, form: PublicFormRow, body: unknown) => {
    const parsed = EventSubmission.safeParse(body);
    if (!parsed.success) return c.json(error("A first name and email are required"), 400);
    const email = parsed.data.email.toLowerCase();
    const firstName = parsed.data.first_name;
    await saveContact(form, { email, firstName });
    await send(form, email, eventConfirmation(form, firstName), "confirmation");
    if (form.notifyEmail) {
      await send(
        form,
        form.notifyEmail,
        {
          subject: `${form.title} signup: ${firstName}`,
          text: `${firstName} signed up for ${form.title}.\n${email}`,
          html: card([
            `<p><strong>${escapeHtml(firstName)}</strong> signed up for ${escapeHtml(form.title)}.</p>`,
            `<p>${escapeHtml(email)}</p>`,
            `<p>Saved in the CRM, tagged ${escapeHtml(form.crmTag)}.</p>`,
          ]),
        },
        "signup notice",
      );
    }
    return c.json({ received: true });
  };

  const submitScorecard = async (c: Context, form: PublicFormRow, body: unknown) => {
    const parsed = ScorecardSubmission.safeParse(body);
    if (!parsed.success) return c.json(error("A name and email are required"), 400);
    const email = parsed.data.email.toLowerCase();
    const [firstName = parsed.data.name, ...rest] = parsed.data.name.split(/\s+/).filter(Boolean);
    const company = parsed.data.business_type?.trim() || undefined;
    const focus = (parsed.data.weakest_areas ?? []).filter(Boolean);
    const { score, band, answerLines } = scoreScorecard(parsed.data);
    const notes = [
      form.title.toUpperCase(),
      `Score: ${score}/${SCORECARD_MAX}`,
      `Band: ${band}`,
      company ? `Business: ${company}` : null,
      focus.length ? `Start here: ${focus.join(", ")}` : null,
      `Submitted: ${new Date().toISOString()}`,
      ...(answerLines.length ? ["Answers:", ...answerLines] : []),
    ]
      .filter((line) => line !== null)
      .join("\n");
    const contact = await saveContact(form, {
      email,
      firstName,
      lastName: rest.join(" ") || undefined,
      company,
    });
    const previous = contact.notes?.trim();
    await deps.prisma.crmContact.update({
      where: { id: contact.id },
      data: { notes: (previous ? `${notes}\n\n${previous}` : notes).slice(0, MAX_NOTES_CHARS) },
    });
    await send(form, email, scorecardResults(form, firstName, score, band, focus), "results");
    if (form.notifyEmail) {
      await send(
        form,
        form.notifyEmail,
        {
          subject: `${form.title}: ${firstName} scored ${score}/${SCORECARD_MAX}`,
          text: `${parsed.data.name} completed ${form.title}.\n${email}\n\n${notes}`,
          html: card([
            `<p><strong>${escapeHtml(parsed.data.name)}</strong> completed ${escapeHtml(form.title)}.</p>`,
            `<p>${escapeHtml(email)}</p>`,
            `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(notes)}</pre>`,
          ]),
        },
        "results notice",
      );
    }
    return c.json({ received: true });
  };

  const submit = async (c: Context) => {
    const slug = slugFromPath(c.req.path);
    const form = slug
      ? ((await deps.prisma.publicForm.findUnique({ where: { slug } })) as PublicFormRow | null)
      : null;
    if (!form?.enabled) return c.json(error("Form not found"), 404);
    const ip = (c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown")
      .split(",")[0]!
      .trim();
    if (!allow(`${form.slug}:${ip}`)) return c.json(error("Too many submissions"), 429);
    const body = await c.req.json().catch(() => null);
    try {
      return form.kind === "scorecard"
        ? await submitScorecard(c, form, body)
        : await submitEvent(c, form, body);
    } catch (cause) {
      console.error("Public form submission failed", cause);
      return c.json(error("Could not save your submission"), 400);
    }
  };

  app.post(`${PUBLIC_FORM_PREFIX}forms/:slug`, submit);
  app.post(`${PUBLIC_FORM_PREFIX}:slug`, submit);
}

function error(message: string) {
  return { error: { message } };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

function card(parts: string[]): string {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:480px">${parts.join("")}</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#9333ea;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>`;
}

function link(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="color:#9333ea;font-weight:600">${escapeHtml(label)}</a></p>`;
}
