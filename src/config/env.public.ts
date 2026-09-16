import { z } from "zod";

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export function parsePublicEnvironment(environment: Record<string, string | undefined>) {
  return publicEnvironmentSchema.parse(environment);
}

export function hasPublicEnvironment(environment: Record<string, string | undefined>) {
  return publicEnvironmentSchema.safeParse(environment).success;
}
