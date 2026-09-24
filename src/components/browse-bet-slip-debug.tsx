"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  getEmptySlipDebugSnapshot,
  getSlipDebugSnapshot,
  recordSlipDebugNavigation,
  subscribeToSlipDebug,
} from "@/lib/wagers/slip-debug";

type Props = {
  activeEventId: string | null;
  activeEventName: string | null;
  deployedCommit: string;
  branch: string;
};

function selectionList(
  selections: readonly {
    id: string;
    eventId: string;
    matchup: string;
    selection: string;
  }[],
) {
  if (!selections.length) return <span>none</span>;
  return (
    <ol className="bet-slip-debug-list">
      {selections.map((selection) => (
        <li key={selection.id}>
          <code>{selection.id}</code> · <code>{selection.eventId}</code> · {selection.matchup} ·{" "}
          {selection.selection}
        </li>
      ))}
    </ol>
  );
}

export function BrowseBetSlipDebug({
  activeEventId,
  activeEventName,
  deployedCommit,
  branch,
}: Props) {
  const snapshot = useSyncExternalStore(
    subscribeToSlipDebug,
    getSlipDebugSnapshot,
    getEmptySlipDebugSnapshot,
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryEventId = searchParams.get("event");
  const previousEventRef = useRef<string | null>(queryEventId);

  useEffect(() => {
    const onPopState = () => {
      const nextEventId = new URL(window.location.href).searchParams.get("event");
      recordSlipDebugNavigation(previousEventRef.current, nextEventId, "history");
      previousEventRef.current = nextEventId;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (!snapshot.enabled) return null;

  const lastMutation = snapshot.lastMutation;
  const lastNavigation = snapshot.lastNavigation;
  const currentOdds = snapshot.currentOddsDependency;
  const route = pathname + (searchParams.toString() ? "?" + searchParams.toString() : "");

  return (
    <details className="bet-slip-debug-panel" open>
      <summary>BET SLIP DEBUG</summary>
      <dl>
        <div>
          <dt>Deployed commit</dt>
          <dd>
            <code>{deployedCommit}</code>
          </dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{branch}</dd>
        </div>
        <div>
          <dt>Active event</dt>
          <dd>
            <code>{activeEventId ?? "none"}</code> {activeEventName ?? ""}
          </dd>
        </div>
        <div>
          <dt>Route / query</dt>
          <dd>
            <code>{route}</code>
            <br />
            event=<code>{queryEventId ?? "none"}</code>
          </dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>
            <code>{snapshot.provider.instanceId ?? "none"}</code> · mounts{" "}
            {snapshot.provider.mountCount} · {snapshot.provider.mounted ? "mounted" : "unmounted"}
          </dd>
        </div>
        <div>
          <dt>Portal target</dt>
          <dd>
            exists={String(snapshot.portal.targetExists)} · connected=
            {String(snapshot.portal.targetConnected)} · identity=
            <code>{snapshot.portal.targetIdentity ?? "none"}</code> · version{" "}
            {snapshot.portal.targetVersion}
          </dd>
        </div>
        <div>
          <dt>Current-odds dependency</dt>
          <dd>
            {currentOdds.source} · event=<code>{currentOdds.eventId ?? "none"}</code> · bookmaker={" "}
            <code>{currentOdds.bookmakerId ?? "none"}</code> · market={" "}
            <code>{currentOdds.marketType ?? "none"}</code> · selection={" "}
            <code>{currentOdds.selection ?? "none"}</code>
          </dd>
        </div>
        <div>
          <dt>STORE straight selections ({snapshot.durableStraight.length})</dt>
          <dd>{selectionList(snapshot.durableStraight)}</dd>
        </div>
        <div>
          <dt>RENDERED straight selections ({snapshot.renderedStraight.length})</dt>
          <dd>{selectionList(snapshot.renderedStraight)}</dd>
        </div>
        <div>
          <dt>Last mutation</dt>
          <dd>
            {lastMutation ? (
              <>
                <code>{lastMutation.action}</code> · {lastMutation.reason} ·{" "}
                {lastMutation.beforeCount} → {lastMutation.afterCount} · {lastMutation.at}
                <br />
                before={lastMutation.before.map((item) => item.id).join(", ") || "none"}
                <br />
                after={lastMutation.after.map((item) => item.id).join(", ") || "none"}
              </>
            ) : (
              "none"
            )}
          </dd>
        </div>
        <div>
          <dt>Last navigation</dt>
          <dd>
            {lastNavigation ? (
              <>
                <code>{lastNavigation.previousEventId ?? "none"}</code> →{" "}
                <code>{lastNavigation.nextEventId ?? "none"}</code> · {lastNavigation.mechanism} ·{" "}
                {lastNavigation.at}
              </>
            ) : (
              "none"
            )}
          </dd>
        </div>
      </dl>
    </details>
  );
}
