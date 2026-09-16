import "server-only";

import { createClient } from "@supabase/supabase-js";

import { parsePublicEnvironment } from "@/config/env.public";
import { readServerEnvironment } from "@/config/env.server";

export function createSupabaseAdminClient() {
  const publicEnvironment = parsePublicEnvironment(process.env);
  const serverEnvironment = readServerEnvironment(process.env);
  return createClient(
    publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    serverEnvironment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
