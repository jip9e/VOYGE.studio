"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, Heart, Map as MapIcon, MapPin, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapStyleMode } from "@/components/MapComponent";
import type { SpotFilter } from "@/lib/types";

const MAP_STYLES: { mode: MapStyleMode; label: string; emoji: string }[] = [
  { mode: "dark", label: "Dark", emoji: "🌑" },
  { mode: "satellite", label: "Sat", emoji: "🛰" },
  { mode: "outdoors", label: "Topo", emoji: "🏔" },
];

interface NavDockProps {
  visible: boolean;
  mapStyle: MapStyleMode;
  onMapStyle: (mode: MapStyleMode) => void;
  sidebarVisible: boolean;
  activeFilter: SpotFilter;
  onOpenSpots: () => void;
  onOpenFavorites: () => void;
  onNewTrip: () => void;
}

/**
 * Floating bottom dock. On phones the three-segment map-style switcher
 * collapses to a single cycling button so the dock fits a 375px viewport.
 */
export default function NavDock({
  visible,
  mapStyle,
  onMapStyle,
  sidebarVisible,
  activeFilter,
  onOpenSpots,
  onOpenFavorites,
  onNewTrip,
}: NavDockProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = MAP_STYLES.find((s) => s.mode === mapStyle) || MAP_STYLES[0];

  const cycleStyle = () => {
    const idx = MAP_STYLES.findIndex((s) => s.mode === mapStyle);
    onMapStyle(MAP_STYLES[(idx + 1) % MAP_STYLES.length].mode);
  };

  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] md:bottom-8 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="relative"
          >
            {/* Popover menu */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ y: 20, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 20, opacity: 0, scale: 0.9 }}
                  className="absolute bottom-[100px] left-1/2 -translate-x-1/2 w-64 glass-deep specular rounded-panel p-2 shadow-2xl pointer-events-auto overflow-hidden"
                >
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onNewTrip();
                    }}
                    className="w-full flex items-center gap-4 p-4 hover:bg-white/5 transition-colors text-left group cursor-pointer rounded-card"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 group-hover:bg-white/10">
                      <Briefcase className="w-5 h-5 text-pink-500" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-white">
                        Create New Trip
                      </p>
                      <p className="text-[9px] text-steel font-bold">
                        Plan your next adventure
                      </p>
                    </div>
                  </button>
                  <div className="h-px bg-white/5 mx-2" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenSpots();
                    }}
                    className="w-full flex items-center gap-4 p-4 hover:bg-white/5 transition-colors text-left group cursor-pointer rounded-card"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 group-hover:bg-white/10">
                      <MapPin className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-white">
                        Add Spots
                      </p>
                      <p className="text-[9px] text-steel font-bold">
                        Save places you love
                      </p>
                    </div>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2 md:gap-3 glass specular p-2 rounded-panel shadow-glass pointer-events-auto">
              <button
                aria-label="My spots"
                title="My spots"
                onClick={() => {
                  onOpenSpots();
                  setMenuOpen(false);
                }}
                className={cn(
                  "w-11 h-11 md:w-12 md:h-12 rounded-card flex items-center justify-center transition-all cursor-pointer",
                  sidebarVisible && activeFilter === "all"
                    ? "bg-white text-black shadow-glow"
                    : "text-white/40 hover:text-white",
                )}
              >
                <MapIcon className="w-5 h-5" />
              </button>

              {/* Map style — cycle button on phones */}
              <button
                aria-label={`Map style: ${current.label} (tap to change)`}
                title={`Map style: ${current.label}`}
                onClick={cycleStyle}
                className="md:hidden w-11 h-11 rounded-card flex items-center justify-center bg-white/5 text-lg cursor-pointer active:scale-90 transition-all"
              >
                <span aria-hidden>{current.emoji}</span>
              </button>

              {/* Full segmented control from md: up */}
              <div className="hidden md:flex items-center gap-0.5 bg-white/5 rounded-[20px] p-1">
                {MAP_STYLES.map(({ mode, label, emoji }) => (
                  <button
                    key={mode}
                    onClick={() => onMapStyle(mode)}
                    title={label}
                    className={cn(
                      "h-9 px-3 rounded-2xl flex items-center gap-1.5 transition-all text-[10px] font-black uppercase tracking-widest cursor-pointer",
                      mapStyle === mode
                        ? "bg-white text-black shadow-md"
                        : "text-white/30 hover:text-white/70",
                    )}
                  >
                    <span className="text-sm leading-none">{emoji}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <button
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                onClick={() => setMenuOpen(!menuOpen)}
                className={cn(
                  "w-14 h-14 md:w-16 md:h-16 rounded-[28px] flex items-center justify-center shadow-glow hover:scale-110 active:scale-90 transition-all group cursor-pointer",
                  menuOpen
                    ? "bg-black text-white border border-white/20"
                    : "bg-white text-black",
                )}
              >
                {menuOpen ? (
                  <X className="w-7 h-7" />
                ) : (
                  <Plus className="w-7 h-7 stroke-[3px] group-hover:rotate-90 transition-transform" />
                )}
              </button>

              <button
                aria-label="Favorites"
                title="Favorites"
                onClick={() => {
                  onOpenFavorites();
                  setMenuOpen(false);
                }}
                className={cn(
                  "w-11 h-11 md:w-12 md:h-12 rounded-card flex items-center justify-center transition-all cursor-pointer",
                  sidebarVisible && activeFilter === "favorites"
                    ? "bg-white text-black shadow-glow"
                    : "text-white/40 hover:text-white",
                )}
              >
                <Heart className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
