import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16),
  SETUP_CODE: z.string().min(1),
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  PIN_REAUTH_DAYS: z.coerce.number().int().min(1).default(7),
  DEVICE_TRUST_DAYS: z.coerce.number().int().min(1).default(90),
  APP_VERSION: z.string().default("dev"),
});

export type AppEnv = z.infer<typeof Env>;

let cached: AppEnv | null = null;

/** Validated environment. Parsed lazily so build steps that never touch the server don't need secrets. */
export function env(): AppEnv {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success)
      throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    cached = parsed.data;
  }
  return cached;
}

/** Tests only: re-read process.env on next access. */
export function resetEnv() {
  cached = null;
}
