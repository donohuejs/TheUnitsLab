"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isAdministrator } from "@/lib/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function value(formData: FormData, name: string) {
  const candidate = formData.get(name);
  return typeof candidate === "string" ? candidate : "";
}

async function requireAdministrator() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth");
  if (!isAdministrator(data.user.id)) redirect("/sports");
  return data.user;
}

export async function increaseVisionBudget(formData: FormData) {
  const user = await requireAdministrator();
  const parsed = z
    .object({ amount: z.coerce.number().finite().positive().max(100), reason: z.string().max(500) })
    .safeParse({ amount: value(formData, "amount"), reason: value(formData, "reason") });
  if (!parsed.success) {
    redirect("/admin/api-usage?notice=Enter an increase between $0 and $100.");
  }
  const { error } = await createSupabaseAdminClient().rpc("increase_vision_budget", {
    p_admin_user_id: user.id,
    p_amount_usd: parsed.data.amount.toFixed(6),
    p_reason: parsed.data.reason || null,
  });
  redirect(
    `/admin/api-usage?notice=${encodeURIComponent(
      error
        ? "Vision budget could not be increased."
        : "Vision budget increased and audit record created.",
    )}`,
  );
}
