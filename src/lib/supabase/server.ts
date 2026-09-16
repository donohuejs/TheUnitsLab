import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { parsePublicEnvironment } from "@/config/env.public";

export async function createSupabaseServerClient() {
  const environment = parsePublicEnvironment(process.env);
  const cookieStore = await cookies();

  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. The root proxy refreshes
            // sessions and Server Actions can write them directly.
          }
        },
      },
    },
  );
}
