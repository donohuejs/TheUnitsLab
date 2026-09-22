import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function localEnvironment() {
  const cli = path.join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
  const result = spawnSync(process.execPath, [cli, "status", "-o", "env"], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Local Supabase status is unavailable");
  return Object.fromEntries(
    result.stdout
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^"|"$/g, "")]),
  );
}

function localJwt(subject, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    iss: "supabase",
    role: "authenticated",
    sub: subject,
  });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const environment = localEnvironment();
assert(
  environment.API_URL &&
    environment.SERVICE_ROLE_KEY &&
    environment.ANON_KEY &&
    environment.JWT_SECRET,
  "Local Supabase credentials are incomplete",
);

const admin = createClient(environment.API_URL, environment.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createdUsers = [];
let groupId;

function authenticatedClient(userId) {
  return createClient(environment.API_URL, environment.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${localJwt(userId, environment.JWT_SECRET)}` },
    },
  });
}

try {
  for (const [index, displayName] of [
    "Invite Code Owner",
    "Invite Code A",
    "Invite Code B",
  ].entries()) {
    const created = await admin.auth.admin.createUser({
      email: `v013-invite-concurrency-${index}-${suffix}@example.test`,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("Synthetic invite-concurrency user was not created");
    }
    createdUsers.push(created.data.user.id);
  }

  const insertedGroup = await admin
    .from("groups")
    .insert({ name: `v0.13 concurrency ${suffix}`, owner_user_id: createdUsers[0] })
    .select("id")
    .single();
  if (insertedGroup.error || !insertedGroup.data) throw insertedGroup.error;
  groupId = insertedGroup.data.id;

  const createdInvite = await authenticatedClient(createdUsers[0]).rpc("create_group_invite", {
    target_group_id: groupId,
    valid_for: "7 days",
    allowed_uses: 1,
  });
  if (createdInvite.error || !createdInvite.data?.[0]?.invite_code) {
    throw createdInvite.error ?? new Error("Synthetic invite was not created");
  }
  const code = createdInvite.data[0].invite_code;

  const results = await Promise.all(
    createdUsers.slice(1).map((userId) =>
      authenticatedClient(userId).rpc("join_group_with_invite_code_status", {
        invite_code: code,
      }),
    ),
  );
  const successful = results.filter((result) => result.data?.[0]?.group_id === groupId);
  const unavailable = results.filter((result) => result.data?.[0]?.error_code === "invalid");
  assert(successful.length === 1, "Exactly one concurrent code redemption must create membership");
  assert(unavailable.length === 1, "The competing redemption must see an unavailable invite");

  const memberships = await admin.from("group_members").select("user_id").eq("group_id", groupId);
  if (memberships.error) throw memberships.error;
  assert(
    memberships.data.length === 2,
    "Concurrent redemption must leave one owner and one member",
  );

  const invites = await admin
    .from("group_invites")
    .select("use_count")
    .eq("group_id", groupId)
    .single();
  if (invites.error || !invites.data) throw invites.error;
  assert(invites.data.use_count === 1, "Concurrent redemption must consume one limited use");

  process.stdout.write(
    "PASS: concurrent invite-code redemption created one membership and consumed one use.\n",
  );
} finally {
  if (groupId) await admin.from("groups").delete().eq("id", groupId);
  for (const userId of createdUsers) await admin.auth.admin.deleteUser(userId);
}
