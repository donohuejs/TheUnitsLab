"use client";

import { useEffect, useRef, useState } from "react";

import { acquireBodyScrollLock } from "@/lib/ui/scroll-lock";

export function ImportTutorial() {
  const [open, setOpen] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls]",
      );
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const trigger = triggerRef.current;
    const releaseScrollLock = acquireBodyScrollLock();
    closeRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      releaseScrollLock();
      trigger?.focus();
    };
  }, [open]);

  const openTutorial = () => {
    setVideoUnavailable(false);
    setOpen(true);
  };

  return (
    <>
      <section className="card import-tutorial" aria-labelledby="import-tutorial-title">
        <p className="eyebrow">New to importing?</p>
        <h2 id="import-tutorial-title">Watch a quick example</h2>
        <p className="muted">
          See the current Import Betslip flow from screenshot upload through My Bets.
        </p>
        <button
          ref={triggerRef}
          className="button secondary"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Watch a quick example of importing a betslip"
          onClick={openTutorial}
        >
          Watch a quick example
        </button>
      </section>

      {open ? (
        <div
          className="import-tutorial-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            className="import-tutorial-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-tutorial-dialog-title"
            aria-describedby="import-tutorial-dialog-description"
            tabIndex={-1}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Real current UI walkthrough</p>
                <h2 id="import-tutorial-dialog-title">Import Betslip tutorial</h2>
              </div>
              <button
                ref={closeRef}
                className="text-button"
                type="button"
                aria-label="Close import tutorial"
                onClick={() => setOpen(false)}
              >
                Close tutorial
              </button>
            </div>
            {videoUnavailable ? (
              <div className="import-tutorial-fallback" role="status">
                <strong>Video unavailable in this browser.</strong>
                <p>Follow this short walkthrough of the current Import Betslip flow:</p>
                <ol>
                  <li>Upload a sportsbook screenshot.</li>
                  <li>Let Luna extract a draft, then review and correct every field.</li>
                  <li>Confirm the canonical event and kickoff when a match is available.</li>
                  <li>Choose a Study or No Study — Personal.</li>
                  <li>Confirm the import and open My Bets.</li>
                </ol>
              </div>
            ) : (
              <video
                controls
                preload="metadata"
                playsInline
                aria-label="Import Betslip walkthrough"
                onError={() => setVideoUnavailable(true)}
              >
                <source src="/help/import-betslip-demo.webm" type="video/webm" />
                <track
                  kind="captions"
                  src="/help/import-betslip-demo.vtt"
                  srcLang="en"
                  label="English captions"
                  default
                />
                Your browser does not support the tutorial video. Follow the written steps below.
              </video>
            )}
            <ol className="import-tutorial-steps">
              <li>Upload a sportsbook screenshot.</li>
              <li>Let Luna extract a draft, then review and correct every field.</li>
              <li>Confirm the canonical event and kickoff when a match is available.</li>
              <li>Choose a Study or No Study — Personal.</li>
              <li>Confirm the import and open My Bets.</li>
            </ol>
            <p id="import-tutorial-dialog-description" className="muted">
              No autoplay: use the native controls. AI can make mistakes, so verify your pick, line,
              odds, stake, and payout.
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
