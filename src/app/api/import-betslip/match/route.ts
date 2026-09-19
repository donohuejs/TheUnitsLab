import { NextResponse } from "next/server";
import { z } from "zod";

import { discoverImportedCanonicalEvent } from "@/lib/betslip/canonical-event-discovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  eventDescription: z.string().trim().min(3).max(240),
  eventDate: z.string().datetime().optional(),
  sportKey: z.string().trim().max(80).optional(),
  competitionKey: z.string().trim().max(80).optional(),
});

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid event matching request" }, { status: 400 });
  try {
    return NextResponse.json(await discoverImportedCanonicalEvent(parsed.data));
  } catch {
    return NextResponse.json({
      state: "unmatched",
      candidates: [],
      reason: "Canonical event discovery is temporarily unavailable; review this wager manually.",
    });
  }
}
