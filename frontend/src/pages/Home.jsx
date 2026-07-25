import React, { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Search, Settings } from "lucide-react";
import GymCard from "@/components/GymCard";
import PullToRefresh from "@/components/PullToRefresh";
import { ErrorState, EmptyState, StaleBanner, WakingNotice } from "@/components/LoadState";
import { fetchGyms } from "@/lib/api";
import { useCachedResource } from "@/lib/useCachedResource";
import { getFavoriteGymId, toggleFavoriteGym } from "@/lib/favorites";

export default function Home() {
  const [query, setQuery] = useState("");
  const [favoriteId, setFavoriteId] = useState(getFavoriteGymId());

  const {
    data: gyms,
    savedAt,
    isStale,
    phase,
    reload,
  } = useCachedResource("gyms", fetchGyms);

  const filtered = (gyms ?? [])
    .filter((g) =>
      [g.name, g.city, g.address]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    .sort((a, b) => (a.id === favoriteId ? -1 : b.id === favoriteId ? 1 : 0));

  return (
    <div className="min-h-screen bg-background">
      <header
        className="sticky top-0 z-30 select-none border-b border-border bg-background/80 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-5xl px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-heading text-xl font-bold tracking-tight">GymPulse</h1>
              <p className="text-xs text-muted-foreground">
                Real-time gym machine availability
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 items-center rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground">
                Live
              </span>
              <Link
                to="/admin"
                aria-label="Admin"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6 pb-[env(safe-area-inset-bottom)]">
        <PullToRefresh onRefresh={reload}>
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search gyms by name or city..."
              className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Nothing cached to fall back on, so the wait itself is what
              there is to report. Order matters: a cold host is the common
              case on free hosting and shouldn't be called an error. */}
          {gyms === null && phase === "waking" ? (
            <WakingNotice />
          ) : gyms === null && phase === "error" ? (
            <ErrorState onRetry={reload} />
          ) : gyms === null ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-60 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : (
            <>
              {/* Only once a request has actually failed, or is slow
                  enough that the data on screen is visibly old — not for
                  the brief moment every normal load spends fetching. */}
              {isStale && (phase === "error" || phase === "waking") ? (
                <StaleBanner
                  savedAt={savedAt}
                  mode={phase === "error" ? "failed" : "refreshing"}
                  onRetry={reload}
                />
              ) : null}
              {filtered.length === 0 ? (
                // An empty list means two different things, and which one
                // decides what the reader should do next.
                gyms.length === 0 ? (
                  <EmptyState
                    title="No gyms yet."
                    hint="Add one from the admin panel using the gear icon above."
                  />
                ) : (
                  <EmptyState title={`No gyms match "${query}".`} />
                )
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  {filtered.map((gym) => (
                    <GymCard
                      key={gym.id}
                      gym={gym}
                      isFavorite={gym.id === favoriteId}
                      onToggleFavorite={(id) => setFavoriteId(toggleFavoriteGym(id))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </PullToRefresh>
      </main>
    </div>
  );
}
