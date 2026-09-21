import type { SupabaseClient } from "@supabase/supabase-js";

import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function ensureInitialBankroll(supabase: SupabaseClient) {
  const { error } = await supabase.rpc("ensure_initial_bankroll");
  if (error) {
    throw new Error("Authenticated application initialization failed.");
  }
}

export async function bootstrapAuthenticatedApplication() {
  if (!hasPublicEnvironment(process.env)) return;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return;

  await ensureInitialBankroll(supabase);
}
