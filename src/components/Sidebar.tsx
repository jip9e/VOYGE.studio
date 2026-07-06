"use client";

import { Check, Copy, Key, Navigation, RefreshCw, Route, Share, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import SearchBar, { type PlaceSuggestion } from "@/components/SearchBar";
import SpotList, { type GroupedSpots } from "@/components/SpotList";
import StatsPanel from "@/components/StatsPanel";
import TripPlanner from "@/components/TripPlanner";
import { GlassChip } from "@/components/glass/Glass";
import type { UseTripsReturn } from "@/hooks/useTrips";
import type { SpotFilter, TravelSpot, Trip, TripDay } from "@/lib/types";

export type SidebarView = "spots" | "trips";

const CATEGORIES = ["All", "Attractions", "Museum", "Parks", "Food"];

export interface SidebarBodyProps {
  // Search
  inputValue: string;
  setInputValue: (v: string) => void;
  handlePaste: (e: React.FormEvent) => void;
  isAnalyzing: boolean;
  isSearching: boolean;
  isFocused: boolean;
  setIsFocused: (v: boolean) => void;
  suggestions: PlaceSuggestion[];
  handleSearchSelect: (s: PlaceSuggestion) => void;
  // View
  view: SidebarView;
  setView: (v: SidebarView) => void;
  isMobile: boolean;
  onCloseSidebar: () => void;
  // Spots
  masterSpots: TravelSpot[];
  groupedSpots: GroupedSpots;
  expandedFolders: string[];
  toggleFolder: (country: string) => void;
  activeFilter: SpotFilter;
  setActiveFilter: (f: SpotFilter) => void;
  activeCategory: string;
  setActiveCategory: (c: string) => void;
  onSpotClick: (spot: TravelSpot) => void;
  toggleFavorite: (spot: TravelSpot) => void;
  toggleVisited: (spot: TravelSpot) => void;
  deleteSpot: (spot: TravelSpot, index: number) => void;
  deleteFolder: (country: string, spots: TravelSpot[]) => void;
  // Routing
  routeGeometry: unknown;
  clearRoute: () => void;
  runOptimization: (spots: TravelSpot[]) => void;
  isOptimizing: boolean;
  // Trips
  tripsApi: UseTripsReturn;
  onRouteDay: (trip: Trip, day: TripDay, spots: TravelSpot[]) => void;
  onRequestLogin: () => void;
  // Account / integrations
  user: { uid: string; email: string } | null;
  dbStatus: string;
  telegramId: string | null;
  linkToken: string;
  copied: boolean;
  setCopied: (v: boolean) => void;
  generateLinkToken: () => void;
  openShortcutInstructions: () => void;
  fetchSpots: (uid: string) => void;
}

/**
 * Shared sidebar body — rendered inside the desktop aside and the mobile
 * bottom sheet. Switches between the spot list and the trip planner.
 */
export default function SidebarBody(props: SidebarBodyProps) {
  const {
    view,
    setView,
    isMobile,
    onCloseSidebar,
    masterSpots,
    activeCategory,
    setActiveCategory,
    routeGeometry,
    clearRoute,
    runOptimization,
    isOptimizing,
    user,
    dbStatus,
  } = props;

  return (
    <>
      <SearchBar
        variant="compact"
        value={props.inputValue}
        onChange={props.setInputValue}
        onSubmit={props.handlePaste}
        isAnalyzing={props.isAnalyzing}
        isSearching={props.isSearching}
        isFocused={props.isFocused}
        onFocusChange={props.setIsFocused}
        suggestions={props.suggestions}
        onSelect={props.handleSearchSelect}
      />

      <div className="flex items-center justify-between px-2 py-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center shadow-glow">
            <Navigation className="text-black w-6 h-6 fill-current" />
          </div>
          <span className="text-2xl font-black uppercase italic tracking-widest text-white">
            Voyge
          </span>
        </div>
        {isMobile && (
          <button
            aria-label="Close"
            onClick={onCloseSidebar}
            className="p-2 text-fog cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        )}
      </div>

      <StatsPanel spots={masterSpots} />

      {view === "spots" && (
        <div className="flex gap-3 mb-3 overflow-x-auto pb-2 custom-scrollbar pointer-events-auto">
          {CATEGORIES.map((cat) => (
            <GlassChip
              key={cat}
              selected={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </GlassChip>
          ))}
        </div>
      )}

      <nav className="space-y-1 flex-1 overflow-y-auto min-h-0 custom-scrollbar pr-2 relative pointer-events-auto">
        {view === "trips" ? (
          <TripPlanner
            tripsApi={props.tripsApi}
            spots={masterSpots}
            isAuthed={!!user}
            isOptimizing={isOptimizing}
            onRouteDay={props.onRouteDay}
            onRequestLogin={props.onRequestLogin}
          />
        ) : (
          <SpotList
            masterSpots={masterSpots}
            groupedSpots={props.groupedSpots}
            expandedFolders={props.expandedFolders}
            onToggleFolder={props.toggleFolder}
            activeFilter={props.activeFilter}
            onFilterChange={props.setActiveFilter}
            onOpenTrips={() => setView("trips")}
            tripCount={props.tripsApi.trips.length}
            isOptimizing={isOptimizing}
            onOptimize={runOptimization}
            onDeleteFolder={props.deleteFolder}
            onSpotClick={props.onSpotClick}
            onToggleFavorite={props.toggleFavorite}
            onToggleVisited={props.toggleVisited}
            onDeleteSpot={props.deleteSpot}
          />
        )}

        {view === "spots" && (
          <>
            <div className="h-3" />
            <div className="px-4 mb-2">
              <p className="text-[10px] uppercase font-black tracking-[0.2em] text-fog mb-2">
                Integrations
              </p>
              <div className="p-4 rounded-card glass flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white/40 mb-1">
                  <Share className="w-3 h-3" />
                  <span className="text-[10px] font-black uppercase">
                    Sync Shortcut
                  </span>
                </div>
                {props.telegramId ? (
                  <button
                    onClick={props.openShortcutInstructions}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black rounded-xl text-[10px] font-black uppercase transition-all hover:scale-[1.02] active:scale-95 shadow-glow cursor-pointer"
                  >
                    Setup Shortcut
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[8px] text-mist font-bold uppercase leading-tight italic">
                      Link your Telegram first to unlock the iPhone Shortcut
                    </p>
                    {props.linkToken ? (
                      <div className="flex items-center justify-between bg-black/60 rounded-lg p-2 border border-white/10">
                        <code className="text-[10px] font-black text-white">
                          {props.linkToken}
                        </code>
                        <button
                          aria-label="Copy link command"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `/link ${props.linkToken}`,
                            );
                            props.setCopied(true);
                            setTimeout(() => props.setCopied(false), 2000);
                          }}
                          className="text-white/40 hover:text-white transition-all p-2 cursor-pointer"
                        >
                          {props.copied ? (
                            <Check className="w-3 h-3 text-green-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={props.generateLinkToken}
                        className="w-full flex items-center justify-center gap-2 py-2.5 glass rounded-xl text-[9px] font-black uppercase transition-all hover:bg-white/10 cursor-pointer"
                      >
                        <Key className="w-3 h-3" /> Get Code
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </nav>

      <div className="mt-2 px-2 space-y-1 pointer-events-auto">
        {routeGeometry ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearRoute();
            }}
            className="w-full bg-white text-black hover:bg-[#e5e5e5] py-4 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-glow active:scale-95 cursor-pointer"
          >
            <X className="w-5 h-5" />
            <span className="text-[11px] font-black uppercase tracking-widest">
              Clear Journey
            </span>
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              runOptimization(masterSpots);
            }}
            disabled={masterSpots.length < 2 || isOptimizing}
            className="w-full bg-white text-black hover:bg-[#e5e5e5] py-4 rounded-2xl flex items-center justify-center gap-3 transition-all disabled:opacity-20 shadow-glow active:scale-95 cursor-pointer"
          >
            <Route className={cn("w-5 h-5", isOptimizing && "animate-spin")} />
            <span className="text-[11px] font-black uppercase tracking-widest">
              {isOptimizing ? "Calculating..." : "Plan All Spots"}
            </span>
          </button>
        )}
        {user && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.fetchSpots(user.uid);
            }}
            className="w-full flex items-center justify-center gap-2 py-2 text-fog hover:text-white transition-all text-[9px] font-black uppercase tracking-widest cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> Sync Firestore
          </button>
        )}
      </div>

      <div className="mt-3 border-t border-white/5 pt-3 flex items-center gap-3 px-2 mb-1 pointer-events-none">
        <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
          <User className="w-5 h-5 text-mist" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold truncate text-white/80">
            {user ? user.email.split("@")[0] : "Guest Account"}
          </p>
          <p
            className={cn(
              "text-[9px] uppercase tracking-tighter font-black transition-all",
              dbStatus.includes("Error") ? "text-red-500" : "text-steel",
            )}
          >
            {dbStatus}
          </p>
        </div>
        <div
          className={cn(
            "w-2 h-2 rounded-full shadow-[0_0_10px]",
            user
              ? "bg-green-500 shadow-green-500/40"
              : "bg-orange-500 shadow-orange-500/40",
          )}
        />
      </div>
    </>
  );
}
