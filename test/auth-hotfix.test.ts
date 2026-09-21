import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
  supabase: {
    auth: {
      signUp: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      resend: vi.fn(),
      getUser: vi.fn(),
      updateUser: vi.fn(),
    },
    rpc: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => mocks.supabase),
}));

import { requestPasswordReset, resendConfirmation, signUp, updatePassword } from "@/app/actions";
import { GET as authCallback } from "@/app/auth/callback/route";
import {
  AUTH_CONFIRMED_PATH,
  AUTH_RECOVERY_PATH,
  buildAuthCallbackUrl,
  classifyAuthCallbackFailure,
} from "@/lib/auth-flow";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function formData(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

async function expectRedirect(action: Promise<unknown>, path: string) {
  await expect(action).rejects.toThrow(`REDIRECT:${path}`);
}

describe("authentication hotfix contracts", () => {
  beforeEach(() => {
    process.env.APP_URL = "http://localhost:3000";
    vi.clearAllMocks();
    mocks.supabase.auth.signUp.mockResolvedValue({
      data: { session: null, user: {} },
      error: null,
    });
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: "session" }, user: { id: "user-1" } },
      error: null,
    });
    mocks.supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.supabase.auth.resend.mockResolvedValue({ error: null });
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.supabase.auth.updateUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.supabase.rpc.mockResolvedValue({ data: 10000, error: null });
  });

  it("builds only the allowlisted PKCE callback destinations", () => {
    expect(buildAuthCallbackUrl("https://theunitslab.vercel.app", AUTH_CONFIRMED_PATH)).toBe(
      "https://theunitslab.vercel.app/auth/callback?next=%2Fauth%2Fconfirmed",
    );
    expect(buildAuthCallbackUrl("https://theunitslab.vercel.app", AUTH_RECOVERY_PATH)).toBe(
      "https://theunitslab.vercel.app/auth/callback?next=%2Fauth%2Frecovery",
    );
    expect(classifyAuthCallbackFailure({ code: "otp_expired" })).toBe("expired");
    expect(classifyAuthCallbackFailure({ message: "confirmation link already used" })).toBe(
      "already-used",
    );
    expect(classifyAuthCallbackFailure({ code: "bad_code_verifier" })).toBe("missing");
    expect(classifyAuthCallbackFailure({ message: "unexpected provider response" })).toBe(
      "exchange-failed",
    );
  });

  it("shows the check-email state after signup requires confirmation", async () => {
    await expectRedirect(
      signUp(
        formData({
          displayName: "Test Scientist",
          email: "scientist@example.com",
          password: "safe-password",
        }),
      ),
      "/auth/check-email?email=scientist%40example.com",
    );

    expect(mocks.supabase.auth.signUp).toHaveBeenCalledWith({
      email: "scientist@example.com",
      password: "safe-password",
      options: {
        data: { display_name: "Test Scientist" },
        emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fauth%2Fconfirmed",
      },
    });
  });

  it("uses the privacy-safe reset response and recovery callback", async () => {
    await expectRedirect(
      requestPasswordReset(formData({ email: "scientist@example.com" })),
      "/auth/forgot-password?notice=If%20an%20account%20exists%20for%20that%20email%2C%20we've%20sent%20password%20reset%20instructions.",
    );

    expect(mocks.supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "scientist@example.com",
      {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fauth%2Frecovery",
      },
    );
  });

  it("exchanges confirmation and recovery codes server-side", async () => {
    const confirmationResponse = await authCallback(
      new Request(
        "http://localhost:3000/auth/callback?code=confirmation-code&next=%2Fauth%2Fconfirmed&sb_flow_id=flow-1",
      ),
    );
    expect(confirmationResponse.headers.get("location")).toBe(
      "http://localhost:3000/auth/confirmed?status=success",
    );
    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("confirmation-code", {
      flowId: "flow-1",
    });
    expect(mocks.supabase.rpc).toHaveBeenCalledWith("ensure_initial_bankroll");

    const recoveryResponse = await authCallback(
      new Request("http://localhost:3000/auth/callback?code=recovery-code&next=%2Fauth%2Frecovery"),
    );
    expect(recoveryResponse.headers.get("location")).toBe(
      "http://localhost:3000/auth/recovery?status=success",
    );
  });

  it("routes missing and invalid callback payloads to safe failure UX", async () => {
    const missingResponse = await authCallback(
      new Request("http://localhost:3000/auth/callback?next=%2Fauth%2Fconfirmed"),
    );
    expect(missingResponse.headers.get("location")).toBe(
      "http://localhost:3000/auth/confirmed?status=missing",
    );

    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new Error("confirmation code already used"),
    });
    const invalidResponse = await authCallback(
      new Request("http://localhost:3000/auth/callback?code=used-code&next=%2Fauth%2Fconfirmed"),
    );
    expect(invalidResponse.headers.get("location")).toBe(
      "http://localhost:3000/auth/confirmed?status=already-used",
    );
  });

  it("resends confirmation without exposing provider errors", async () => {
    mocks.supabase.auth.resend.mockRejectedValue(new Error("provider detail"));

    await expectRedirect(
      resendConfirmation(formData({ email: "scientist@example.com" })),
      "/auth/check-email?email=scientist%40example.com&notice=If%20that%20account%20needs%20confirmation%2C%20we%20sent%20a%20new%20email.",
    );
  });

  it("rejects mismatched passwords before calling Supabase", async () => {
    await expectRedirect(
      updatePassword(formData({ password: "new-password", confirmPassword: "different" })),
      "/auth/recovery?status=mismatch",
    );
    expect(mocks.supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("enforces the existing password length requirement", async () => {
    await expectRedirect(
      updatePassword(formData({ password: "short", confirmPassword: "short" })),
      "/auth/recovery?status=weak",
    );
    expect(mocks.supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates the password only inside an authenticated recovery session", async () => {
    await expectRedirect(
      updatePassword(formData({ password: "new-password", confirmPassword: "new-password" })),
      "/auth/recovery?status=updated",
    );
    expect(mocks.supabase.auth.getUser).toHaveBeenCalledOnce();
    expect(mocks.supabase.auth.updateUser).toHaveBeenCalledWith({ password: "new-password" });

    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("no session"),
    });
    await expectRedirect(
      updatePassword(
        formData({ password: "another-password", confirmPassword: "another-password" }),
      ),
      "/auth/recovery?status=invalid",
    );
    expect(mocks.supabase.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("keeps callback, UX, and server-secret boundaries explicit", () => {
    const authPage = read("../src/app/auth/page.tsx");
    const actions = read("../src/app/actions.ts");
    const callback = read("../src/app/auth/callback/route.ts");
    const confirmed = read("../src/app/auth/confirmed/page.tsx");
    const forgotPassword = read("../src/app/auth/forgot-password/page.tsx");
    const recovery = read("../src/app/auth/recovery/page.tsx");
    const bootstrap = read("../src/lib/authenticated-bootstrap.ts");
    const lifecycleMigration = read(
      "../supabase/migrations/20261006000000_auth_onboarding_bankroll_lifecycle.sql",
    );
    const proxy = read("../proxy.ts");

    expect(authPage).toContain("Forgot password?");
    expect(authPage).toContain("Need another confirmation email?");
    expect(actions).toContain("emailRedirectTo");
    expect(actions).toContain("resetPasswordForEmail");
    expect(actions).toContain("updateUser({ password })");
    expect(callback).toContain("exchangeCodeForSession");
    expect(callback).toContain("sb_flow_id");
    expect(callback).not.toContain("createSupabaseAdminClient");
    expect(confirmed).toContain("Email confirmed");
    expect(confirmed).toContain("already been used");
    expect(forgotPassword).toContain("if an account exists");
    expect(recovery).toContain("Passwords do not match");
    expect(recovery).toContain("between 8 and 128 characters");
    expect(recovery).toContain("Password updated successfully.");
    expect(bootstrap).toContain("ensure_initial_bankroll");
    expect(bootstrap).toContain("auth.getUser()");
    expect(lifecycleMigration).toContain("drop trigger if exists profile_created_initial_bankroll");
    expect(lifecycleMigration).toContain("remove_abandoned_unconfirmed_user_data");
    expect(lifecycleMigration).toContain("email_confirmed_at");
    expect(proxy).toContain("supabase.auth.getClaims()");
  });
});
