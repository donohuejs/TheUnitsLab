import { z } from "zod";

export const serverEnvironmentSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  THE_ODDS_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.union([z.string().min(1), z.literal("")]).optional(),
  ODDS_API_MONTHLY_ALLOWANCE: z.coerce.number().int().positive().default(500),
  APP_ADMIN_USER_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  CRON_SECRET: z.string().min(16).optional(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
