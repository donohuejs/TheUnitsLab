"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { BetSlip } from "@/components/bet-slip";
import type { SlipSelection } from "@/lib/wagers/slip";

export const BROWSE_BET_SLIP_TARGET_ID = "browse-bet-slip-target";

type BrowseBetSlipProps = {
  selection: SlipSelection | null;
  groups: { id: string; name: string }[];
  initialMobileSheetOpen: boolean;
};

type BrowseBetSlipContextValue = {
  setTarget: (target: HTMLElement | null) => void;
  setProps: (props: BrowseBetSlipProps) => void;
};

const BrowseBetSlipContext = createContext<BrowseBetSlipContextValue | null>(null);

const EMPTY_PROPS: BrowseBetSlipProps = {
  selection: null,
  groups: [],
  initialMobileSheetOpen: false,
};

export function BrowseBetSlipProvider({
  children,
  placementEnabled = true,
}: {
  children: ReactNode;
  placementEnabled?: boolean;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [props, setProps] = useState<BrowseBetSlipProps>(EMPTY_PROPS);
  const contextValue = useMemo(() => ({ setTarget, setProps }), []);

  return (
    <BrowseBetSlipContext.Provider value={contextValue}>
      {children}
      {target
        ? createPortal(<BetSlip {...props} embedded placementEnabled={placementEnabled} />, target)
        : null}
    </BrowseBetSlipContext.Provider>
  );
}

export function BrowseBetSlipBridge(props: BrowseBetSlipProps) {
  const context = useContext(BrowseBetSlipContext);
  if (!context) {
    throw new Error("BrowseBetSlipBridge must be rendered inside BrowseBetSlipProvider.");
  }

  useEffect(() => {
    const target = document.getElementById(BROWSE_BET_SLIP_TARGET_ID);
    if (target) context.setTarget(target);
    context.setProps(props);
  }, [context, props]);

  return null;
}

export function BrowseBetSlipTarget() {
  const context = useContext(BrowseBetSlipContext);
  if (!context) {
    throw new Error("BrowseBetSlipTarget must be rendered inside BrowseBetSlipProvider.");
  }

  const registerTarget = useCallback(
    (target: HTMLDivElement | null) => {
      if (target) context.setTarget(target);
    },
    [context],
  );
  const targetRef = useRef<HTMLDivElement>(null);
  const storageKey = "sportsbook-simulator:browse-bet-slip-scroll";
  const setTargetRef = useCallback(
    (target: HTMLDivElement | null) => {
      targetRef.current = target;
      registerTarget(target);
    },
    [registerTarget],
  );

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    try {
      const saved = Number(window.sessionStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) target.scrollTop = saved;
    } catch {
      // Scroll restoration is an enhancement; the rail remains usable when storage is blocked.
    }
    const saveScroll = () => {
      try {
        window.sessionStorage.setItem(storageKey, String(target.scrollTop));
      } catch {
        // Ignore storage failures without affecting navigation.
      }
    };
    target.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      saveScroll();
      target.removeEventListener("scroll", saveScroll);
    };
  }, [storageKey]);

  return (
    <div
      ref={setTargetRef}
      id={BROWSE_BET_SLIP_TARGET_ID}
      className="browse-bet-slip-target"
      aria-label="Simulated bet slips"
    />
  );
}
