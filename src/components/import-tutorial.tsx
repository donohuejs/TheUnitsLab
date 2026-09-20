"use client";

import { useEffect, useRef, useState } from "react";

import { acquireBodyScrollLock } from "@/lib/ui/scroll-lock";

const TUTORIAL_CAPTIONS = [
  [0, 3, "Open Import Betslip and upload a synthetic sportsbook screenshot."],
  [3, 6, "Luna processes the screenshot. Review the extracted draft."],
  [6, 9, "Correct the event, kickoff, market, selection, line, and odds when needed."],
  [9, 12, "Choose Continue to review the market and selection."],
  [12, 15, "Confirm the canonical event and details when available."],
  [15, 18, "Choose Continue, then select a Study or No Study — Personal."],
  [18, 21, "Confirm stake, American odds, and total return, then choose Review draft."],
  [21, 24.5, "Check the final editable summary and choose Confirm and save the import."],
  [24.5, 27.4, "Open My Bets and verify the successful imported wager."],
] as const;

function captionAtTime(currentTime: number) {
  const cue = TUTORIAL_CAPTIONS.find(([start, end]) => currentTime >= start && currentTime < end);
  return cue?.[2] ?? "";
}

export function ImportTutorial() {
  const [open, setOpen] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const [captionText, setCaptionText] = useState<string>(TUTORIAL_CAPTIONS[0][2]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  useEffect(() => {
    if (!open || videoUnavailable) return;
    const video = videoRef.current;
    if (!video) return;

    const hideNativeCaptionOverlay = () => {
      const track = Array.from(video.textTracks).find((candidate) => candidate.kind === "captions");
      if (track) track.mode = "hidden";
    };
    hideNativeCaptionOverlay();
    video.addEventListener("loadedmetadata", hideNativeCaptionOverlay);
    return () => video.removeEventListener("loadedmetadata", hideNativeCaptionOverlay);
  }, [open, videoUnavailable]);

  const openTutorial = () => {
    setVideoUnavailable(false);
    setCaptionText(TUTORIAL_CAPTIONS[0][2]);
    setOpen(true);
  };

  const updateCaption = () => {
    setCaptionText(captionAtTime(videoRef.current?.currentTime ?? 0));
  };

  return (
    <>
      <section className="card import-tutorial" aria-labelledby="import-tutorial-title">
        <p className="eyebrow">New to importing?</p>
        <h2 id="import-tutorial-title">Watch a quick example</h2>
        <p className="muted">
          See the current Import Betslip flow from screenshot upload through the review stages and
          My Bets.
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
                  <li>Open Import Betslip and upload a sportsbook screenshot.</li>
                  <li>Wait while Luna processes the screenshot.</li>
                  <li>Review the extracted wager fields.</li>
                  <li>
                    Correct missing or incorrect event, market, selection, line, and odds values.
                  </li>
                  <li>Choose Continue to move from event review to market review.</li>
                  <li>Review or confirm the canonical event and kickoff details.</li>
                  <li>Choose Continue to move to the economics review.</li>
                  <li>Choose a Study or No Study — Personal.</li>
                  <li>Enter or confirm stake, American odds, and total return.</li>
                  <li>Choose Review draft, then check the final editable summary.</li>
                  <li>Confirm and save the import.</li>
                  <li>Open My Bets and verify the successful imported wager.</li>
                </ol>
              </div>
            ) : (
              <div className="import-tutorial-media">
                <video
                  ref={videoRef}
                  controls
                  preload="metadata"
                  playsInline
                  aria-label="Import Betslip walkthrough"
                  aria-describedby="import-tutorial-caption"
                  onLoadedMetadata={updateCaption}
                  onSeeked={updateCaption}
                  onTimeUpdate={updateCaption}
                  onError={() => setVideoUnavailable(true)}
                >
                  <source src="/help/import-betslip-demo-v0.11.2.webm" type="video/webm" />
                  <track
                    kind="captions"
                    src="/help/import-betslip-demo-v0.11.2.vtt"
                    srcLang="en"
                    label="English captions"
                    default
                  />
                  Your browser does not support the tutorial video. Follow the written steps below.
                </video>
                <div
                  id="import-tutorial-caption"
                  className="import-tutorial-caption"
                  role="region"
                  aria-label="Tutorial captions"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {captionText || "Captions appear here while the video plays."}
                </div>
              </div>
            )}
            <ol className="import-tutorial-steps">
              <li>Open Import Betslip and upload a sportsbook screenshot.</li>
              <li>Luna processes the screenshot; review the extracted wager fields.</li>
              <li>Correct missing or incorrect event, market, selection, line, and odds values.</li>
              <li>Choose Continue through event, market, and economics review stages.</li>
              <li>Confirm the canonical event and kickoff details when available.</li>
              <li>Choose a Study or No Study — Personal.</li>
              <li>Enter or confirm stake, American odds, and total return.</li>
              <li>Choose Review draft and check the final editable summary.</li>
              <li>Confirm and save the import.</li>
              <li>Open My Bets and verify the successful imported wager.</li>
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
