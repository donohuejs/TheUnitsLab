import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { extractBetslipWithVision, VisionMalformedResponseError } from "@/lib/betslip/vision";
import { visionDraftToBetslipDraft } from "@/lib/betslip/extraction";
import { VISION_MODEL, VISION_RESERVATION_USD } from "@/lib/betslip/vision-accounting";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function fallback(message: string, status = 200) {
  return NextResponse.json({ status: "unavailable", fallback: true, message }, { status });
}

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: authData } = await auth.auth.getUser();
  if (!authData.user) return fallback("Sign in to use assisted extraction.", 401);

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return fallback(
      "Automatic extraction is unavailable right now. We kept your screenshot and filled in what we could.",
    );
  }

  const formData = await request.formData();
  const image = formData.get("screenshot");
  const localOcrOutcome = String(formData.get("localOcrOutcome") ?? "insufficient").slice(0, 120);
  if (!(image instanceof Blob) || image.size <= 0 || image.size > MAX_SCREENSHOT_BYTES) {
    return fallback(
      "We kept your screenshot, but it could not be sent for assisted extraction.",
      400,
    );
  }
  if (!allowedTypes.has(image.type)) {
    return fallback(
      "That screenshot format is not supported. Continue with the guided review.",
      400,
    );
  }

  const correlationId = randomUUID();
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return fallback(
      "Automatic extraction is unavailable right now. Continue with the guided review.",
    );
  }

  const reservationResult = await admin.rpc("reserve_vision_request", {
    p_user_id: authData.user.id,
    p_purpose: "betslip_import",
    p_local_ocr_outcome: localOcrOutcome,
    p_request_correlation_id: correlationId,
    p_reserved_cost_usd: VISION_RESERVATION_USD,
  });
  if (reservationResult.error) {
    return fallback(
      "Automatic extraction is unavailable right now. Continue with the guided review.",
    );
  }
  const reservation = Array.isArray(reservationResult.data)
    ? reservationResult.data[0]
    : reservationResult.data;
  if (!reservation?.allowed || !reservation.ledger_id) {
    return NextResponse.json({
      status: "budget_exhausted",
      fallback: true,
      message:
        "Assisted extraction is at its monthly limit. We kept your screenshot; please review it manually.",
    });
  }

  let result;
  try {
    result = await extractBetslipWithVision(image, {
      apiKey,
      userId: authData.user.id,
    });
  } catch (error) {
    await admin.rpc("complete_vision_request", {
      p_ledger_id: reservation.ledger_id,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_total_tokens: 0,
      p_status: error instanceof VisionMalformedResponseError ? "malformed" : "failed",
      p_local_ocr_outcome: localOcrOutcome,
    });
    return fallback(
      "Automatic extraction couldn't finish. We kept your screenshot and filled in what we could.",
    );
  }

  const completion = await admin.rpc("complete_vision_request", {
    p_ledger_id: reservation.ledger_id,
    p_input_tokens: result.inputTokens,
    p_output_tokens: result.outputTokens,
    p_total_tokens: result.totalTokens,
    p_status: "succeeded",
    p_local_ocr_outcome: localOcrOutcome,
  });
  if (completion.error) {
    return fallback(
      "Assisted extraction could not be recorded. We kept your screenshot; please review it manually.",
    );
  }

  return NextResponse.json({
    status: "succeeded",
    model: VISION_MODEL,
    draft: visionDraftToBetslipDraft(result.draft),
    message: "Assisted extraction finished. Review every field before saving.",
  });
}
