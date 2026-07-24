import React from "react";
import { Activity, CircleCheck, CircleDot, CircleSlash, Battery, BatteryWarning, Bell, BellRing } from "lucide-react";
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

export default function MachineCard({ machine, isWatched, onToggleWatch }) {
  const cfg = STATUS_CONFIG[machine.status] ?? STATUS_CONFIG.offline;
  const Icon = cfg.icon;

  return (
    <div className="flex select-none items-center justify-between rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm">
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
        {machine.last_updated && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Activity className="h-2.5 w-2.5" />
            {timeAgo(machine.last_updated)}
          </span>
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
