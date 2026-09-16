import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: RouteContext<"/track-bet/screenshot/[wagerId]">,
) {
  const { wagerId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  const { data: wager } = await supabase
    .from("external_wagers")
    .select("screenshot_path")
    .eq("id", wagerId)
    .not("screenshot_path", "is", null)
    .maybeSingle();
  if (!wager?.screenshot_path) return new Response("Screenshot not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from("external-wager-screenshots")
    .createSignedUrl(wager.screenshot_path, 60);
  if (error || !data?.signedUrl) return new Response("Screenshot unavailable", { status: 403 });
  return Response.redirect(data.signedUrl, 302);
}
