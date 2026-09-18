import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const outcomes = new Set(["sufficient", "low_confidence", "incomplete", "ambiguous", "error"]);

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) return NextResponse.json({ recorded: false }, { status: 401 });
  let body: { outcome?: unknown; fallbackRequested?: unknown };
  try {
    body = (await request.json()) as { outcome?: unknown; fallbackRequested?: unknown };
  } catch {
    return NextResponse.json({ recorded: false }, { status: 400 });
  }
  if (
    typeof body.outcome !== "string" ||
    !outcomes.has(body.outcome) ||
    typeof body.fallbackRequested !== "boolean"
  ) {
    return NextResponse.json({ recorded: false }, { status: 400 });
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("record_vision_ocr_attempt", {
      p_user_id: data.user.id,
      p_local_ocr_outcome: body.outcome,
      p_fallback_requested: body.fallbackRequested,
    });
    if (error) return NextResponse.json({ recorded: false }, { status: 503 });
  } catch {
    return NextResponse.json({ recorded: false }, { status: 503 });
  }
  return NextResponse.json({ recorded: true });
}
