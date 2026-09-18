"use client";

export function ImportTutorial() {
  return (
    <details className="card import-tutorial">
      <summary>
        <span>
          <strong>New to importing?</strong>
          <small>Watch a quick example</small>
        </span>
      </summary>
      <div className="import-tutorial-body">
        <video controls preload="none" playsInline aria-label="Import Betslip quick example">
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
          <li>Open Import Betslip and upload a sportsbook screenshot.</li>
          <li>Wait for extraction, then review and correct the draft.</li>
          <li>Choose a Study or No Study — Personal.</li>
          <li>Confirm to add the wager to My Bets.</li>
        </ol>
        <p className="muted">
          AI can make mistakes — verify your pick, line, odds, stake, and payout.
        </p>
      </div>
    </details>
  );
}
