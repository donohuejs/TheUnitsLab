import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { Patch10HotfixHarness } from "@/components/patch-10-hotfix-harness";

export default function Patch10HotfixPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="shell">
      <AppNav active="sports" userId="patch-10-hotfix-harness" />
      <Patch10HotfixHarness />
      <div aria-hidden="true" style={{ minHeight: "180vh" }} />
    </main>
  );
}
