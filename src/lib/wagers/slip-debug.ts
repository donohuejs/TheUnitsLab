import type { SlipSelection } from "@/lib/wagers/slip";

export type SlipDebugAction =
  "ADD" | "REMOVE" | "CLEAR" | "REPLACE" | "SET" | "RECONCILE" | "INITIALIZE" | "HYDRATE" | "NONE";

export type SlipDebugSelection = {
  id: string;
  eventId: string;
  matchup: string;
  selection: string;
};

type SlipDebugMutation = {
  action: SlipDebugAction;
  reason: string;
  beforeCount: number;
  afterCount: number;
  before: SlipDebugSelection[];
  after: SlipDebugSelection[];
  at: string;
};

type SlipDebugNavigation = {
  previousEventId: string | null;
  nextEventId: string | null;
  mechanism: "Link" | "router.push" | "router.replace" | "history" | "other";
  at: string;
};

type SlipDebugCurrentOddsDependency = {
  eventId: string | null;
  bookmakerId: string | null;
  marketType: string | null;
  selection: string | null;
  source: "current odds" | "none";
};

export type SlipDebugSnapshot = {
  enabled: boolean;
  provider: {
    instanceId: string | null;
    mountCount: number;
    mounted: boolean;
  };
  portal: {
    targetExists: boolean;
    targetConnected: boolean;
    targetIdentity: string | null;
    targetVersion: number;
  };
  durableStraight: SlipDebugSelection[];
  renderedStraight: SlipDebugSelection[];
  currentOddsDependency: SlipDebugCurrentOddsDependency;
  lastMutation: SlipDebugMutation | null;
  lastNavigation: SlipDebugNavigation | null;
};

const EMPTY_SNAPSHOT: SlipDebugSnapshot = {
  enabled: false,
  provider: { instanceId: null, mountCount: 0, mounted: false },
  portal: {
    targetExists: false,
    targetConnected: false,
    targetIdentity: null,
    targetVersion: 0,
  },
  durableStraight: [],
  renderedStraight: [],
  currentOddsDependency: {
    eventId: null,
    bookmakerId: null,
    marketType: null,
    selection: null,
    source: "none",
  },
  lastMutation: null,
  lastNavigation: null,
};

let snapshot = EMPTY_SNAPSHOT;
let providerSequence = 0;
let providerMountCount = 0;
let targetSequence = 0;
const targetIdentities = new WeakMap<object, string>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function update(next: Partial<SlipDebugSnapshot>) {
  snapshot = { ...snapshot, ...next };
  notify();
}

function describeSelection(selection: SlipSelection, index: number): SlipDebugSelection {
  const id =
    selection.clientSelectionId ??
    `${selection.eventId}|${selection.bookmakerId}|${selection.marketType}|${selection.selection}|${selection.line ?? ""}|${index}`;
  return {
    id,
    eventId: selection.eventId,
    matchup: selection.event,
    selection: `${selection.selectionName}${selection.line === null ? "" : ` ${selection.line}`}`,
  };
}

function describeSelections(selections: readonly SlipSelection[]) {
  return selections.map(describeSelection);
}

export function setSlipDebugEnabled(enabled: boolean) {
  if (snapshot.enabled === enabled) return;
  update({ enabled });
}

export function getSlipDebugSnapshot() {
  return snapshot;
}

export function getEmptySlipDebugSnapshot() {
  return EMPTY_SNAPSHOT;
}

export function subscribeToSlipDebug(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerSlipDebugProvider() {
  providerSequence += 1;
  providerMountCount += 1;
  const instanceId = `provider-${providerSequence}`;
  update({ provider: { instanceId, mountCount: providerMountCount, mounted: true } });
  return () => {
    if (snapshot.provider.instanceId !== instanceId) return;
    update({ provider: { ...snapshot.provider, mounted: false } });
  };
}

export function recordSlipDebugPortalTarget(
  target: HTMLElement | null,
  disconnectedTarget?: HTMLElement | null,
) {
  if (!target && disconnectedTarget) {
    const currentIdentity = disconnectedTarget && targetIdentities.get(disconnectedTarget);
    if (currentIdentity && snapshot.portal.targetIdentity !== currentIdentity) return;
  }
  if (target) {
    let identity = targetIdentities.get(target);
    if (!identity) {
      targetSequence += 1;
      identity = `target-${targetSequence}`;
      targetIdentities.set(target, identity);
    }
    update({
      portal: {
        targetExists: true,
        targetConnected: target.isConnected,
        targetIdentity: identity,
        targetVersion: snapshot.portal.targetVersion + 1,
      },
    });
    return;
  }
  update({
    portal: {
      targetExists: false,
      targetConnected: false,
      targetIdentity: null,
      targetVersion: snapshot.portal.targetVersion + 1,
    },
  });
}

export function recordSlipDebugMutation(
  action: SlipDebugAction,
  reason: string,
  before: readonly SlipSelection[],
  after: readonly SlipSelection[],
) {
  if (!snapshot.enabled) return;
  const beforeDescribed = describeSelections(before);
  const afterDescribed = describeSelections(after);
  update({
    durableStraight: afterDescribed,
    lastMutation: {
      action,
      reason,
      beforeCount: beforeDescribed.length,
      afterCount: afterDescribed.length,
      before: beforeDescribed,
      after: afterDescribed,
      at: new Date().toISOString(),
    },
  });
}

export function recordSlipDebugRendered(selections: readonly SlipSelection[]) {
  if (!snapshot.enabled) return;
  update({ renderedStraight: describeSelections(selections) });
}

export function recordSlipDebugCurrentOddsDependency(selection: SlipSelection | null) {
  if (!snapshot.enabled) return;
  update({
    currentOddsDependency: selection
      ? {
          eventId: selection.eventId,
          bookmakerId: selection.bookmakerId,
          marketType: selection.marketType,
          selection: selection.selection,
          source: "current odds",
        }
      : {
          eventId: null,
          bookmakerId: null,
          marketType: null,
          selection: null,
          source: "none",
        },
  });
}

export function recordSlipDebugNavigation(
  previousEventId: string | null,
  nextEventId: string | null,
  mechanism: SlipDebugNavigation["mechanism"],
) {
  if (!snapshot.enabled) return;
  update({
    lastNavigation: {
      previousEventId,
      nextEventId,
      mechanism,
      at: new Date().toISOString(),
    },
  });
}
