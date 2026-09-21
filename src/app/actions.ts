"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { APP_VERSION } from "@/config/version";
import {
  AUTH_CHECK_EMAIL_PATH,
  AUTH_CONFIRMED_PATH,
  AUTH_FORGOT_PASSWORD_PATH,
  AUTH_RECOVERY_PATH,
  buildAuthCallbackUrl,
} from "@/lib/auth-flow";
import { ensureInitialBankroll } from "@/lib/authenticated-bootstrap";
import { getApplicationSiteUrl } from "@/lib/auth-urls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type InviteActionState = {
  error?: string;
  inviteId?: string;
  token?: string;
  expiresAt?: string;
  maxUses?: number | null;
};

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

const signupSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(2).max(50),
});

const uuidSchema = z.uuid();
const groupNameSchema = z.string().trim().min(2).max(80);
const inviteMaxUsesSchema = z.union([z.literal(""), z.coerce.number().int().min(1).max(50)]);
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(50),
  avatarUrl: z.union([z.url().max(500), z.literal("")]),
  unitDescription: z.string().trim().max(80),
  defaultBankroll: z.union([z.literal(""), z.coerce.number().min(0).max(999999999999.99)]),
  timeZone: z.string().trim().min(1).max(100),
  profileVisibility: z.enum(["private", "group_members"]),
});

const betaFeedbackSchema = z.object({
  submissionKey: z.uuid(),
  category: z.enum(["bug", "usability", "feature_request", "other"]),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  stepsToReproduce: z.string().trim().max(5000),
});

function value(formData: FormData, field: string) {
  const candidate = formData.get(field);
  return typeof candidate === "string" ? candidate : "";
}

function redirectWithNotice(path: string, notice: string): never {
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
}

function returnPath(formData: FormData) {
  const candidate = value(formData, "returnTo");
  return candidate === "/leaderboards" || candidate === "/account" ? candidate : "/account";
}

function authErrorMessage(message: string, fallback: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) {
    return "Email or password was not recognized.";
  }
  if (normalized.includes("already registered") || normalized.includes("already exists")) {
    return "An account with that email already exists. Try signing in.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Email not confirmed. Check your inbox or resend the confirmation email.";
  }
  if (normalized.includes("weak password") || normalized.includes("password should be")) {
    return "Choose a password with at least 8 characters.";
  }
  return fallback;
}

const privacySafeResetNotice =
  "If an account exists for that email, we've sent password reset instructions.";

async function requireAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirectWithNotice("/auth", "Please sign in to continue.");
  }

  await ensureInitialBankroll(supabase);

  return { supabase, user: data.user };
}

export async function signUp(formData: FormData) {
  const parsed = signupSchema.safeParse({
    email: value(formData, "email"),
    password: value(formData, "password"),
    displayName: value(formData, "displayName"),
  });

  if (!parsed.success) {
    redirectWithNotice(
      "/auth",
      "Enter a valid name, email, and password of at least 8 characters.",
    );
  }

  const supabase = await createSupabaseServerClient();
  const siteUrl = await getApplicationSiteUrl();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: buildAuthCallbackUrl(siteUrl, AUTH_CONFIRMED_PATH),
    },
  });

  if (error) {
    redirectWithNotice("/auth", authErrorMessage(error.message, "Sign-up could not be completed."));
  }
  if (!data.session) {
    redirect(`${AUTH_CHECK_EMAIL_PATH}?email=${encodeURIComponent(parsed.data.email)}`);
  }

  redirect("/account");
}

export async function signIn(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: value(formData, "email"),
    password: value(formData, "password"),
  });

  if (!parsed.success) {
    redirectWithNotice("/auth", "Enter a valid email and password.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    redirectWithNotice("/auth", authErrorMessage(error.message, "Sign-in could not be completed."));
  }

  redirect("/account");
}

