import * as z from "zod";
import { Id } from "./ids.js";

export const BOT_CREDENTIAL_LABEL_MAX_LENGTH = 80;
export const BOT_CREDENTIAL_FIELD_MAX_LENGTH = 500;
export const BOT_CREDENTIAL_NOTES_MAX_LENGTH = 2000;

/** A stored website login a bot may use on its computer. Secrets are never returned. */
export const BotCredentialSchema = z.object({
  id: Id,
  botId: Id,
  label: z.string(),
  site: z.string(),
  username: z.string(),
  notes: z.string(),
  hasPassword: z.boolean(),
  hasTotp: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BotCredential = z.infer<typeof BotCredentialSchema>;

export const CreateBotCredentialInput = z.object({
  botId: Id,
  label: z.string().trim().min(1).max(BOT_CREDENTIAL_LABEL_MAX_LENGTH),
  site: z.string().trim().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).default(""),
  username: z.string().trim().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).default(""),
  password: z.string().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).default(""),
  /** Base32 seed or otpauth:// URI from the site's authenticator setup. */
  totpSecret: z.string().trim().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).default(""),
  notes: z.string().max(BOT_CREDENTIAL_NOTES_MAX_LENGTH).default(""),
});
export type CreateBotCredentialInput = z.infer<typeof CreateBotCredentialInput>;

/** Omitted secret fields keep their stored value; an empty string clears them. */
export const UpdateBotCredentialInput = z.object({
  credentialId: Id,
  label: z.string().trim().min(1).max(BOT_CREDENTIAL_LABEL_MAX_LENGTH).optional(),
  site: z.string().trim().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).optional(),
  username: z.string().trim().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).optional(),
  password: z.string().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).optional(),
  totpSecret: z.string().trim().max(BOT_CREDENTIAL_FIELD_MAX_LENGTH).optional(),
  notes: z.string().max(BOT_CREDENTIAL_NOTES_MAX_LENGTH).optional(),
});
export type UpdateBotCredentialInput = z.infer<typeof UpdateBotCredentialInput>;
