import React from "react";
import { Activity, CircleCheck, CircleDot, CircleSlash, Battery, BatteryWarning, Bell, BellRing, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const LOW_BATTERY_THRESHOLD = 20;

const STATUS_CONFIG = {
  open: {
    label: "Open",
    icon: CircleCheck,
    dot: "bg-green-500",
    text: "text-green-600",
    chip: "bg-green-500/10 text-green-700 border-green-500/20",
  },
  busy: {
    label: "In Use",
    icon: CircleDot,
    dot: "bg-amber-500",
    text: "text-amber-600",
    chip: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  },
  offline: {
    label: "Offline",
    icon: CircleSlash,
    dot: "bg-slate-400",
    text: "text-slate-500",
    chip: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  },
};

export default function MachineCard({ machine, isWatched, onToggleWatch, onReport, reportState }) {
  const cfg = STATUS_CONFIG[machine.status] ?? STATUS_CONFIG.offline;
  const Icon = cfg.icon;
  const fromCrowd = machine.status_source === "crowd";

  return (
    <div className="select-none rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            cfg.chip
          )}
        >
          <Icon className={cn("h-5 w-5", cfg.text)} />
        </div>
        <div>
          <h4 className="font-heading text-sm font-semibold leading-tight">{machine.name}</h4>
          <p className="text-xs text-muted-foreground">{machine.machine_type}</p>
          {machine.zone && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">{machine.zone}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {machine.status === "busy" && (
            <button
              onClick={() => onToggleWatch?.(machine.id)}
              aria-label={isWatched ? "Stop notifying when open" : "Notify me when open"}
              aria-pressed={isWatched}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full",
                isWatched ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isWatched ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            </button>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
              cfg.chip
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
            {cfg.label}
          </span>
        </div>
        {/* Attribute the reading. A sensor's timestamp and a stranger's
            recollection deserve different wording — presenting a crowd
            report as a live measurement is the one way this feature could
            make the app less trustworthy rather than more. */}
        {fromCrowd ? (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Users className="h-2.5 w-2.5" />
            said {timeAgo(machine.reported_at)}
          </span>
        ) : (
          machine.last_updated && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Activity className="h-2.5 w-2.5" />
              {timeAgo(machine.last_updated)}
            </span>
          )
        )}
        {machine.battery_pct != null && (
          <span
            className={cn(
              "flex items-center gap-1 text-[10px]",
              machine.battery_pct < LOW_BATTERY_THRESHOLD ? "text-red-600" : "text-muted-foreground"
            )}
          >
            {machine.battery_pct < LOW_BATTERY_THRESHOLD ? (
              <BatteryWarning className="h-2.5 w-2.5" />
            ) : (
              <Battery className="h-2.5 w-2.5" />
            )}
            {machine.battery_pct}%
          </span>
        )}
      </div>
    </div>

      {/* Only offered where it adds something: a machine whose sensor is
          live is already telling the truth continuously, and a person
          tapping a button could only make that worse. */}
      {onReport && machine.status_source !== "sensor" && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <span className="text-[11px] text-muted-foreground">
            {reportState === "sent" ? "Thanks — updated." : "Using it now?"}
          </span>
          <div className="ml-auto flex gap-1.5">
            {/* Named per machine: "In use" alone is indistinguishable from
                the status filter chip of the same name, both to a screen
                reader and to anything else addressing the page by label. */}
            <button
              type="button"
              disabled={reportState === "sending"}
              onClick={() => onReport(machine.id, "busy")}
              aria-label={`Report ${machine.name} as in use`}
              className="inline-flex h-7 items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 text-[11px] font-medium text-amber-700 disabled:opacity-50"
            >
              In use
            </button>
            <button
              type="button"
              disabled={reportState === "sending"}
              onClick={() => onReport(machine.id, "open")}
              aria-label={`Report ${machine.name} as free`}
              className="inline-flex h-7 items-center rounded-full border border-green-500/30 bg-green-500/10 px-3 text-[11px] font-medium text-green-700 disabled:opacity-50"
            >
              It's free
            </button>
          </div>
        </div>
      )}
      {reportState === "too_soon" && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          You just reported this one — try again in a moment.
        </p>
      )}
    </div>
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
