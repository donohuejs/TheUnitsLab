"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { BrowseBetSlipTarget } from "@/components/browse-bet-slip-host";
import { acquireBodyScrollLock } from "@/lib/ui/scroll-lock";
import {
  getEmptyStraightSlipSnapshot,
  getStraightSlipSnapshot,
  subscribeToStraightSlip,
} from "@/lib/wagers/slip";

export function BrowseOddsDialog({
  activeEventId,
  closeHref,
  openSlip = false,
  notice,
  children,
}: {
  activeEventId: string | null;
  closeHref: string;
  openSlip?: boolean;
  notice?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const marketsRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const [closing, startClosing] = useTransition();
  const [pane, setPane] = useState<{ context: string | null; view: "markets" | "slip" }>({
    context: null,
    view: "markets",
  });
  const picks = useSyncExternalStore(
    subscribeToStraightSlip,
    getStraightSlipSnapshot,
    getEmptyStraightSlipSnapshot,
  );
  const context = JSON.stringify([activeEventId, openSlip, notice]);
  const open = (Boolean(activeEventId) || slipOpen || openSlip) && !closing;
  const view =
    !activeEventId || (openSlip && pane.context !== context)
      ? "slip"
      : pane.context === context
        ? pane.view
        : "markets";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireBodyScrollLock();
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      releaseScrollLock();
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    // A closed dialog has no layout; reset after showModal makes its content scrollable.
    if (open) marketsRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeEventId, open]);

  function close() {
    setSlipOpen(false);
    setPane({ context: null, view: "markets" });
    if (activeEventId || openSlip) startClosing(() => router.replace(closeHref, { scroll: false }));
  }

  return (
    <>
      <button
        className="button browse-slip-launcher"
        type="button"
        aria-haspopup="dialog"
        aria-controls="browse-odds-dialog"
        onClick={() => {
          setPane({ context, view: "slip" });
          setSlipOpen(true);
        }}
      >
        Bet Slip <span className="browse-slip-count">{picks.length}</span>
      </button>
      <dialog
        ref={dialogRef}
        id="browse-odds-dialog"
        className="browse-odds-dialog"
        aria-labelledby="browse-odds-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close();
        }}
      >
        <header className="browse-dialog-header">
          <div>
            <p className="eyebrow">Simulated Vials only</p>
            <h2 id="browse-odds-dialog-title">
              {view === "markets" ? "Game odds" : "Your Bet Slip"}
            </h2>
          </div>
          <button ref={closeButtonRef} type="button" className="button secondary" onClick={close}>
            Back to games <span aria-hidden="true">×</span>
          </button>
        </header>
        <nav className="browse-dialog-tabs" aria-label="Game odds and Bet Slip">
          {activeEventId ? (
            <button
              type="button"
              className={view === "markets" ? "pill active" : "pill"}
              aria-pressed={view === "markets"}
              onClick={() => setPane({ context, view: "markets" })}
            >
              Game odds
            </button>
          ) : null}
          <button
            type="button"
            className={view === "slip" ? "pill active" : "pill"}
            aria-pressed={view === "slip"}
            onClick={() => {
              setPane({ context, view: "slip" });
              setSlipOpen(true);
            }}
          >
            Bet Slip <span aria-live="polite">({picks.length})</span>
          </button>
        </nav>
        <div ref={marketsRef} className="browse-dialog-content" hidden={view !== "markets"}>
          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          {children}
        </div>
        <div className="browse-dialog-content" hidden={view !== "slip"}>
          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          {/* One target stays mounted while switching games, tabs, and opening/closing. */}
          <BrowseBetSlipTarget />
        </div>
      </dialog>
    </>
  );
}
