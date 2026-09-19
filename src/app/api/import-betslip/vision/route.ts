import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { visionDraftToBetslipDraft } from "@/lib/betslip/extraction";
import {
  calculateVisionCostUsd,
  VISION_MODEL,
  VISION_RESERVATION_USD,
} from "@/lib/betslip/vision-accounting";
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
    const { error } = await admin
      .from("vision_diagnostics")
      .upsert(input, { onConflict: "request_correlation_id" });
    return !error;
  } catch {
    return false;
  }
}

async function updateLedger(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ledgerId: string,
  values: Record<string, unknown>,
) {
  try {
    await admin.from("vision_usage_ledger").update(values).eq("id", ledgerId);
  } catch {
    // The extraction result remains usable even if operational metadata needs a retry.
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

  const startedAt = Date.now();
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
    const latencyMs = Date.now() - startedAt;
    await updateLedger(admin, reservation.ledger_id, {
      attempted_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      provider_error_category: providerErrorCategory(error),
      extraction_path: "luna",
      fallback_used: true,
      latency_ms: latencyMs,
    });
    await writeDiagnostic(admin, {
      ...baseDiagnostic,
      internal_budget_available: true,
      monthly_budget_usd: reservation.approved_limit_usd,
      monthly_spend_usd: reservation.reserved_spend_usd,
      extraction_result: "fallback",
      provider_error_category: providerErrorCategory(error),
      attempted_at: new Date(startedAt).toISOString(),
      latency_ms: latencyMs,
      fallback_used: true,
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
  const latencyMs = Date.now() - startedAt;
  await updateLedger(admin, reservation.ledger_id, {
    attempted_at: new Date(startedAt).toISOString(),
    completed_at: new Date().toISOString(),
    provider_status: result.providerStatus,
    extraction_path: "luna",
    fallback_used: false,
    latency_ms: latencyMs,
  });
  const calculatedCost = result.usageAvailable
    ? calculateVisionCostUsd(result.inputTokens, result.outputTokens)
    : null;
  if (completion.error) {
    await writeDiagnostic(admin, {
      ...baseDiagnostic,
      internal_budget_available: true,
      monthly_budget_usd: reservation.approved_limit_usd,
      monthly_spend_usd: reservation.reserved_spend_usd,
      provider_status: result.providerStatus,
      extraction_result: "succeeded",
      provider_error_category: "ledger_completion_failed",
      attempted_at: new Date(startedAt).toISOString(),
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      total_tokens: result.totalTokens,
      usage_available: result.usageAvailable,
      calculated_cost_usd: calculatedCost,
      latency_ms: latencyMs,
      fallback_used: false,
      ledger_write_status: "failed",
    });
    return NextResponse.json({
      status: "succeeded",
      model: VISION_MODEL,
      visionAttempted: true,
      correlationId,
      providerStatus: result.providerStatus,
      draft: visionDraftToBetslipDraft(result.draft),
      message:
        "Luna vision extraction finished. Usage recording will be retried separately; review every field before saving.",
    });
  }

  await writeDiagnostic(admin, {
    ...baseDiagnostic,
    internal_budget_available: true,
    monthly_budget_usd: reservation.approved_limit_usd,
    monthly_spend_usd: reservation.reserved_spend_usd,
    provider_status: result.providerStatus,
    extraction_result: "succeeded",
    attempted_at: new Date(startedAt).toISOString(),
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    total_tokens: result.totalTokens,
    usage_available: result.usageAvailable,
    calculated_cost_usd: calculatedCost,
    latency_ms: latencyMs,
    fallback_used: false,
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
