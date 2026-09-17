import Link from "next/link";
import { redirect } from "next/navigation";

import { removeMember, setMemberRole, signOut, updateProfile } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AccountPageProps = {
  searchParams: Promise<{ notice?: string }>;
};

type Profile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  preferred_unit_size_description: string | null;
  default_virtual_bankroll_units: number | null;
  time_zone: string;
  profile_visibility: "private" | "group_members";
};

type Group = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
};

type Membership = {
  group_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  if (!hasPublicEnvironment(process.env)) {
    redirect("/auth");
  }

  const { notice } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    redirect("/auth");
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select(
      "user_id,display_name,avatar_url,preferred_unit_size_description,default_virtual_bankroll_units,time_zone,profile_visibility",
    )
    .eq("user_id", authData.user.id)
    .single();

  const { data: groupData, error: groupError } = await supabase
    .from("groups")
    .select("id,name,owner_user_id,created_at")
    .order("created_at", { ascending: true });

  const groups = (groupData ?? []) as Group[];
  const groupIds = groups.map((group) => group.id);
  const membershipResult = groupIds.length
    ? await supabase
        .from("group_members")
        .select("group_id,user_id,role,joined_at")
        .in("group_id", groupIds)
        .order("joined_at", { ascending: true })
    : { data: [], error: null };
  const memberships = (membershipResult.data ?? []) as Membership[];
  const memberIds = [...new Set(memberships.map((membership) => membership.user_id))];
  const memberProfileResult = memberIds.length
    ? await supabase.from("profiles").select("user_id,display_name").in("user_id", memberIds)
    : { data: [], error: null };
  const memberNames = new Map(
    (memberProfileResult.data ?? []).map((profile) => [profile.user_id, profile.display_name]),
  );
  const profile = profileData as Profile | null;
  const dataError =
    profileError ?? groupError ?? membershipResult.error ?? memberProfileResult.error ?? null;

  return (
    <main className="shell">
      <AppNav active="account" userId={authData.user.id} />
      <header className="account-header">
        <div>
          <p className="eyebrow">Account and private Studies</p>
          <h1>Settings</h1>
          <p className="muted">
            Signed in as {profile?.display_name ?? "your account"}. Manage your profile and optional
            wager Study associations.
          </p>
        </div>
        <form action={signOut}>
          <button className="button secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>

      {notice ? (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {dataError ? (
        <p className="notice error" role="alert">
          Account data is temporarily unavailable. Refresh the page and try again.
        </p>
      ) : null}

      <p className="notice disclosure">
        The Units Lab is a simulation and wager-tracking companion. No real-money wagering,
        deposits, withdrawals, or sportsbook execution occurs in the app.
      </p>

      <div className="dashboard-grid">
        <section className="card">
          <h2>Profile</h2>
          {profile ? (
            <form action={updateProfile} className="form-stack">
              <label>
                Display name
                <input
                  name="displayName"
                  defaultValue={profile.display_name}
                  minLength={2}
                  maxLength={50}
                  required
                />
              </label>
              <label>
                Avatar URL
                <input name="avatarUrl" type="url" defaultValue={profile.avatar_url ?? ""} />
              </label>
              <label>
                Preferred Vial description
                <input
                  name="unitDescription"
                  maxLength={80}
                  defaultValue={profile.preferred_unit_size_description ?? ""}
                  placeholder="Optional description"
                />
              </label>
              <label>
                Default Vial balance preference
                <input
                  name="defaultBankroll"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={profile.default_virtual_bankroll_units ?? ""}
                  placeholder="Not set"
                />
              </label>
              <label>
                Time zone
                <input name="timeZone" defaultValue={profile.time_zone} required />
              </label>
              <label>
                Profile visibility
                <select name="profileVisibility" defaultValue={profile.profile_visibility}>
                  <option value="group_members">Shared with Study Partners</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <SubmitButton pendingLabel="Saving profile…">Save profile</SubmitButton>
            </form>
          ) : (
            <p>Your application profile is unavailable.</p>
          )}
        </section>

        <section className="card">
          <h2>Private Study access</h2>
          <p>Start Studies, redeem expiring invites, and share Study Invites from Lab Notes.</p>
          <Link className="button secondary" href="/leaderboards">
            Open Lab Notes Study access
          </Link>
        </section>
      </div>

      <section className="groups-section">
        <div className="section-heading">
          <h2>Your Studies</h2>
          <span className="pill">{groups.length}</span>
        </div>
        {groups.length === 0 ? (
          <p className="empty-state">You do not belong to a Study yet.</p>
        ) : null}
        <div className="group-grid">
          {groups.map((group) => {
            const groupMemberships = memberships.filter(
              (membership) => membership.group_id === group.id,
            );
            const currentMembership = groupMemberships.find(
              (membership) => membership.user_id === authData.user.id,
            );
            return (
              <article className="card group-card" key={group.id}>
                <div className="group-title">
                  <div>
                    <h3>{group.name}</h3>
                    <p className="muted">Your role: {currentMembership?.role ?? "unknown"}</p>
                  </div>
                  {currentMembership && currentMembership.role !== "owner" ? (
                    <form action={removeMember}>
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="userId" value={authData.user.id} />
                      <button className="text-button danger" type="submit">
                        Leave
                      </button>
                    </form>
                  ) : null}
                </div>

                <h4>Members</h4>
                <ul className="member-list">
                  {groupMemberships.map((membership) => {
                    const isSelf = membership.user_id === authData.user.id;
                    const ownerCanManage =
                      currentMembership?.role === "owner" && membership.role !== "owner";
                    const adminCanRemove =
                      currentMembership?.role === "admin" &&
                      membership.role === "member" &&
                      !isSelf;

                    return (
                      <li key={membership.user_id}>
                        <div>
                          <strong>{memberNames.get(membership.user_id) ?? "Private member"}</strong>
                          <span className="role">{membership.role}</span>
                        </div>
                        <div className="member-actions">
                          {ownerCanManage ? (
                            <form action={setMemberRole} className="inline-form">
                              <input type="hidden" name="groupId" value={group.id} />
                              <input type="hidden" name="userId" value={membership.user_id} />
                              <select
                                name="role"
                                defaultValue={membership.role}
                                aria-label="Member role"
                              >
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                              </select>
                              <button className="text-button" type="submit">
                                Update
                              </button>
                            </form>
                          ) : null}
                          {ownerCanManage || adminCanRemove ? (
                            <form action={removeMember}>
                              <input type="hidden" name="groupId" value={group.id} />
                              <input type="hidden" name="userId" value={membership.user_id} />
                              <button className="text-button danger" type="submit">
                                Remove
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
