import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { visionDraftToBetslipDraft } from "@/lib/betslip/extraction";
import { VISION_MODEL, VISION_RESERVATION_USD } from "@/lib/betslip/vision-accounting";
import { extractBetslipWithVision, VisionMalformedResponseError } from "@/lib/betslip/vision";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function fallback(message: string, status = 200, details: Record<string, unknown> = {}) {
  return NextResponse.json(
    { status: "unavailable", fallback: true, visionAttempted: true, message, ...details },
    { status },
  );
}

function providerErrorCategory(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (message.includes("http 401") || message.includes("http 403")) return "invalid_api_key";
  if (message.includes("http 429")) return "rate_limit";
  if (message.includes("http 5")) return "provider_server_error";
  if (error instanceof VisionMalformedResponseError) return "malformed_provider_response";
  if (message.includes("abort") || message.includes("timeout")) return "timeout";
  return "provider_request_failed";
}

async function writeDiagnostic(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: Record<string, unknown>,
) {
  try {
    const { error } = await admin.from("vision_diagnostics").insert(input);
    return !error;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: authData } = await auth.auth.getUser();
  if (!authData.user) return fallback("Sign in to use assisted extraction.", 401);

  const formData = await request.formData();
  const image = formData.get("screenshot");
  const localOcrOutcome = String(formData.get("localOcrOutcome") ?? "not_run_luna_first").slice(
    0,
    120,
  );
  if (!(image instanceof Blob) || image.size <= 0 || image.size > MAX_SCREENSHOT_BYTES) {
    return fallback(
      "We kept your screenshot, but it could not be sent for assisted extraction.",
      400,
      { visionAttempted: false },
    );
  }
  if (!allowedTypes.has(image.type)) {
    return fallback(
      "That screenshot format is not supported. Continue with the guided review.",
      400,
      { visionAttempted: false },
    );
  }

  const correlationId = randomUUID();
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return fallback(
      "Automatic extraction is unavailable right now. Continue with the guided review.",
      200,
      { correlationId },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseDiagnostic = {
    user_id: authData.user.id,
    request_correlation_id: correlationId,
    model: VISION_MODEL,
    api_key_configured: Boolean(apiKey),
  };
  if (!apiKey) {
    await writeDiagnostic(admin, {
      ...baseDiagnostic,
      internal_budget_available: null,
      extraction_result: "fallback",
      provider_error_category: "missing_api_key",
      ledger_write_status: "not_attempted",
    });
    return fallback(
      "Automatic extraction couldn't finish. We kept your screenshot and filled in what we could.",
      200,
      { correlationId },
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
    await writeDiagnostic(admin, {
      ...baseDiagnostic,
      internal_budget_available: null,
      extraction_result: "fallback",
      provider_error_category: "ledger_reservation_failed",
      ledger_write_status: "failed",
    });
    return fallback(
      "Automatic extraction is unavailable right now. Continue with the guided review.",
      200,
      { correlationId },
    );
  }
  const reservation = Array.isArray(reservationResult.data)
    ? reservationResult.data[0]
    : reservationResult.data;
  if (!reservation?.allowed || !reservation.ledger_id) {
    await writeDiagnostic(admin, {
      ...baseDiagnostic,
      internal_budget_available: false,
      monthly_budget_usd: reservation?.approved_limit_usd ?? null,
      monthly_spend_usd: reservation?.reserved_spend_usd ?? null,
      extraction_result: "budget_exhausted",
      provider_error_category: "internal_budget_exhausted",
      ledger_write_status: "not_attempted",
    });
    return NextResponse.json({
      status: "budget_exhausted",
      fallback: true,
      visionAttempted: false,
      correlationId,
      message:
        "Assisted extraction is at its monthly limit. We kept your screenshot; please review it manually.",
    });
  }

  const reservedDiagnostic = await writeDiagnostic(admin, {
    ...baseDiagnostic,
    internal_budget_available: true,
    monthly_budget_usd: reservation.approved_limit_usd,
    monthly_spend_usd: reservation.reserved_spend_usd,
    extraction_result: "not_attempted",
    ledger_write_status: "reserved",
  });

  let result;
  try {
    result = await extractBetslipWithVision(image, {
      apiKey,
      userId: authData.user.id,
    });
  } catch (error) {
    const completion = await admin.rpc("complete_vision_request", {
      p_ledger_id: reservation.ledger_id,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_total_tokens: 0,
      p_status: error instanceof VisionMalformedResponseError ? "malformed" : "failed",
      p_local_ocr_outcome: localOcrOutcome,
    });
    await writeDiagnostic(admin, {
      ...baseDiagnostic,
      internal_budget_available: true,
      monthly_budget_usd: reservation.approved_limit_usd,
      monthly_spend_usd: reservation.reserved_spend_usd,
      extraction_result: "fallback",
      provider_error_category: providerErrorCategory(error),
      ledger_write_status: completion.error
        ? "failed"
        : reservedDiagnostic
          ? "completed"
          : "failed",
    });
    return fallback(
      "Automatic extraction couldn't finish. We kept your screenshot and filled in what we could.",
      200,
      { correlationId },
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
    await writeDiagnostic(admin, {
      ...baseDiagnostic,
      internal_budget_available: true,
      monthly_budget_usd: reservation.approved_limit_usd,
      monthly_spend_usd: reservation.reserved_spend_usd,
      provider_status: result.providerStatus,
      extraction_result: "failed",
      provider_error_category: "ledger_completion_failed",
      ledger_write_status: "failed",
    });
    return fallback(
      "Assisted extraction could not be recorded. We kept your screenshot; please review it manually.",
      200,
      { correlationId },
    );
  }

  await writeDiagnostic(admin, {
    ...baseDiagnostic,
    internal_budget_available: true,
    monthly_budget_usd: reservation.approved_limit_usd,
    monthly_spend_usd: reservation.reserved_spend_usd,
    provider_status: result.providerStatus,
    extraction_result: "succeeded",
    ledger_write_status: "completed",
  });
  return NextResponse.json({
    status: "succeeded",
    model: VISION_MODEL,
    visionAttempted: true,
    correlationId,
    providerStatus: result.providerStatus,
    draft: visionDraftToBetslipDraft(result.draft),
    message: "Luna vision extraction finished. Review every field before saving.",
  });
}
