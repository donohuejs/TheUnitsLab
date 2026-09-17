"use client";

import { useActionState, useState, useSyncExternalStore } from "react";

import { createInvite, type InviteActionState } from "@/app/actions";
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
        <button className="button secondary" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create single-use invite"}
        </button>
      </form>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.token ? (
        <div className="token-result" aria-live="polite">
          <p>Share this expiring invite link securely. The token is single-use.</p>
          <div className="invite-link-row">
            <label>
              Invite link
              <input readOnly value={inviteUrl} aria-label="Secure invite link" />
            </label>
            <button className="button secondary" type="button" onClick={copyInviteLink}>
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </div>
          <p className="muted">
            Token fallback: <code>{state.token}</code>
          </p>
          {state.expiresAt ? (
            <p className="muted">
              Expires <LocalDateTime value={state.expiresAt} />
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
