import "server-only";

import { serverEnvironmentSchema, type ServerEnvironment } from "./env.schema";

/** Validate server-only settings at the boundary that first needs privileged access. */
export function readServerEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(environment);
}
