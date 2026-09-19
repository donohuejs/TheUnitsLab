"use client";

import { useEffect, useRef, useState } from "react";

export function ImportTutorial() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

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
          onClick={() => setOpen(true)}
        >
          Open import tutorial
        </button>
      </section>

      {open ? (
        <div
          className="import-tutorial-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="import-tutorial-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-tutorial-dialog-title"
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
                onClick={() => setOpen(false)}
              >
                Close tutorial
              </button>
            </div>
            <video controls preload="none" playsInline aria-label="Import Betslip walkthrough">
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
            <ol className="import-tutorial-steps">
              <li>Upload a sportsbook screenshot.</li>
              <li>Let Luna extract a draft, then review and correct every field.</li>
              <li>Confirm the canonical event and kickoff when a match is available.</li>
              <li>Choose a Study or No Study — Personal.</li>
              <li>Confirm the import and open My Bets.</li>
            </ol>
            <p className="muted">
              No autoplay: use the native controls. AI can make mistakes, so verify your pick, line,
              odds, stake, and payout.
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
