import * as z from "zod";
import { Id } from "./ids.js";

const HttpsUrl = z.url({ protocol: /^https$/ });

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Public URL key: lowercase letters, numbers, and single dashes. Doubles as the CRM source. */
export const PublicFormSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .min(2)
  .max(60);

/** Editable settings of an organization's public signup or scorecard form. */
export const PublicFormInputSchema = z.object({
  slug: PublicFormSlug,
  kind: z.enum(["event", "scorecard"]),
  title: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  crmTag: z.string().trim().min(1).max(60),
  /** Website origins allowed to submit from a browser, e.g. https://example.com */
  allowedOrigins: z
    .array(z.url({ protocol: /^https$/ }).transform((value) => new URL(value).origin))
    .max(10),
  /** Optional paragraph added to the confirmation email. */
  message: z.string().trim().max(1000).nullable(),
  notifyEmail: z.email().max(320).nullable(),
  senderName: z.string().trim().max(80).nullable(),
  signature: z.string().trim().max(80).nullable(),
  eventStartsAt: z.iso.datetime({ offset: true }).nullable(),
  eventMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .nullable(),
  eventTimeZone: z.string().max(64).refine(isTimeZone, "Unknown time zone").nullable(),
  joinUrl: HttpsUrl.nullable(),
  bookingUrl: HttpsUrl.nullable(),
});
export type PublicFormInput = z.infer<typeof PublicFormInputSchema>;

export const PublicFormSchema = PublicFormInputSchema.extend({
  id: Id,
  updatedAt: z.string(),
});
export type PublicForm = z.infer<typeof PublicFormSchema>;
