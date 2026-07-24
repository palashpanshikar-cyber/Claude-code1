import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Star } from "lucide-react";
import MachineCard from "@/components/MachineCard";
import PullToRefresh from "@/components/PullToRefresh";
import { cn } from "@/lib/utils";
import { fetchGym, fetchMachines, subscribeToUpdates } from "@/lib/api";
import { getFavoriteGymId, toggleFavoriteGym } from "@/lib/favorites";
import { ensureNotificationPermission, notify } from "@/lib/notifications";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "busy", label: "In Use" },
  { key: "offline", label: "Offline" },
];

export default function GymDetail() {
  const { id } = useParams();
  const gymId = Number(id);
  const [gym, setGym] = useState(null);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [zone, setZone] = useState("all");
  const [favoriteId, setFavoriteId] = useState(getFavoriteGymId());
  // The source of truth for "which machines am I watching" is this ref, not
  // React state — deciding whether to fire a notification is a side effect,
  // and side effects must never live inside a setState updater function:
  // React 18 StrictMode intentionally invokes updater functions twice in
  // development to catch exactly that impurity, which double-fired the
  // notification here until this was refactored. `watchedIds` state exists
  // purely to trigger a re-render so the bell icons reflect the ref.
  const watchedIdsRef = useRef(new Set());
  const [watchedIds, setWatchedIds] = useState(() => new Set());

  const loadData = useCallback(async () => {
    const [g, m] = await Promise.all([fetchGym(gymId), fetchMachines(gymId)]);
    setGym(g);
    setMachines(m);
  }, [gymId]);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Live updates over WebSocket, filtered to this gym. Also the trigger
  // point for "notify me when open": fires only while this page is mounted
  // and the WS connection is live — see lib/notifications.js for why this
  // isn't real (works-when-closed) push.
  useEffect(() => {
    const unsubscribe = subscribeToUpdates((updated) => {
      if (updated.gym_id !== gymId) return;
      setMachines((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));

      if (watchedIdsRef.current.has(updated.id) && updated.status === "open") {
        watchedIdsRef.current.delete(updated.id);
        notify("Machine available", `${updated.name} is now open.`);
        setWatchedIds(new Set(watchedIdsRef.current));
      }
    });
    return unsubscribe;
  }, [gymId]);

  const toggleWatch = useCallback(async (machineId) => {
    if (watchedIdsRef.current.has(machineId)) {
      watchedIdsRef.current.delete(machineId);
      setWatchedIds(new Set(watchedIdsRef.current));
      return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) return;
    watchedIdsRef.current.add(machineId);
    setWatchedIds(new Set(watchedIdsRef.current));
  }, []);

  const zones = ["all", ...Array.from(new Set(machines.map((m) => m.zone).filter(Boolean)))];
  const filtered = machines.filter(
    (m) => (filter === "all" || m.status === filter) && (zone === "all" || m.zone === zone)
  );
  const openCount = machines.filter((m) => m.status === "open").length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-3xl px-5 py-6">
          <div className="mb-4 h-8 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="grid gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!gym) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Gym not found.</p>
        <Link to="/" className="text-sm font-medium underline">
          Back to gyms
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header
        className="sticky top-0 z-30 select-none border-b border-border bg-background/95 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-3xl px-5 py-4">
          <Link
            to="/"
            className="mb-3 inline-flex min-h-[44px] select-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All gyms
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-heading text-2xl font-bold tracking-tight">{gym.name}</h1>
                <button
                  onClick={() => setFavoriteId(toggleFavoriteGym(gym.id))}
                  aria-label={favoriteId === gym.id ? "Remove home gym" : "Set as home gym"}
                  aria-pressed={favoriteId === gym.id}
                  className="rounded-full p-1 hover:bg-accent"
                >
                  <Star
                    className={cn(
                      "h-5 w-5",
                      favoriteId === gym.id ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                    )}
                  />
                </button>
              </div>
              {(gym.address || gym.city) && (
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {[gym.address, gym.city].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
            <div className="shrink-0 rounded-xl bg-green-500/10 px-4 py-2 text-center">
              <div className="font-heading text-2xl font-bold text-green-700">{openCount}</div>
              <div className="text-[11px] font-medium text-green-700/80">open now</div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 pb-[env(safe-area-inset-bottom)]">
        <PullToRefresh onRefresh={loadData}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "min-h-[44px] select-none rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {zones.length > 2 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {zones.map((z) => (
                <button
                  key={z}
                  onClick={() => setZone(z)}
                  className={cn(
                    "min-h-[44px] select-none rounded-full px-3 py-2 text-xs font-medium transition-colors",
                    zone === z
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {z === "all" ? "All zones" : z}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">No machines match this filter.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map((m) => (
                <MachineCard
                  key={m.id}
                  machine={m}
                  isWatched={watchedIds.has(m.id)}
                  onToggleWatch={toggleWatch}
                />
              ))}
            </div>
          )}
        </PullToRefresh>
      </main>
    </div>
  );
}
