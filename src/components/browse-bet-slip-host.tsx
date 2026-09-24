"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

export function BrowseBetSlipProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [props, setProps] = useState<BrowseBetSlipProps>(EMPTY_PROPS);
  const contextValue = useMemo(() => ({ setTarget, setProps }), []);

  return (
    <BrowseBetSlipContext.Provider value={contextValue}>
      {children}
      {target ? createPortal(<BetSlip {...props} />, target) : null}
    </BrowseBetSlipContext.Provider>
  );
}

export function BrowseBetSlipBridge(props: BrowseBetSlipProps) {
  const context = useContext(BrowseBetSlipContext);
  if (!context) {
    throw new Error("BrowseBetSlipBridge must be rendered inside BrowseBetSlipProvider.");
  }

  useEffect(() => {
    context.setTarget(document.getElementById(BROWSE_BET_SLIP_TARGET_ID));
  }, [context]);

  useEffect(() => {
    context.setProps(props);
  }, [context, props]);

  return null;
}
