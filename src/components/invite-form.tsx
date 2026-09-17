"use client";

import { useActionState, useState, useSyncExternalStore } from "react";

import { createInvite, revokeInvite, type InviteActionState } from "@/app/actions";
import { LocalDateTime } from "@/components/local-date-time";

const initialState: InviteActionState = {};

export function InviteForm({ groupId }: { groupId: string }) {
  const [state, formAction, pending] = useActionState(createInvite, initialState);
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const inviteUrl = state.token
    ? `${origin}/leaderboards?invite=${encodeURIComponent(state.token)}`
    : "";

  async function copyInviteLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
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
            Share this expiring invite link securely. It can be reused by authenticated people
            {state.maxUses ? ` up to ${state.maxUses} times` : " until it expires"}.
          </p>
          <div className="invite-link-row">
            <label>
              Study Invite
              <input readOnly value={inviteUrl} aria-label="Secure invite link" />
            </label>
            <button className="button secondary" type="button" onClick={copyInviteLink}>
              {copied ? "Copied" : "Copy Study Invite"}
            </button>
          </div>
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
