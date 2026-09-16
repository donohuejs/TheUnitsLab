"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isAdministrator } from "@/lib/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

function finish(message: string): never {
  redirect(`/admin/settlement-tests?notice=${encodeURIComponent(message)}`);
}

const createSchema = z.object({
  ticketType: z.enum(["straight", "parlay"]),
  scenario: z.enum(["win", "loss", "push", "void"]),
  stake: z.coerce.number().finite().positive().max(1000),
});

export async function createSettlementTest(formData: FormData) {
  const user = await requireAdministrator();
  const parsed = createSchema.safeParse({
    ticketType: value(formData, "ticketType"),
    scenario: value(formData, "scenario"),
    stake: value(formData, "stake"),
  });
  if (!parsed.success) finish("Choose a supported test type, result scenario, and stake.");

  const { error } = await createSupabaseAdminClient().rpc("admin_create_settlement_test", {
    p_target_user_id: user.id,
    p_ticket_type: parsed.data.ticketType,
    p_scenario: parsed.data.scenario,
    p_stake_units: parsed.data.stake.toFixed(2),
  });
  if (error) finish("The synthetic settlement test could not be created.");
  finish("Synthetic test wager created. It is excluded from normal history and analytics.");
}

const settleSchema = z.object({
  betId: z.uuid(),
  scenario: z.enum(["win", "loss", "push", "void"]),
});

export async function settleSettlementTest(formData: FormData) {
  await requireAdministrator();
  const parsed = settleSchema.safeParse({
    betId: value(formData, "betId"),
    scenario: value(formData, "scenario"),
  });
  if (!parsed.success) finish("The settlement test request is invalid.");

  const { error } = await createSupabaseAdminClient().rpc("admin_settle_settlement_test", {
    p_bet_id: parsed.data.betId,
    p_scenario: parsed.data.scenario,
  });
  if (error) finish("The synthetic wager could not be settled through the authoritative engine.");
  finish("Synthetic settlement evaluated. Re-running the same control is idempotent.");
}
