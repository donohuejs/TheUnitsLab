import { NextResponse } from "next/server";

import {
  AUTH_CONFIRMED_PATH,
  AUTH_RECOVERY_PATH,
  classifyAuthCallbackFailure,
  normalizeAuthCallbackDestination,
} from "@/lib/auth-flow";
import { ensureInitialBankroll } from "@/lib/authenticated-bootstrap";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectToStatus(request: Request, destination: string, status: string) {
  const url = new URL(destination, request.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const destination = normalizeAuthCallbackDestination(requestUrl.searchParams.get("next"));
  const destinationPath =
    destination === AUTH_RECOVERY_PATH ? AUTH_RECOVERY_PATH : AUTH_CONFIRMED_PATH;
  const errorCode = requestUrl.searchParams.get("error_code");
  const errorMessage =
    requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");

  if (errorCode || errorMessage) {
    return redirectToStatus(
      request,
      destinationPath,
      classifyAuthCallbackFailure({ code: errorCode, message: errorMessage }),
    );
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    return redirectToStatus(request, destinationPath, "missing");
  }

  try {
    const supabase = await createSupabaseServerClient();
    const flowId = requestUrl.searchParams.get("sb_flow_id");
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );

    if (error || !data.session || !data.user) {
      return redirectToStatus(
        request,
        destinationPath,
        classifyAuthCallbackFailure({ code: error?.code, message: error?.message }),
      );
    }

    try {
      await ensureInitialBankroll(supabase);
    } catch {
      return redirectToStatus(request, destinationPath, "initialization-failed");
    }

    return redirectToStatus(request, destinationPath, "success");
  } catch {
    return redirectToStatus(request, destinationPath, "exchange-failed");
  }
}
