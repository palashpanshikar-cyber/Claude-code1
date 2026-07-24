import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Search, Settings } from "lucide-react";
import GymCard from "@/components/GymCard";
import PullToRefresh from "@/components/PullToRefresh";
import { fetchGyms } from "@/lib/api";
import { getFavoriteGymId, toggleFavoriteGym } from "@/lib/favorites";

export default function Home() {
  const [gyms, setGyms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [favoriteId, setFavoriteId] = useState(getFavoriteGymId());

  const loadGyms = useCallback(async () => {
    const data = await fetchGyms();
    setGyms(data);
  }, []);

  useEffect(() => {
    loadGyms().finally(() => setLoading(false));
  }, [loadGyms]);

  const filtered = gyms
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
        <PullToRefresh onRefresh={loadGyms}>
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search gyms by name or city..."
              className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {loading ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-60 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">No gyms found.</p>
            </div>
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
        </PullToRefresh>
      </main>
    </div>
  );
}
