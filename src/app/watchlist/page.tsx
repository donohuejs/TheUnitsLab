import Link from "next/link";
import { redirect } from "next/navigation";

import { stopWatching } from "@/app/watchlist/actions";
import { AppNav } from "@/components/app-nav";
import { KickoffTime } from "@/components/kickoff-time";
import { LocalDateTime } from "@/components/local-date-time";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { getCompetition } from "@/lib/odds/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  americanPrice,
  lineLabel,
  marketLabel,
  movementSummary,
} from "@/lib/watchlist/presentation";
import { getActiveWatchlist } from "@/lib/watchlist/server";

export default async function WatchlistPage() {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth");
  let watches: Awaited<ReturnType<typeof getActiveWatchlist>> = [];
  let watchlistUnavailable = false;
  try {
    watches = await getActiveWatchlist();
  } catch (error) {
    watchlistUnavailable = true;
    const failure = error as { code?: unknown; message?: unknown };
    console.error("[watchlist] Required Watchlist data could not be loaded.", {
      errorCode: typeof failure?.code === "string" ? failure.code : undefined,
      errorMessage:
        typeof failure?.message === "string"
          ? failure.message
          : error instanceof Error
            ? error.message
            : String(error),
    });
  }

  return (
    <main className="shell">
      <AppNav active="watchlist" userId={data.user.id} />
      <header className="account-header">
        <div>
          <p className="eyebrow">Odds movement</p>
          <h1>Watchlist</h1>
          <p className="muted">
            Watch pregame prices before placing a wager. Watching never reserves a line or changes
            your Vials.
          </p>
        </div>
        <Link className="button secondary" href="/sports">
          Browse Odds
        </Link>
      </header>
      {watchlistUnavailable ? (
        <div className="card error-state" role="alert">
          <strong>Watchlist data could not be loaded.</strong>
          <p>Movement history is unavailable right now. Reload the page to try again.</p>
        </div>
      ) : watches.length ? (
        <div className="watchlist-grid">
          {watches.map((watch) => {
            const competition = getCompetition(watch.competitionKey);
            const currentLine = watch.currentAvailable
              ? (watch.currentLine ?? undefined)
              : undefined;
            const currentPrice = watch.currentAvailable
              ? (watch.currentAmericanOdds ?? undefined)
              : undefined;
            const slipQuery = new URLSearchParams({
              event: `${watch.competitionKey}:${watch.providerEventId}`,
              book: watch.bookmakerId,
              market: watch.marketType,
              selection: watch.selection,
              mobileSheet: "1",
            });

            return (
              <article className="card watch-card" key={watch.id}>
                <div className="watch-card-heading">
                  <div>
                    <p className="eyebrow">{competition?.name ?? watch.competitionKey}</p>
                    <h2>
                      {watch.awayTeam} at {watch.homeTeam}
                    </h2>
                    <p className="muted">
                      Starts <KickoffTime value={watch.scheduledStart} />
                    </p>
                  </div>
                  <span className="watching-badge">★ Watching</span>
                </div>
                <p className="watch-market">
                  <strong>{watch.selectionName}</strong> · {marketLabel(watch.marketType)} ·{" "}
                  {watch.bookmakerName}
                </p>
                <div className="watch-prices">
                  <div>
                    <span>Started watching</span>
                    <strong>
                      {lineLabel(watch.initialLine)} ({americanPrice(watch.initialAmericanOdds)})
                    </strong>
                  </div>
                  <div>
                    <span>Current</span>
                    <strong>
                      {watch.currentAvailable && currentPrice !== undefined
                        ? `${lineLabel(watch.currentLine)} (${americanPrice(currentPrice)})`
                        : "Market unavailable"}
                    </strong>
                  </div>
                </div>
                <dl className="watch-movement">
                  <div>
                    <dt>Line movement</dt>
                    <dd>{movementSummary(watch.initialLine, currentLine, lineLabel)}</dd>
                  </div>
                  <div>
                    <dt>Price movement</dt>
                    <dd>
                      {movementSummary(watch.initialAmericanOdds, currentPrice, americanPrice)}
                    </dd>
                  </div>
                  <div>
                    <dt>Watching since</dt>
                    <dd>
                      <LocalDateTime value={watch.createdAt} />
                    </dd>
                  </div>
                  <div>
                    <dt>Most recent observation</dt>
                    <dd>
                      {watch.currentObservedAt ? (
                        <LocalDateTime value={watch.currentObservedAt} />
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="watch-actions">
                  {watch.currentAvailable && currentPrice !== undefined ? (
                    <Link className="button" href={`/sports/${watch.competitionKey}?${slipQuery}`}>
                      Add Current Odds to Bet Slip
                    </Link>
                  ) : (
                    <small className="muted">This market is not currently offered.</small>
                  )}
                  <form action={stopWatching}>
                    <input type="hidden" name="watchId" value={watch.id} />
                    <input type="hidden" name="returnTo" value="/watchlist" />
                    <SubmitButton className="button secondary" pendingLabel="Stopping…">
                      Stop Watching
                    </SubmitButton>
                  </form>
                </div>
                <details className="watch-history">
                  <summary>Movement history ({watch.history.length})</summary>
                  {watch.history.length ? (
                    <ol>
                      {watch.history.map((point, index) => (
                        <li key={`${point.firstSeenAt}-${index}`}>
                          <LocalDateTime value={point.firstSeenAt} /> · {lineLabel(point.line)} (
                          {americanPrice(point.americanOdds)})
                          {new Date(point.firstSeenAt) < new Date(watch.createdAt) ? (
                            <small> · Before you watched</small>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">No movement has been captured yet.</p>
                  )}
                </details>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card empty-state">
          <strong>No markets are currently on your Watchlist.</strong>
          <p>Choose ☆ Watch Odds on a pregame selection in Browse Odds.</p>
          <Link className="button" href="/sports">
            Browse Odds
          </Link>
        </div>
      )}
    </main>
  );
}
