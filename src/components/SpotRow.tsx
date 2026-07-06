"use client";

import { CheckCircle2, Globe, Heart, MapPin, Trash2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TravelSpot } from "@/lib/types";

interface SpotRowProps {
  spot: TravelSpot;
  index: number;
  onClick: () => void;
  onToggleFavorite: (spot: TravelSpot) => void;
  onToggleVisited: (spot: TravelSpot) => void;
  onDelete: (spot: TravelSpot, index: number) => void;
}

/**
 * A saved-spot card. Actions are always visible on touch devices and appear
 * on hover from md: up.
 */
export default function SpotRow({
  spot,
  index,
  onClick,
  onToggleFavorite,
  onToggleVisited,
  onDelete,
}: SpotRowProps) {
  const visited = spot.status === "visited";

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="group relative flex items-center gap-4 p-3 md:p-4 md:gap-5 rounded-card glass hover:bg-white/[0.06] transition-all cursor-pointer overflow-hidden"
    >
      <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 group-hover:bg-white/10 transition-colors shrink-0">
        <MapPin className="w-5 h-5 md:w-6 md:h-6 text-fog group-hover:text-white transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs md:text-sm font-black truncate tracking-tight text-white/90 group-hover:text-white">
          {spot.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[9px] text-steel font-black uppercase tracking-tighter">
            {spot.category || "Spot"}
          </p>
          <span className="w-1 h-1 bg-white/10 rounded-full" />
          <p className="text-[9px] text-fog font-bold italic truncate">
            {spot.city}
          </p>
          {visited && (
            <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md shrink-0">
              Visited
            </span>
          )}
        </div>
        {spot.description && (
          <p className="text-[9px] md:text-[10px] text-mist mt-1 line-clamp-1 md:line-clamp-2 group-hover:text-white/60 transition-colors leading-tight">
            {spot.description}
          </p>
        )}
      </div>
      <div className="w-16 h-16 md:w-20 md:h-20 rounded-[20px] md:rounded-card overflow-hidden bg-black border border-white/5 flex-shrink-0 relative group-hover:scale-105 transition-transform duration-500">
        {spot.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={spot.thumbnail}
            alt={spot.name}
            className="w-full h-full object-cover grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-white/5 opacity-20">
            <Globe className="w-6 h-6" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
      </div>

      {/* Actions — always tappable on touch, hover-revealed on desktop */}
      <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        <button
          aria-label={visited ? "Mark as wishlist" : "Mark as visited"}
          title={visited ? "Mark as wishlist" : "Mark as visited"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisited(spot);
          }}
          className={cn(
            "p-2 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 transition-all active:scale-125 cursor-pointer",
            visited ? "text-emerald-400" : "text-white/40 hover:text-white",
          )}
        >
          <CheckCircle2 className={cn("w-4 h-4", visited && "fill-emerald-500/20")} />
        </button>
        <button
          aria-label={spot.is_favorite ? "Remove favorite" : "Add favorite"}
          title={spot.is_favorite ? "Remove favorite" : "Add favorite"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(spot);
          }}
          className={cn(
            "p-2 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 transition-all active:scale-125 cursor-pointer",
            spot.is_favorite ? "text-red-500" : "text-white/40 hover:text-white",
          )}
        >
          <Heart className={cn("w-4 h-4", spot.is_favorite && "fill-current")} />
        </button>
        {spot.original_link && (
          <a
            href={spot.original_link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open original post"
            title="Open original post"
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-white/40 hover:text-white transition-all cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        <button
          aria-label="Delete spot"
          title="Delete spot"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(spot, index);
          }}
          className="p-2 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-white/40 hover:text-red-500 transition-all cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