export async function resendConfirmation(formData: FormData) {
  const email = value(formData, "email").trim();
  const parsed = z.email().safeParse(email);

  if (!parsed.success) {
    redirect(
      `${AUTH_CHECK_EMAIL_PATH}?notice=${encodeURIComponent("Enter a valid email address.")}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  try {
    const siteUrl = await getApplicationSiteUrl();
    await supabase.auth.resend({
      type: "signup",
      email: parsed.data,
      options: { emailRedirectTo: buildAuthCallbackUrl(siteUrl, AUTH_CONFIRMED_PATH) },
    });
  } catch {
    // Keep resend responses privacy-safe and avoid exposing provider details.
  }

  redirect(
    `${AUTH_CHECK_EMAIL_PATH}?email=${encodeURIComponent(parsed.data)}&notice=${encodeURIComponent("If that account needs confirmation, we sent a new email.")}`,
  );
}

export async function requestPasswordReset(formData: FormData) {
  const email = value(formData, "email").trim();
  const parsed = z.email().safeParse(email);

  if (!parsed.success) {
    redirectWithNotice(AUTH_FORGOT_PASSWORD_PATH, "Enter a valid email address.");
  }

  const supabase = await createSupabaseServerClient();
  try {
    const siteUrl = await getApplicationSiteUrl();
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: buildAuthCallbackUrl(siteUrl, AUTH_RECOVERY_PATH),
    });
  } catch {
    // The same response is used for provider failures and unknown addresses.
  }

  redirectWithNotice(AUTH_FORGOT_PASSWORD_PATH, privacySafeResetNotice);
}

export async function updatePassword(formData: FormData) {
  const password = value(formData, "password");
  const confirmPassword = value(formData, "confirmPassword");

  if (password.length < 8 || password.length > 128 || password !== confirmPassword) {
    redirect(`${AUTH_RECOVERY_PATH}?status=${password !== confirmPassword ? "mismatch" : "weak"}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    redirect(`${AUTH_RECOVERY_PATH}?status=invalid`);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`${AUTH_RECOVERY_PATH}?status=failed`);
  }

  redirect(`${AUTH_RECOVERY_PATH}?status=updated`);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/auth");
}

export async function updateProfile(formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  const parsed = profileSchema.safeParse({
    displayName: value(formData, "displayName"),
    avatarUrl: value(formData, "avatarUrl"),
    unitDescription: value(formData, "unitDescription"),
    defaultBankroll: value(formData, "defaultBankroll"),
    timeZone: value(formData, "timeZone"),
    profileVisibility: value(formData, "profileVisibility"),
  });

  if (!parsed.success) {
    redirectWithNotice("/account", "Profile values are incomplete or invalid.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      avatar_url: parsed.data.avatarUrl || null,
      preferred_unit_size_description: parsed.data.unitDescription || null,
      default_virtual_bankroll_units:
        parsed.data.defaultBankroll === "" ? null : parsed.data.defaultBankroll,
      time_zone: parsed.data.timeZone,
      profile_visibility: parsed.data.profileVisibility,
    })
    .eq("user_id", user.id);

  if (error) {
    redirectWithNotice(
      "/account",
      "Profile could not be updated. Review the fields and try again.",
    );
  }
  revalidatePath("/account");
  redirectWithNotice("/account", "Profile updated.");
}

export async function submitBetaFeedback(formData: FormData) {
  const { supabase } = await requireAuthenticatedUser();
  const parsed = betaFeedbackSchema.safeParse({
    submissionKey: value(formData, "submissionKey"),
    category: value(formData, "category"),
    title: value(formData, "title"),
    description: value(formData, "description"),
    stepsToReproduce: value(formData, "stepsToReproduce"),
  });
  if (!parsed.success) {
    redirectWithNotice(
      "/account",
      "Choose a feedback type and enter a title plus a description before sending.",
    );
  }

  const requestHeaders = await headers();
  const { error } = await supabase.rpc("submit_beta_feedback", {
    p_submission_key: parsed.data.submissionKey,
    p_category: parsed.data.category,
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_steps_to_reproduce: parsed.data.stepsToReproduce || null,
    p_page_path: "/account#feedback",
    p_app_version: APP_VERSION,
    p_user_agent: requestHeaders.get("user-agent")?.slice(0, 500) ?? null,
    p_environment: { source: "settings_feedback" },
  });
  if (error) {
    redirectWithNotice(
      "/account",
      "Feedback could not be sent. Your draft was not saved; please try again.",
    );
  }
  revalidatePath("/account");
  redirectWithNotice("/account", "Thanks — your feedback was sent to The Units Lab team.");
}

export async function createGroup(formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  const destination = returnPath(formData);
  const parsed = groupNameSchema.safeParse(value(formData, "groupName"));
  if (!parsed.success) {
    redirectWithNotice(destination, "Study names must be between 2 and 80 characters.");
  }

  const { error } = await supabase.from("groups").insert({
    name: parsed.data,
    owner_user_id: user.id,
  });

  if (error) {
    redirectWithNotice(
      destination,
      "The Study could not be created. Review the name and try again.",
    );
  }
  revalidatePath("/account");
  revalidatePath("/leaderboards");
  redirectWithNotice(destination, "Study created.");
}

