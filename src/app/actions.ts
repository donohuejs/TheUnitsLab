"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type InviteActionState = {
  error?: string;
  token?: string;
  expiresAt?: string;
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
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(50),
  avatarUrl: z.union([z.url().max(500), z.literal("")]),
  unitDescription: z.string().trim().max(80),
  defaultBankroll: z.union([z.literal(""), z.coerce.number().min(0).max(999999999999.99)]),
  timeZone: z.string().trim().min(1).max(100),
  profileVisibility: z.enum(["private", "group_members"]),
});

function value(formData: FormData, field: string) {
  const candidate = formData.get(field);
  return typeof candidate === "string" ? candidate : "";
}

function redirectWithNotice(path: string, notice: string): never {
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
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
    return "Confirm your email address before signing in.";
  }
  return fallback;
}

async function requireAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirectWithNotice("/auth", "Please sign in to continue.");
  }

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
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName } },
  });

  if (error) {
    redirectWithNotice("/auth", authErrorMessage(error.message, "Sign-up could not be completed."));
  }
  if (!data.session) {
    redirectWithNotice("/auth", "Check your email to confirm the account, then sign in.");
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

export async function createGroup(formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  const parsed = groupNameSchema.safeParse(value(formData, "groupName"));
  if (!parsed.success) {
    redirectWithNotice("/account", "Group names must be between 2 and 80 characters.");
  }

  const { error } = await supabase.from("groups").insert({
    name: parsed.data,
    owner_user_id: user.id,
  });

  if (error) {
    redirectWithNotice(
      "/account",
      "The group could not be created. Review the name and try again.",
    );
  }
  revalidatePath("/account");
  redirectWithNotice("/account", "Group created.");
}

export async function joinGroup(formData: FormData) {
  const { supabase } = await requireAuthenticatedUser();
  const token = value(formData, "inviteToken").trim();
  if (token.length < 32 || token.length > 512) {
    redirectWithNotice("/account", "Enter a valid invitation token.");
  }

  const { error } = await supabase.rpc("join_group_with_invite", { invite_token: token });
  if (error) {
    redirectWithNotice(
      "/account",
      "The invitation could not be redeemed. Check the token and try again.",
    );
  }
  revalidatePath("/account");
  redirectWithNotice("/account", "Group joined.");
}

export async function createInvite(
  _previousState: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const { supabase } = await requireAuthenticatedUser();
  const groupId = uuidSchema.safeParse(value(formData, "groupId"));
  if (!groupId.success) {
    return { error: "Invalid group." };
  }

  const { data, error } = await supabase
    .rpc("create_group_invite", {
      target_group_id: groupId.data,
      valid_for: "7 days",
      allowed_uses: 1,
    })
    .single();

  if (error || !data) {
    return {
      error: "The invitation could not be created. Check your group permissions and try again.",
    };
  }

  const invitation = data as {
    invite_token: string;
    invite_expires_at: string;
  };

  return {
    token: invitation.invite_token,
    expiresAt: invitation.invite_expires_at,
  };
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
    parsed.data.userId === user.id ? "You left the group." : "Member removed.",
  );
}
