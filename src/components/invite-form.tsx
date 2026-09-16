"use client";

import { useActionState } from "react";

import { createInvite, type InviteActionState } from "@/app/actions";

const initialState: InviteActionState = {};

export function InviteForm({ groupId }: { groupId: string }) {
  const [state, formAction, pending] = useActionState(createInvite, initialState);

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
          <p>Share this token securely. It is displayed only in this response.</p>
          <code>{state.token}</code>
          {state.expiresAt ? (
            <p className="muted">Expires {new Date(state.expiresAt).toLocaleString()}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
