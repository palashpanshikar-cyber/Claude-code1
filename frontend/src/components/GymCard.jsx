import React from "react";
import { Link } from "react-router-dom";
import { MapPin, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export default function GymCard({ gym, isFavorite, onToggleFavorite }) {
  const open = gym.open_machines ?? 0;
  const total = gym.total_machines ?? 0;
  const ratio = total > 0 ? open / total : 0;

  return (
    <Link
      to={`/gym/${gym.id}`}
      className="group relative block select-none rounded-2xl border border-border bg-card overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
    >
      <div className="relative h-40 overflow-hidden bg-muted">
        {gym.image_url ? (
          <img
            src={gym.image_url}
            alt={gym.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-primary/5 to-primary/15" />
        )}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite?.(gym.id);
          }}
          aria-label={isFavorite ? "Remove home gym" : "Set as home gym"}
          aria-pressed={isFavorite}
          className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur hover:scale-105"
        >
          <Star className={cn("h-4 w-4", isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
        </button>
        <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              ratio > 0.3 ? "bg-green-500" : ratio > 0 ? "bg-amber-500" : "bg-red-500"
            )}
          />
          {open}/{total} open
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-1.5">
          <h3 className="font-heading text-base font-semibold tracking-tight">{gym.name}</h3>
          {isFavorite && (
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-600">
              Home gym
            </span>
          )}
        </div>
        {(gym.city || gym.address) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {[gym.address, gym.city].filter(Boolean).join(", ")}
          </p>
        )}
      </div>
    </Link>
  );
}
