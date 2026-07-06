"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Compass,
  Folder,
  Globe,
  Heart,
  MapPin,
  Route,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getCountryFlag } from "@/lib/flags";
import SpotRow from "@/components/SpotRow";
import type { SpotFilter, TravelSpot } from "@/lib/types";

export type GroupedSpots = Record<string, Record<string, TravelSpot[]>>;

interface SpotListProps {
  masterSpots: TravelSpot[];
  groupedSpots: GroupedSpots;
  expandedFolders: string[];
  onToggleFolder: (country: string) => void;
  activeFilter: SpotFilter;
  onFilterChange: (filter: SpotFilter) => void;
  onOpenTrips: () => void;
  tripCount: number;
  isOptimizing: boolean;
  onOptimize: (spots: TravelSpot[]) => void;
  onDeleteFolder: (country: string, spots: TravelSpot[]) => void;
  onSpotClick: (spot: TravelSpot) => void;
  onToggleFavorite: (spot: TravelSpot) => void;
  onToggleVisited: (spot: TravelSpot) => void;
  onDeleteSpot: (spot: TravelSpot, index: number) => void;
}

export default function SpotList({
  masterSpots,
  groupedSpots,
  expandedFolders,
  onToggleFolder,
  activeFilter,
  onFilterChange,
  onOpenTrips,
  tripCount,
  isOptimizing,
  onOptimize,
  onDeleteFolder,
  onSpotClick,
  onToggleFavorite,
  onToggleVisited,
  onDeleteSpot,
}: SpotListProps) {
  const navItems = [
    {
      icon: MapPin,
      label: "Master Map",
      id: "all" as const,
      count: masterSpots.length,
    },
    {
      icon: Compass,
      label: "Trips",
      id: "trips" as const,
      count: tripCount,
    },
    {
      icon: Heart,
      label: "Favorites",
      id: "favorites" as const,
      count: masterSpots.filter((s) => s.is_favorite).length,
    },
    {
      icon: CheckCircle2,
      label: "Visited",
      id: "visited" as const,
      count: masterSpots.filter((s) => s.status === "visited").length,
    },
  ];

  return (
    <>
      {navItems.map((item) => (
        <button
          key={item.label}
          onClick={(e) => {
            e.stopPropagation();
            if (item.id === "trips") onOpenTrips();
            else onFilterChange(item.id);
          }}
          className={cn(
            "w-full flex items-center justify-between px-4 py-2.5 rounded-2xl text-sm transition-all group mb-1 cursor-pointer pointer-events-auto",
            item.id === activeFilter
              ? "bg-white text-black shadow-lg"
              : "text-[#a1a1aa] hover:bg-white/5 hover:text-white",
          )}
        >
          <div className="flex items-center gap-3 pointer-events-none">
            <item.icon
              className={cn(
                "w-4 h-4",
                item.id === activeFilter ? "stroke-[3px]" : "stroke-2",
              )}
            />
            <span className="font-bold tracking-tight">{item.label}</span>
          </div>
          <span
            className={cn(
              "text-[10px] font-black px-2 py-0.5 rounded-lg",
              item.id === activeFilter ? "bg-black/10 text-black" : "bg-white/5",
            )}
          >
            {item.count}
          </span>
        </button>
      ))}

      <div className="h-3" />

      <div className="flex items-center justify-between px-4 mb-2">
        <p className="text-[10px] uppercase font-black tracking-[0.2em] text-fog">
          Countries
        </p>
        <Globe className="w-3 h-3 text-fog" />
      </div>

      <div className="space-y-2 pointer-events-auto">
        {Object.entries(groupedSpots).map(([country, cityGroups]) => {
          const allSpotsInCountry = Object.values(cityGroups).flat();
          return (
            <div key={country} className="space-y-1">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onToggleFolder(country)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggleFolder(country);
                  }
                }}
                className="w-full flex items-center justify-between p-3 rounded-card glass hover:bg-white/[0.06] transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg">{getCountryFlag(country)}</span>
                    <Folder
                      className={cn(
                        "w-4 h-4 transition-all shrink-0",
                        expandedFolders.includes(country)
                          ? "fill-white text-white"
                          : "text-steel",
                      )}
                    />
                    <span className="text-xs font-black uppercase tracking-widest truncate max-w-[110px]">
                      {country}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      aria-label={`Route ${country}`}
                      title={`Route ${country}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOptimize(allSpotsInCountry);
                      }}
                      disabled={isOptimizing}
                      className="p-2.5 text-white/60 hover:text-white transition-all bg-white/10 rounded-xl active:scale-95 cursor-pointer"
                    >
                      <Route className="w-3.5 h-3.5" />
                    </button>
                    <button
                      aria-label={`Delete all spots in ${country}`}
                      title={`Delete all spots in ${country}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFolder(country, allSpotsInCountry);
                      }}
                      className="p-2.5 text-red-500/60 hover:text-red-500 transition-all bg-white/10 rounded-xl active:scale-95 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <span className="text-[9px] font-black text-steel bg-white/5 px-2 py-0.5 rounded-md">
                  {allSpotsInCountry.length}
                </span>
              </div>

              <AnimatePresence>
                {expandedFolders.includes(country) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-6 pl-2 md:pl-4 py-4"
                  >
                    {Object.entries(cityGroups).map(([city, spots]) => (
                      <div key={city} className="space-y-2">
                        <div className="flex items-center justify-between pr-2 border-b border-white/5 pb-1 mb-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-fog italic">
                            {city}
                          </p>
                          <span className="text-[8px] font-bold text-white/20">
                            {spots.length}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {spots.map((spot, i) => (
                            <SpotRow
                              key={spot.id || `${spot.name}-${i}`}
                              spot={spot}
                              index={i}
                              onClick={() => onSpotClick(spot)}
                              onToggleFavorite={onToggleFavorite}
                              onToggleVisited={onToggleVisited}
                              onDelete={onDeleteSpot}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </>
  );
}
