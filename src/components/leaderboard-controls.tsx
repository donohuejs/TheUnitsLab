"use client";

import { useState, type ReactNode } from "react";

import { InviteForm } from "@/components/invite-form";

type Group = { id: string; name: string };
type Invite = {
  invite_id: string;
  invite_expires_at: string;
  invite_max_uses: number | null;
  invite_use_count: number;
  invite_revoked_at: string | null;
};
type Action = (formData: FormData) => void | Promise<void>;

export function LeaderboardControls({
  groups,
  selectedGroupId,
  category,
  categoryLabel,
  source,
  period,
  categories,
}: {
  groups: Group[];
  selectedGroupId: string;
  category: string;
  categoryLabel: string;
  source: string;
  period: string;
  categories: { value: string; label: string }[];
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  return (
    <section className="leaderboard-controls" aria-label="Leaderboard controls">
      <div className="leaderboard-control-summary">
        <label>
          <span>Study</span>
          <select
            name="group"
            form="leaderboard-group-form"
            defaultValue={selectedGroupId}
            disabled={!groups.length}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <span className="leaderboard-current-filter">
          <small>Ranking</small>
          <strong>{categoryLabel}</strong>
        </span>
        <span className="leaderboard-current-filter desktop-filter-summary">
          <small>Source</small>
          <strong>
            {source === "combined" ? "All" : source === "irl" ? "Imported" : "Simulated"}
          </strong>
        </span>
        <span className="leaderboard-current-filter desktop-filter-summary">
          <small>Period</small>
          <strong>
            {period === "all"
              ? "All-time"
              : period === "week"
                ? "This week"
                : period === "month"
                  ? "This month"
                  : "Season"}
          </strong>
        </span>
        <button
          className="button secondary filters-button"
          type="button"
          onClick={() => setFiltersOpen(true)}
        >
          Filters
        </button>
      </div>
      <form id="leaderboard-group-form" className="sr-only" method="get">
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="period" value={period} />
      </form>
      {filtersOpen ? (
        <dialog className="leaderboard-sheet" open aria-labelledby="leaderboard-filter-title">
          <div className="dialog-surface">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Study Results</p>
                <h2 id="leaderboard-filter-title">Filters</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setFiltersOpen(false)}>
                Close
              </button>
            </div>
            <form method="get" onSubmit={() => setFiltersOpen(false)} className="form-stack">
              <input type="hidden" name="group" value={selectedGroupId} />
              <label>
                Category
                <select name="category" defaultValue={category}>
                  {categories.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source
                <select name="source" defaultValue={source}>
                  <option value="combined">All</option>
                  <option value="simulated">Simulated</option>
                  <option value="irl">Imported</option>
                </select>
              </label>
              <label>
                Period
                <select name="period" defaultValue={period}>
                  <option value="all">All-time</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                  <option value="season">Season</option>
                </select>
              </label>
              <button className="button" type="submit">
                Apply filters
              </button>
            </form>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}

export function ManageGroupDialog({
  selectedGroup,
  memberships,
  invites,
  inviteToken,
  nowIso,
  createGroupAction,
  joinGroupAction,
}: {
  selectedGroup?: Group & { owner_user_id: string };
  memberships: { group_id: string; role: "owner" | "admin" | "member" }[];
  invites: Invite[];
  inviteToken: string;
  nowIso: string;
  createGroupAction: Action;
  joinGroupAction: Action;
}) {
  const [open, setOpen] = useState(false);
  const membership = selectedGroup
    ? memberships.find((item) => item.group_id === selectedGroup.id)
    : undefined;
  const canInvite = Boolean(
    selectedGroup && (membership?.role === "owner" || membership?.role === "admin"),
  );
  return (
    <section className="secondary-group-management" aria-label="Study management">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Secondary actions</p>
          <h2>Study management</h2>
        </div>
        <button className="button secondary" type="button" onClick={() => setOpen(true)}>
          Manage Study
        </button>
      </div>
      <p className="muted">
        Start, join, or share access without pushing Study Results below management forms.
      </p>
      {open ? (
        <dialog className="manage-group-dialog" open aria-labelledby="manage-group-title">
          <div className="dialog-surface">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Study controls</p>
                <h2 id="manage-group-title">Manage Study</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <div className="manage-group-sections">
              <ManageSection title="Start a Study">
                <form action={createGroupAction} className="form-stack">
                  <input type="hidden" name="returnTo" value="/leaderboards" />
                  <label>
                    Study Name
                    <input
                      name="groupName"
                      minLength={2}
                      maxLength={80}
                      placeholder="Study name"
                      required
                    />
                  </label>
                  <button className="button" type="submit">
                    Start Study
                  </button>
                </form>
              </ManageSection>
              <ManageSection title="Join a Study">
                <form action={joinGroupAction} className="form-stack">
                  <input type="hidden" name="returnTo" value="/leaderboards" />
                  <label>
                    Study Invite
                    <input
                      name="inviteToken"
                      minLength={32}
                      maxLength={512}
                      defaultValue={inviteToken}
                      placeholder="Paste invite link or token"
                      required
                    />
                  </label>
                  <button className="button secondary" type="submit">
                    Join Study
                  </button>
                </form>
              </ManageSection>
              {selectedGroup && canInvite ? (
                <ManageSection title="Study Partners / Invite">
                  <p className="muted">
                    Create a reusable Study Invite for {selectedGroup.name}. Authenticated people
                    can use it until expiry or its optional cap.
                  </p>
                  <InviteForm groupId={selectedGroup.id} />
                  {invites.length ? <InviteHistory invites={invites} nowIso={nowIso} /> : null}
                </ManageSection>
              ) : null}
            </div>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}

function ManageSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="manage-group-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function InviteHistory({ invites, nowIso }: { invites: Invite[]; nowIso: string }) {
  return (
    <details className="invite-history-disclosure">
      <summary>Invite history</summary>
      <div className="invite-history" aria-label="Study Invite usage">
        {invites.slice(0, 8).map((invite) => {
          const expired = invite.invite_expires_at <= nowIso;
          const state = invite.invite_revoked_at ? "Revoked" : expired ? "Expired" : "Active";
          return (
            <div className="invite-history-row" key={invite.invite_id}>
              <span>{state}</span>
              <span>
                {invite.invite_use_count} use{invite.invite_use_count === 1 ? "" : "s"} ·{" "}
                {invite.invite_max_uses ? `${invite.invite_max_uses} max` : "Reusable until expiry"}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
