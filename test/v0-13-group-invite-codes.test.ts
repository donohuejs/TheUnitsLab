import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("v0.13.0 group invite code contracts", () => {
  it("keeps code generation cryptographic, hashed, unique, and bounded on collisions", () => {
    const migration = read("../supabase/migrations/20261007000000_v0_13_group_invite_codes.sql");
    expect(migration).toContain("extensions.gen_random_bytes(1)");
    expect(migration).toContain("invite_code_hash");
    expect(migration).toContain("create unique index group_invites_invite_code_hash_key");
    expect(migration).toContain("for attempt in 1..10 loop");
    expect(migration).toContain("when unique_violation then");
    expect(migration).toContain("Invite could not be created. Please try again.");
  });

  it("converges link and code redemption on one locked membership transaction", () => {
    const migration = read("../supabase/migrations/20261007000000_v0_13_group_invite_codes.sql");
    expect(migration).toContain("create or replace function app_private.redeem_group_invite");
    expect(migration).toContain("for update");
    expect(migration).toContain("on conflict on constraint group_members_pkey do nothing");
    expect(migration).toContain("join_group_with_invite_status");
    expect(migration).toContain("join_group_with_invite_code_status");
    expect(migration).toContain("set use_count = use_count + 1");
    expect(migration).toContain("inserted_rows = 0");
  });

  it("documents authenticated code-attempt throttling without an external service", () => {
    const migration = read("../supabase/migrations/20261007000000_v0_13_group_invite_codes.sql");
    expect(migration).toContain("group_invite_code_attempts");
    expect(migration).toContain("interval '10 minutes'");
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toContain("'rate_limited'::text");
    expect(migration).toContain("revoke all on table app_private.group_invite_code_attempts");
  });

  it("renders both invite redemption methods and loading-aware code joining", () => {
    const inviteForm = read("../src/components/invite-form.tsx");
    const management = read("../src/components/leaderboard-controls.tsx");
    const actions = read("../src/app/actions.ts");
    expect(inviteForm).toContain("Copy Invite Link");
    expect(inviteForm).toContain("Copy Code");
    expect(inviteForm).toContain("formatInviteCode");
    expect(management).toContain('name="inviteCode"');
    expect(management).toContain("Join Group");
    expect(management).toContain("useFormStatus");
    expect(actions).toContain("join_group_with_invite_code_status");
    expect(actions).toContain("already_member");
  });
});
