"use client";

import { useActionState, useState, useSyncExternalStore } from "react";

import { createInvite, revokeInvite, type InviteActionState } from "@/app/actions";
import { LocalDateTime } from "@/components/local-date-time";
import { formatInviteCode } from "@/lib/invite-code";

const initialState: InviteActionState = {};

export function InviteForm({ groupId }: { groupId: string }) {
  const [state, formAction, pending] = useActionState(createInvite, initialState);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const inviteUrl = state.token
    ? `${origin}/leaderboards?invite=${encodeURIComponent(state.token)}`
    : "";
  const inviteCode = state.code ? formatInviteCode(state.code) : "";

  async function copyInviteLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setCopiedCode(false);
    } catch {
      setCopiedLink(false);
    }
  }

  async function copyInviteCode() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopiedCode(true);
      setCopiedLink(false);
    } catch {
      setCopiedCode(false);
    }
  }

  return (
    <div className="invite-panel">
      <form action={formAction}>
        <input type="hidden" name="groupId" value={groupId} />
        <label>
          Max uses (optional)
          <input
            name="maxUses"
            type="number"
            min="1"
            max="50"
            placeholder="Reusable until expiry"
          />
        </label>
        <button className="button secondary" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Invite Study Partner"}
        </button>
      </form>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.token ? (
        <div className="token-result" aria-live="polite">
          <p>
            New users can use the invite link. Existing users can also enter the join code from
            Study Management. This invitation can be reused by authenticated people
            {state.maxUses ? ` up to ${state.maxUses} times` : " until it expires"}.
          </p>
          <div className="invite-link-row">
            <label>
              Invite Link
              <input readOnly value={inviteUrl} aria-label="Secure invite link" />
            </label>
            <button className="button secondary" type="button" onClick={copyInviteLink}>
              {copiedLink ? "Copied" : "Copy Invite Link"}
            </button>
          </div>
          {inviteCode ? (
            <div className="invite-code-row">
              <label>
                Join Code
                <input
                  className="invite-code-display"
                  readOnly
                  value={inviteCode}
                  aria-label="Study Invite Code"
                />
              </label>
              <button className="button secondary" type="button" onClick={copyInviteCode}>
                {copiedCode ? "Copied" : "Copy Code"}
              </button>
            </div>
          ) : null}
          <details className="disclosure">
            <summary>Advanced</summary>
            <p className="muted token-fallback">
              Token fallback: <code>{state.token}</code>
            </p>
          </details>
          {state.expiresAt ? (
            <p className="muted">
              Expires <LocalDateTime value={state.expiresAt} />
            </p>
          ) : null}
          {state.inviteId ? (
            <form action={revokeInvite}>
              <input type="hidden" name="inviteId" value={state.inviteId} />
              <button className="button secondary" type="submit">
                Revoke Study Invite
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