export async function joinGroup(formData: FormData) {
  const { supabase } = await requireAuthenticatedUser();
  const destination = returnPath(formData);
  const token = value(formData, "inviteToken").trim();
  if (token.length < 32 || token.length > 512) {
    redirectWithNotice(destination, "Enter a valid invitation token.");
  }

  const { error } = await supabase.rpc("join_group_with_invite", { invite_token: token });
  if (error) {
    const message = error.message.toLowerCase();
    redirectWithNotice(
      destination,
      message.includes("expired") || message.includes("invalid") || message.includes("revoked")
        ? "This invite is invalid, expired, revoked, or no longer available."
        : "The invitation could not be redeemed. Check the token and try again.",
    );
  }
  revalidatePath("/account");
  revalidatePath("/leaderboards");
  redirectWithNotice(destination, "Study joined.");
}

export async function createInvite(
  _previousState: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const { supabase } = await requireAuthenticatedUser();
  const groupId = uuidSchema.safeParse(value(formData, "groupId"));
  if (!groupId.success) {
    return { error: "Invalid Study." };
  }
  const maxUses = inviteMaxUsesSchema.safeParse(value(formData, "maxUses"));
  if (!maxUses.success) {
    return { error: "Maximum uses must be blank or an integer from 1 to 50." };
  }

  const { data, error } = await supabase
    .rpc("create_group_invite", {
      target_group_id: groupId.data,
      valid_for: "7 days",
      allowed_uses: maxUses.data === "" ? null : maxUses.data,
    })
    .single();

  if (error || !data) {
    return {
      error: "The invitation could not be created. Check your Study permissions and try again.",
    };
  }

  const invitation = data as {
    invite_id: string;
    invite_token: string;
    invite_expires_at: string;
    invite_max_uses: number | null;
  };

  return {
    inviteId: invitation.invite_id,
    token: invitation.invite_token,
    expiresAt: invitation.invite_expires_at,
    maxUses: invitation.invite_max_uses,
  };
}

export async function revokeInvite(formData: FormData) {
  const { supabase } = await requireAuthenticatedUser();
  const inviteId = uuidSchema.safeParse(value(formData, "inviteId"));
  if (!inviteId.success) {
    redirectWithNotice("/leaderboards", "That invite is invalid.");
  }
  const { error } = await supabase.rpc("revoke_group_invite", {
    target_invite_id: inviteId.data,
  });
  if (error) {
    redirectWithNotice("/leaderboards", "The invite could not be revoked.");
  }
  revalidatePath("/leaderboards");
  redirectWithNotice("/leaderboards", "Invite revoked.");
}

export async function setMemberRole(formData: FormData) {
  const { supabase } = await requireAuthenticatedUser();
  const parsed = z
    .object({
      groupId: uuidSchema,
      userId: uuidSchema,
      role: z.enum(["admin", "member"]),
    })
    .safeParse({
      groupId: value(formData, "groupId"),
      userId: value(formData, "userId"),
      role: value(formData, "role"),
    });
  if (!parsed.success) {
    redirectWithNotice("/account", "Invalid membership change.");
  }

  const { error } = await supabase.rpc("set_group_member_role", {
    target_group_id: parsed.data.groupId,
    target_user_id: parsed.data.userId,
    new_role: parsed.data.role,
  });
  if (error) {
    redirectWithNotice("/account", "The membership role could not be updated.");
  }
  revalidatePath("/account");
  redirectWithNotice("/account", "Membership role updated.");
}

export async function removeMember(formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  const parsed = z.object({ groupId: uuidSchema, userId: uuidSchema }).safeParse({
    groupId: value(formData, "groupId"),
    userId: value(formData, "userId"),
  });
  if (!parsed.success) {
    redirectWithNotice("/account", "Invalid membership change.");
  }

  const { error } = await supabase.rpc("remove_group_member", {
    target_group_id: parsed.data.groupId,
    target_user_id: parsed.data.userId,
  });
  if (error) {
    redirectWithNotice("/account", "The member action could not be completed.");
  }
  revalidatePath("/account");
  redirectWithNotice(
    "/account",
    parsed.data.userId === user.id ? "You left the Study." : "Study Partner removed.",
  );
}
