"use client";

import { useMemo } from "react";
import { getCountryFlag } from "@/lib/flags";
import type { TravelSpot } from "@/lib/types";

interface StatsPanelProps {
  spots: TravelSpot[];
}

/** Travel progress: visited counts, country flags, and a progress bar. */
export default function StatsPanel({ spots }: StatsPanelProps) {
  const stats = useMemo(() => {
    const allCountries = new Set<string>();
    const visitedCountries = new Set<string>();
    let visitedSpots = 0;
    for (const s of spots) {
      const country = s.country || "Unknown";
      allCountries.add(country);
      if (s.status === "visited") {
        visitedSpots++;
        visitedCountries.add(country);
      }
    }
    const pct =
      spots.length > 0 ? Math.round((visitedSpots / spots.length) * 100) : 0;
    return {
      totalSpots: spots.length,
      visitedSpots,
      totalCountries: allCountries.size,
      visitedCountries: [...visitedCountries],
      pct,
    };
  }, [spots]);

  if (stats.totalSpots === 0) return null;

  return (
    <div className="glass specular rounded-card p-4 mb-3 pointer-events-auto">
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <p className="text-xl font-black italic tracking-tighter text-white leading-none">
            {stats.visitedSpots}
            <span className="text-mist text-xs not-italic font-bold">
              /{stats.totalSpots}
            </span>
          </p>
          <p className="text-[8px] font-black uppercase tracking-widest text-fog mt-1">
            Spots visited
          </p>
        </div>
        <div>
          <p className="text-xl font-black italic tracking-tighter text-white leading-none">
            {stats.visitedCountries.length}
            <span className="text-mist text-xs not-italic font-bold">
              /{stats.totalCountries}
            </span>
          </p>
          <p className="text-[8px] font-black uppercase tracking-widest text-fog mt-1">
            Countries
          </p>
        </div>
        <div>
          <p className="text-xl font-black italic tracking-tighter text-white leading-none">
            {stats.pct}
            <span className="text-mist text-xs not-italic font-bold">%</span>
          </p>
          <p className="text-[8px] font-black uppercase tracking-widest text-fog mt-1">
            Explored
          </p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-white/60 to-white transition-all duration-700"
          style={{ width: `${stats.pct}%` }}
        />
      </div>
      {stats.visitedCountries.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3 text-sm leading-none">
          {stats.visitedCountries.map((c) => (
            <span key={c} title={c}>
              {getCountryFlag(c)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
