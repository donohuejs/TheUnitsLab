import "server-only";

import { serverEnvironmentSchema } from "@/config/env.schema";

export function isAdministrator(
  userId: string,
  environment: Record<string, string | undefined> = process.env,
) {
  const parsed = serverEnvironmentSchema.safeParse(environment);
  return parsed.success && parsed.data.APP_ADMIN_USER_IDS.includes(userId);
}
