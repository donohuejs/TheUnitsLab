import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ADMIN_ID = "fixture-admin-0000-0000-0000-000000000001";
const TEST_ID = "fixture-test-0000-0000-0000-000000000002";
const TEST_EMAIL = "jadaxi4311@meonvr.com";
const STUDY_ID = "fixture-study-0000-0000-0000-000000000001";

const fixtureUsers = [
  { id: ADMIN_ID, email: "fixture-admin@example.test", created_at: "2026-09-21T00:00:00.000Z" },
  { id: TEST_ID, email: TEST_EMAIL, created_at: "2026-09-21T00:00:00.000Z" },
];

const fixtureProfile = (userId, displayName) => ({
  user_id: userId,
  display_name: displayName,
  created_at: "2026-09-21T00:00:00.000Z",
  updated_at: "2026-09-21T00:00:00.000Z",
});

function fixtureRows(table, url) {
  const requestedUser = url.searchParams.get("user_id")?.replace("eq.", "");
  const requestedOwner = url.searchParams.get("owner_user_id")?.replace("eq.", "");
  const requestedGroup = url.searchParams.get("group_id")?.replace("eq.", "");

  if (table === "profiles") {
    if (requestedUser === ADMIN_ID) return [fixtureProfile(ADMIN_ID, "Fixture Admin")];
    if (requestedUser === TEST_ID) return [fixtureProfile(TEST_ID, "Fixture Test")];
  }
  if (table === "groups" && requestedOwner === ADMIN_ID) {
    return [
      {
        id: STUDY_ID,
        name: "Fixture Study",
        owner_user_id: ADMIN_ID,
        created_at: "2026-09-21T00:00:00.000Z",
      },
    ];
  }
  if (table === "group_members" && (requestedUser === ADMIN_ID || requestedGroup === STUDY_ID)) {
    return [
      {
        group_id: STUDY_ID,
        user_id: ADMIN_ID,
        role: "owner",
        joined_at: "2026-09-21T00:00:00.000Z",
      },
    ];
  }
  return [];
}

function startFixtureServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push({ method: request.method, pathname: url.pathname });

    response.setHeader("content-type", "application/json");
    if (url.pathname === "/auth/v1/admin/users" && request.method === "GET") {
      response.end(JSON.stringify({ users: fixtureUsers }));
      return;
    }
    if (url.pathname.startsWith("/rest/v1/") && request.method === "GET") {
      const table = url.pathname.slice("/rest/v1/".length);
      response.end(JSON.stringify(fixtureRows(table, url)));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "unexpected fixture request" }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, requests, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe("pre-beta maintenance CLI dry-run path", () => {
  let fixture;

  afterEach(async () => {
    if (fixture) {
      await new Promise((resolve, reject) =>
        fixture.server.close((error) => (error ? reject(error) : resolve())),
      );
      fixture = null;
    }
  });

  it("resolves the exact admin/test identities and performs no mutation or cleanup RPC", async () => {
    fixture = await startFixtureServer();
    const result = await execFileAsync(
      process.execPath,
      ["scripts/pre-beta-reset-maintenance.mjs", "--dry-run"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: fixture.url,
          SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
          PRE_BETA_ADMIN_USER_ID: ADMIN_ID,
          PRE_BETA_MAINTENANCE_ENV: "",
          PRE_BETA_TEST_USER_ID: TEST_ID,
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    const report = JSON.parse(result.stdout);
    expect(report.mode).toBe("DRY RUN — no mutations");
    expect(report.admin.auth.id).toBe(ADMIN_ID);
    expect(report.testUser.auth.id).toBe(TEST_ID);
    expect(report.testUser.auth.email).toBe(TEST_EMAIL);
    expect(report.expectedPostReset.approvedInputs.adminUserId).toBe(ADMIN_ID);
    expect(result.stderr).not.toContain("ReferenceError");
    expect(
      fixture.requests.some((request) => request.pathname.includes("/rpc/pre_beta_clean_start")),
    ).toBe(false);
    expect(fixture.requests.every((request) => request.method === "GET")).toBe(true);
  });
});
