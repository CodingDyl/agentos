import { z } from "zod";
import type { RebuildFunction } from "./website-rebuild-types";

/**
 * What a rebuild's features need to work for real: the provider settings the
 * site reads from its environment, and the old addresses that must keep
 * working. Collected before the functions stage, so features are built
 * against known names instead of guesses, and pushed to the Vercel preview.
 *
 * Secret values never leave the server: the view says only whether one is set.
 */

export const FEATURE_SETTING_KEYS = ["RESEND_API_KEY", "CONTACT_FROM_EMAIL", "CONTACT_TO_EMAIL", "BOOKING_URL", "BOOKING_PROVIDER", "CALCOM_API_KEY", "NEWSLETTER_PROVIDER", "NEWSLETTER_API_KEY", "NEWSLETTER_LIST_ID", "SHOP_PROVIDER", "SHOP_API_KEY"] as const;
export const FeatureSettingKeySchema = z.enum(FEATURE_SETTING_KEYS);
export type FeatureSettingKey = z.infer<typeof FeatureSettingKeySchema>;

export interface FeatureSettingDefinition {
  key: FeatureSettingKey;
  label: string;
  hint: string;
  secret: boolean;
  type: "text" | "email" | "url" | "password";
  feature: RebuildFunction;
}

export const FEATURE_SETTINGS: readonly FeatureSettingDefinition[] = [
  { key: "RESEND_API_KEY", label: "Resend API key", hint: "From the client's (or your) Resend account. Stored sealed on this machine, sent only to Vercel.", secret: true, type: "password", feature: "contact_form" },
  { key: "CONTACT_FROM_EMAIL", label: "Send enquiries from", hint: "An address on a domain verified in Resend.", secret: false, type: "email", feature: "contact_form" },
  { key: "CONTACT_TO_EMAIL", label: "Deliver enquiries to", hint: "The mailbox the client reads.", secret: false, type: "email", feature: "contact_form" },
  { key: "BOOKING_URL", label: "Booking page", hint: "The client's public scheduler page, e.g. Calendly.", secret: false, type: "url", feature: "booking" },
  { key: "BOOKING_PROVIDER", label: "Booking provider", hint: "Leave empty to use the booking page above, or write calcom to book through the Cal.com API.", secret: false, type: "text", feature: "booking" },
  { key: "CALCOM_API_KEY", label: "Cal.com API key", hint: "Only with the calcom provider. Stored sealed on this machine, sent only to Vercel.", secret: true, type: "password", feature: "booking" },
  { key: "NEWSLETTER_PROVIDER", label: "Newsletter provider", hint: "mailchimp, brevo or buttondown.", secret: false, type: "text", feature: "newsletter" },
  { key: "NEWSLETTER_API_KEY", label: "Newsletter API key", hint: "Stored sealed on this machine, sent only to Vercel.", secret: true, type: "password", feature: "newsletter" },
  { key: "NEWSLETTER_LIST_ID", label: "Newsletter list or audience ID", hint: "The list new subscribers join.", secret: false, type: "text", feature: "newsletter" },
  { key: "SHOP_PROVIDER", label: "Shop provider", hint: "shopify, yoco or payfast.", secret: false, type: "text", feature: "ecommerce" },
  { key: "SHOP_API_KEY", label: "Shop API key", hint: "Stored sealed on this machine, sent only to Vercel.", secret: true, type: "password", feature: "ecommerce" },
];

export const settingsFor = (functions: readonly RebuildFunction[]) => FEATURE_SETTINGS.filter((setting) => functions.includes(setting.feature));

const Path = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/[^\s?#]*$/, "Old addresses are paths that start with /, like /articles/notice.");

/** What the person sends. A secret left out is kept; an empty one is cleared. */
export const FeatureSettingsInputSchema = z
  .object({
    values: z
      .object({
        CONTACT_FROM_EMAIL: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
        CONTACT_TO_EMAIL: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
        BOOKING_URL: z.union([z.literal(""), z.string().trim().url().max(500).regex(/^https:\/\//, "The booking page must start with https://")]).optional(),
        BOOKING_PROVIDER: z.union([z.literal(""), z.literal("calcom")]).optional(),
        NEWSLETTER_PROVIDER: z.string().trim().max(40).optional(),
        NEWSLETTER_LIST_ID: z.string().trim().max(200).optional(),
        SHOP_PROVIDER: z.string().trim().max(40).optional(),
      })
      .strict()
      .default({}),
    secrets: z
      .object({
        RESEND_API_KEY: z.string().trim().max(400).optional(),
        CALCOM_API_KEY: z.string().trim().max(400).optional(),
        NEWSLETTER_API_KEY: z.string().trim().max(400).optional(),
        SHOP_API_KEY: z.string().trim().max(400).optional(),
      })
      .strict()
      .default({}),
    legacyUrls: z.array(Path).max(100).default([]),
  })
  .strict();
export type FeatureSettingsInput = z.input<typeof FeatureSettingsInputSchema>;

/** What the page sees: plain values, and only whether each secret is set. */
export const FeatureSettingsViewSchema = z.object({
  values: z.partialRecord(FeatureSettingKeySchema, z.string()),
  secretsSet: z.partialRecord(FeatureSettingKeySchema, z.boolean()),
  legacyUrls: z.array(z.string()),
  updatedAt: z.string().optional(),
});
export type FeatureSettingsView = z.infer<typeof FeatureSettingsViewSchema>;
