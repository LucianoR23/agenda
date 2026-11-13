import { z } from "zod";

/** `"true"` / `"false"` (also 1/0, yes/no) → boolean. Absent → `fallback`. */
const flag = (fallback: boolean) => z.stringbool().default(fallback);

/** Comma-separated list of origins → array of URLs (empty string → []). */
const origins = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })));

/** 32 random bytes as base64 (`openssl rand -base64 32`). */
const key32 = z.string().refine((s) => Buffer.from(s, "base64").length === 32, "must be 32 bytes, base64 (openssl rand -base64 32)");

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    APP_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
    /** Process timezone. The user's timezone is a setting in the database (`app_user.timezone`). */
    TZ: z.string().default("America/Buenos_Aires"),
    SESSION_SECRET: z.string().min(32, "must be at least 32 characters (openssl rand -base64 32)"),
    SETUP_CODE: z.string().min(8, "must be at least 8 characters"),
    WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),

    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:)/, "must start with mailto: or https:")
      .optional(),

    /** Encrypts Google refresh tokens and iCal URLs at rest (phase 6). */
    ENCRYPTION_KEY: key32.optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    /** Browser origins allowed to call the token API (Sunday). */
    CORS_ALLOWED_ORIGINS: origins,
    /** Behind Cloudflare: trust `CF-Connecting-IP` for the client IP. */
    TRUST_CF: flag(false),

    PIN_REAUTH_DAYS: z.coerce.number().int().min(1).default(7),
    DEVICE_TRUST_DAYS: z.coerce.number().int().min(1).default(90),
    /** Argon2id memory cost; lowered only in tests. */
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19_456),

    APP_VERSION: z.string().default("dev"),
    DISABLE_WORKER: flag(false),
    SKIP_MIGRATIONS: flag(false),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((e, ctx) => {
    const vapid = [e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT].filter(Boolean).length;
    if (vapid !== 0 && vapid !== 3)
      ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "set all three VAPID_* variables or none" });
    if (!!e.GOOGLE_CLIENT_ID !== !!e.GOOGLE_CLIENT_SECRET)
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message: "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET or neither",
      });
    if (e.GOOGLE_CLIENT_ID && !e.ENCRYPTION_KEY)
      ctx.addIssue({ code: "custom", path: ["ENCRYPTION_KEY"], message: "required when Google Calendar is configured" });
    if (e.NODE_ENV === "production" && !e.APP_ORIGIN.startsWith("https://"))
      ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "must be https in production" });
  });

export type AppEnv = z.infer<typeof Env>;

/**
 * Validates an environment. The error lists the variable names and what is wrong with them, never their values
 * (Zod's messages don't echo the input).
 */
export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  // `KEY=` in a .env file means "not set"
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = Env.safeParse(present);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

let cached: AppEnv | null = null;

/** Validated environment, parsed once. Boot calls it from instrumentation so a bad config fails fast. */
export function env(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Tests only: re-read process.env on next access. */
export function resetEnv() {
  cached = null;
}
