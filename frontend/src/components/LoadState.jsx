import React from "react";
import { AlertCircle, Clock, RefreshCw } from "lucide-react";
import { formatAge } from "@/lib/cache";

// The states that used to all render as the same blank screen: a cold
// host still booting, a failed request, and a genuinely empty list. Each
// one needs a different action from the reader, so each one says so.

export function WakingNotice() {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center">
      <Clock className="mx-auto mb-3 h-6 w-6 animate-pulse text-muted-foreground" />
      <p className="text-sm font-medium">Waking up the server…</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        Free hosting puts the app to sleep when nobody's using it. The first
        load after a quiet spell can take up to a minute. Later loads are
        instant.
      </p>
    </div>
  );
}

export function ErrorState({ onRetry }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-12 text-center">
      <AlertCircle className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">Couldn't reach the server</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        It may still be starting up, or you may be offline.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  );
}

// Shown above data we're not certain is current, so a stale reading is
// never mistaken for a live one — the whole point of the app is trusting
// what it says.
//
// `mode` distinguishes two situations that would otherwise both claim the
// server is unreachable. A request still in flight against a cold host
// hasn't failed yet, and saying it has — for the full minute a free-tier
// wake-up takes — would be its own kind of lying. Only 'failed' offers a
// retry; there is nothing to retry while a request is still running.
export function StaleBanner({ savedAt, mode = "failed", onRetry }) {
  const age = formatAge(savedAt);
  const suffix = mode === "refreshing" ? "refreshing…" : "couldn't reach the server.";
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 px-4 py-2.5">
      <p className="text-xs text-muted-foreground">
        Showing saved data{age ? ` from ${age}` : ""} — {suffix}
      </p>
      {mode === "failed" ? (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      ) : (
        <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="rounded-2xl border border-dashed border-border py-16 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
