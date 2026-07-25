import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Star } from "lucide-react";
import MachineCard from "@/components/MachineCard";
import PullToRefresh from "@/components/PullToRefresh";
import { EmptyState, ErrorState, StaleBanner, WakingNotice } from "@/components/LoadState";
import { cn } from "@/lib/utils";
import { useCachedResource } from "@/lib/useCachedResource";
import { fetchGym, fetchMachines, subscribeToUpdates, reportMachineStatus } from "@/lib/api";
import { getFavoriteGymId, toggleFavoriteGym } from "@/lib/favorites";
import {
  ensureNotificationPermission,
  notify,
  watchMachinePush,
  unwatchMachinePush,
  fetchPushWatchedMachineIds,
} from "@/lib/notifications";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "busy", label: "In Use" },
  { key: "offline", label: "Offline" },
];

export default function GymDetail() {
  const { id } = useParams();
  const gymId = Number(id);
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
  // Whether real push took the watch. When it did, the server sends the
  // notification and the WebSocket handler below must not also fire one,
  // or a machine freeing up while the tab is open notifies twice.
  const pushWatchedRef = useRef(new Set());
  // Surfaced per machine, because the two kinds of watch make very
  // different promises: one survives closing the browser and one does not.
  // A bell that looks the same either way tells someone they will be
  // notified when they won't be, which is worse than not offering it.
  const [watchModes, setWatchModes] = useState({});

  // A push watch lives on the server, so after a reload the bell would read
  // as off while a notification is still coming. Restore it.
  useEffect(() => {
    let cancelled = false;
    fetchPushWatchedMachineIds().then((ids) => {
      if (cancelled || !ids?.length) return;
      for (const machineId of ids) {
        watchedIdsRef.current.add(machineId);
        pushWatchedRef.current.add(machineId);
      }
      setWatchedIds(new Set(watchedIdsRef.current));
      setWatchModes((prev) => {
        const next = { ...prev };
        for (const machineId of ids) next[machineId] = "push";
        return next;
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Both halves of the page in one cache entry, so a cold start restores
  // the header and the machine list together rather than showing one
  // without the other.
  const loadData = useCallback(async () => {
    const [gym, machines] = await Promise.all([fetchGym(gymId), fetchMachines(gymId)]);
    return { gym, machines };
  }, [gymId]);

  const {
    data,
    savedAt,
    isStale,
    phase,
    error,
    reload,
    setData,
  } = useCachedResource(`gym:${gymId}`, loadData);

  const gym = data?.gym ?? null;
  const machines = data?.machines ?? [];

  // Live updates over WebSocket, filtered to this gym. Also where the
  // fallback notification fires, for machines whose watch is not backed by
  // real push — see lib/notifications.js.
  useEffect(() => {
    const unsubscribe = subscribeToUpdates((updated) => {
      if (updated.gym_id !== gymId) return;
      // Pure updater — the notification side effect below stays outside
      // it deliberately; see the watchedIdsRef comment above.
      setData((prev) =>
        prev
          ? { ...prev, machines: prev.machines.map((m) => (m.id === updated.id ? updated : m)) }
          : prev
      );

      if (watchedIdsRef.current.has(updated.id) && updated.status === "open") {
        // The server already pushed this one; notifying here as well would
        // double up whenever the tab happens to be open.
        const handledByPush = pushWatchedRef.current.has(updated.id);
        watchedIdsRef.current.delete(updated.id);
        pushWatchedRef.current.delete(updated.id);
        if (!handledByPush) notify("Machine available", `${updated.name} is now open.`);
        setWatchedIds(new Set(watchedIdsRef.current));
      }
    });
    return unsubscribe;
  }, [gymId, setData]);

  // Per-machine so two cards can't share one spinner or one error.
  const [reportStates, setReportStates] = useState({});

  const handleReport = useCallback(async (machineId, status) => {
    setReportStates((prev) => ({ ...prev, [machineId]: "sending" }));
    try {
      const updated = await reportMachineStatus(machineId, status);
      // The server also broadcasts this over the WebSocket, but applying
      // the response directly means the card updates even if this client's
      // socket happens to be reconnecting.
      setData((prev) =>
        prev
          ? { ...prev, machines: prev.machines.map((m) => (m.id === updated.id ? updated : m)) }
          : prev
      );
      setReportStates((prev) => ({ ...prev, [machineId]: "sent" }));
    } catch (err) {
      setReportStates((prev) => ({
        ...prev,
        [machineId]: err.code === "TOO_SOON" ? "too_soon" : "failed",
      }));
    }
  }, [setData]);

  const toggleWatch = useCallback(async (machineId) => {
    if (watchedIdsRef.current.has(machineId)) {
      watchedIdsRef.current.delete(machineId);
      if (pushWatchedRef.current.has(machineId)) {
        pushWatchedRef.current.delete(machineId);
        // Best effort: the local bell is already off, and leaving a watch
        // on the server only risks one unwanted notification.
        unwatchMachinePush(machineId).catch(() => {});
      }
      setWatchedIds(new Set(watchedIdsRef.current));
      setWatchModes((prev) => {
        const next = { ...prev };
        delete next[machineId];
        return next;
      });
      return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) return;

    // Try real push first, so the alert survives closing the browser. If
    // the server has no VAPID keys, or this browser won't subscribe, fall
    // through to the WebSocket notification rather than offering nothing —
    // but say which one happened, since only one of them works with the
    // app closed.
    let viaPush = false;
    try {
      viaPush = await watchMachinePush(machineId);
    } catch {
      viaPush = false;
    }

    watchedIdsRef.current.add(machineId);
    if (viaPush) pushWatchedRef.current.add(machineId);
    setWatchedIds(new Set(watchedIdsRef.current));
    setWatchModes((prev) => ({ ...prev, [machineId]: viaPush ? "push" : "local" }));
  }, []);

  const zones = ["all", ...Array.from(new Set(machines.map((m) => m.zone).filter(Boolean)))];
  const filtered = machines.filter(
    (m) => (filter === "all" || m.status === filter) && (zone === "all" || m.zone === zone)
  );
  const openCount = machines.filter((m) => m.status === "open").length;

  // A missing gym is permanent and a failed request isn't, so they get
  // different screens — retrying a 404 would only ever fail again. This
  // comes up in practice on a host without a persistent disk, where a
  // saved link outlives the gym it pointed at.
  if (!gym && error?.code === "NOT_FOUND") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-sm font-medium">Gym not found.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It may have been removed, or the server restarted and lost it.
        </p>
        <Link to="/" className="text-sm font-medium underline">
          Back to gyms
        </Link>
      </div>
    );
  }

  if (!gym) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-3xl px-5 py-6">
          <Link
            to="/"
            className="mb-4 inline-flex min-h-[44px] select-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All gyms
          </Link>
          {phase === "waking" ? (
            <WakingNotice />
          ) : phase === "error" ? (
            <ErrorState onRetry={reload} />
          ) : (
            <>
              <div className="mb-4 h-8 w-40 animate-pulse rounded-lg bg-muted" />
              <div className="grid gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[72px] animate-pulse rounded-xl bg-muted" />
                ))}
              </div>
            </>
          )}
        </div>
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
        <PullToRefresh onRefresh={reload}>
          {isStale && (phase === "error" || phase === "waking") ? (
            <StaleBanner
              savedAt={savedAt}
              mode={phase === "error" ? "failed" : "refreshing"}
              onRetry={reload}
            />
          ) : null}
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
            machines.length === 0 ? (
              <EmptyState
                title="No machines in this gym yet."
                hint="Add them from the admin panel."
              />
            ) : (
              <EmptyState title="No machines match this filter." />
            )
          ) : (
            <div className="grid gap-3">
              {filtered.map((m) => (
                <MachineCard
                  key={m.id}
                  machine={m}
                  isWatched={watchedIds.has(m.id)}
                  watchMode={watchModes[m.id]}
                  onToggleWatch={toggleWatch}
                  onReport={handleReport}
                  reportState={reportStates[m.id]}
                />
              ))}
            </div>
          )}
        </PullToRefresh>
      </main>
    </div>
  );
}
