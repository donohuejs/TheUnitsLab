import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { APP_VERSION, APP_VERSION_LABEL } from "../src/config/version";
import { VERSION_HISTORY } from "../src/config/version-history";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("v0.11.1 tutorial hotfix release contracts", () => {
  it("uses one canonical package version in Settings", () => {
    const packageJson = JSON.parse(read("../package.json")) as { version: string };
    const accountPage = read("../src/app/account/page.tsx");

    expect(APP_VERSION).toBe("0.11.1");
    expect(APP_VERSION_LABEL).toBe("v0.11.1");
    expect(packageJson.version).toBe(APP_VERSION);
    expect(accountPage).toContain("APP_VERSION_LABEL");
    expect(accountPage).not.toContain('"v0.11.0"');
  });

  it("keeps the requested release history entries", () => {
    expect(VERSION_HISTORY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: "0.11.1", title: "Tutorial Video Hotfix" }),
        expect.objectContaining({ version: "0.11.0", title: "Private Beta Readiness" }),
        expect.objectContaining({ version: "0.10.1", title: "Production UX Hotfix" }),
      ]),
    );
  });

  it("renders the beta announcement and settings feedback path", () => {
    const home = read("../src/app/page.tsx");
    const account = read("../src/app/account/page.tsx");
    const actions = read("../src/app/actions.ts");

    expect(home).toContain("Welcome to The Units Lab Beta");
    expect(home).toContain('href="/account#feedback"');
    expect(account).toContain('id="feedback"');
    expect(account).toContain("Report a Bug / Send Feedback");
    expect(account).toContain('name="stepsToReproduce"');
    expect(actions).toContain("submit_beta_feedback");
    expect(actions).toContain("APP_VERSION");
  });

  it("documents the real multi-stage import workflow and ships its media asset", () => {
    const tutorial = read("../src/components/import-tutorial.tsx");
    const recorder = read("../scripts/record-import-demo.mjs");
    const migration = read("../supabase/migrations/20261003000000_private_beta_feedback.sql");

    expect(
      existsSync(new URL("../public/help/import-betslip-demo-v0.11.1.webm", import.meta.url)),
    ).toBe(true);
    expect(
      existsSync(new URL("../public/help/import-betslip-demo-v0.11.1.vtt", import.meta.url)),
    ).toBe(true);
    expect(existsSync(new URL("../public/help/import-betslip-demo.webm", import.meta.url))).toBe(
      false,
    );
    expect(existsSync(new URL("../public/help/import-betslip-demo.vtt", import.meta.url))).toBe(
      false,
    );
    expect(tutorial).toContain("import-betslip-demo-v0.11.1.webm");
    expect(tutorial).toContain("import-betslip-demo-v0.11.1.vtt");
    expect(tutorial).not.toContain("import-betslip-demo.webm");
    expect(tutorial.match(/Continue/g)?.length).toBeGreaterThanOrEqual(2);
    expect(tutorial).toContain("canonical event and kickoff");
    expect(tutorial).toContain("Confirm and save the import");
    expect(recorder).toContain('getByRole("button", { name: "Continue" })');
    expect(recorder).toContain("Confirm and save to My Bets");
    expect(migration).toContain("beta_feedback");
    expect(migration).toContain("force row level security");
  });
});
