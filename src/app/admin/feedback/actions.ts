"use server";

import { revalidatePath } from "next/cache";
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

export async function updateFeedbackStatus(formData: FormData) {
  await requireAdministrator();
  const parsed = z
    .object({ id: z.uuid(), status: z.enum(["new", "reviewing", "planned", "resolved"]) })
    .safeParse({ id: value(formData, "feedbackId"), status: value(formData, "status") });
  if (!parsed.success) redirect("/admin/feedback?notice=Invalid%20feedback%20status%20change.");

  const { error } = await createSupabaseAdminClient()
    .from("beta_feedback")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id);
  if (error) redirect("/admin/feedback?notice=Feedback%20status%20could%20not%20be%20updated.");

  revalidatePath("/admin/feedback");
  redirect("/admin/feedback?notice=Feedback%20status%20updated.");
}
