"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Briefcase,
  Check,
  ChevronRight,
  MapPin,
  Pencil,
  Plus,
  Route,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getCountryFlag } from "@/lib/flags";
import { GlassButton, GlassIconButton } from "@/components/glass/Glass";
import type { UseTripsReturn } from "@/hooks/useTrips";
import type { TravelSpot, Trip, TripDay } from "@/lib/types";

interface TripPlannerProps {
  tripsApi: UseTripsReturn;
  spots: TravelSpot[];
  isAuthed: boolean;
  isOptimizing: boolean;
  onRouteDay: (trip: Trip, day: TripDay, spots: TravelSpot[]) => void;
  onRequestLogin: () => void;
}

/**
 * Trip list + day-by-day itinerary editor rendered inside the sidebar.
 * Day routing reuses the existing /api/optimize flow via onRouteDay.
 */
export default function TripPlanner({
  tripsApi,
  spots,
  isAuthed,
  isOptimizing,
  onRouteDay,
  onRequestLogin,
}: TripPlannerProps) {
  const {
    trips,
    tripsError,
    createTrip,
    renameTrip,
    deleteTrip,
    addDay,
    removeDay,
    renameDay,
    setDaySpots,
    removeSpotFromDay,
  } = tripsApi;

  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [newTripName, setNewTripName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [pickerDayId, setPickerDayId] = useState<string | null>(null);

  const spotsById = useMemo(() => {
    const map = new Map<string, TravelSpot>();
    for (const s of spots) if (s.id) map.set(s.id, s);
    return map;
  }, [spots]);

  const openTrip = trips.find((t) => t.id === openTripId) || null;

  if (!isAuthed) {
    return (
      <div className="glass specular rounded-card p-6 text-center pointer-events-auto">
        <Briefcase className="w-8 h-8 mx-auto text-mist mb-3" />
        <p className="text-xs font-black uppercase tracking-widest text-white mb-1">
          Trips need an account
        </p>
        <p className="text-[10px] text-steel font-bold mb-4">
          Sign in to build day-by-day itineraries from your saved spots.
        </p>
        <GlassButton variant="primary" size="md" onClick={onRequestLogin} className="w-full uppercase tracking-widest">
          Sign in
        </GlassButton>
      </div>
    );
  }

  // ── Trip detail view ────────────────────────────────────────────────────
  if (openTrip) {
    return (
      <div className="space-y-3 pointer-events-auto">
        <div className="flex items-center gap-2">
          <GlassIconButton label="Back to trips" size="sm" onClick={() => setOpenTripId(null)}>
            <ArrowLeft className="w-4 h-4" />
          </GlassIconButton>
          {editingName !== null ? (
            <form
              className="flex-1 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingName.trim() && openTrip.id)
                  renameTrip(openTrip.id, editingName.trim());
                setEditingName(null);
              }}
            >
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="flex-1 min-w-0 glass rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest text-white outline-none"
              />
              <GlassIconButton label="Save name" size="sm" type="submit">
                <Check className="w-4 h-4" />
              </GlassIconButton>
            </form>
          ) : (
            <>
              <h3 className="flex-1 text-sm font-black uppercase tracking-widest italic truncate">
                {openTrip.name}
              </h3>
              <GlassIconButton
                label="Rename trip"
                size="sm"
                onClick={() => setEditingName(openTrip.name)}
              >
                <Pencil className="w-3.5 h-3.5" />
              </GlassIconButton>
              <GlassIconButton
                label="Delete trip"
                size="sm"
                onClick={() => {
                  if (window.confirm(`Delete trip "${openTrip.name}"?`) && openTrip.id) {
                    deleteTrip(openTrip.id);
                    setOpenTripId(null);
                  }
                }}
                className="text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </GlassIconButton>
            </>
          )}
        </div>

        {openTrip.days.map((day) => {
          const daySpots = day.spot_ids
            .map((id) => spotsById.get(id))
            .filter((s): s is TravelSpot => !!s);
          return (
            <div key={day.id} className="glass specular rounded-card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <input
                  defaultValue={day.title}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== day.title && openTrip.id)
                      renameDay(openTrip.id, day.id, v);
                  }}
                  className="flex-1 min-w-0 bg-transparent text-[11px] font-black uppercase tracking-widest text-white outline-none border-b border-transparent focus:border-white/20"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    aria-label={`Route ${day.title}`}
                    title={`Route ${day.title}`}
                    disabled={daySpots.length < 2 || isOptimizing}
                    onClick={() => onRouteDay(openTrip, day, daySpots)}
                    className="p-2 text-white/60 hover:text-white transition-all bg-white/10 rounded-lg active:scale-95 disabled:opacity-30 cursor-pointer"
                  >
                    <Route className={cn("w-3.5 h-3.5", isOptimizing && "animate-spin")} />
                  </button>
                  <button
                    aria-label={`Delete ${day.title}`}
                    title={`Delete ${day.title}`}
                    onClick={() => openTrip.id && removeDay(openTrip.id, day.id)}
                    className="p-2 text-red-500/60 hover:text-red-500 transition-all bg-white/10 rounded-lg active:scale-95 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {daySpots.length === 0 ? (
                <p className="text-[9px] text-steel font-bold italic px-1">
                  No spots yet — add some below.
                </p>
              ) : (
                <div className="space-y-1">
                  {daySpots.map((spot, i) => (
                    <div
                      key={spot.id}
                      className="flex items-center gap-2 p-2 rounded-xl bg-white/[0.03] border border-white/5 group"
                    >
                      <span className="w-5 h-5 rounded-md bg-white text-black text-[9px] font-black flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-sm leading-none">{getCountryFlag(spot.country)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-black truncate text-white/90">
                          {spot.name}
                        </p>
                        <p className="text-[8px] text-steel font-bold uppercase tracking-tighter truncate">
                          {spot.city}
                        </p>
                      </div>
                      <button
                        aria-label={`Remove ${spot.name} from ${day.title}`}
                        title="Remove from day"
                        onClick={() =>
                          openTrip.id &&
                          spot.id &&
                          removeSpotFromDay(openTrip.id, day.id, spot.id)
                        }
                        className="p-1.5 text-white/30 hover:text-red-400 transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setPickerDayId(pickerDayId === day.id ? null : day.id)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-white/10 text-[9px] font-black uppercase tracking-widest text-mist hover:text-white hover:border-white/30 transition-all cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Add spots
              </button>

              <AnimatePresence>
                {pickerDayId === day.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-1 pt-1">
                      {spots.filter((s) => s.id).length === 0 && (
                        <p className="text-[9px] text-steel font-bold italic px-1 py-2">
                          Save some spots first, then assign them to days.
                        </p>
                      )}
                      {spots
                        .filter((s) => s.id)
                        .map((spot) => {
                          const selected = day.spot_ids.includes(spot.id!);
                          return (
                            <button
                              key={spot.id}
                              onClick={() => {
                                if (!openTrip.id) return;
                                const next = selected
                                  ? day.spot_ids.filter((id) => id !== spot.id)
                                  : [...day.spot_ids, spot.id!];
                                setDaySpots(openTrip.id, day.id, next);
                              }}
                              className={cn(
                                "w-full flex items-center gap-2 p-2 rounded-xl border transition-all text-left cursor-pointer",
                                selected
                                  ? "bg-white/10 border-white/20"
                                  : "bg-white/[0.02] border-white/5 hover:bg-white/5",
                              )}
                            >
                              <span
                                className={cn(
                                  "w-4 h-4 rounded-md border flex items-center justify-center shrink-0",
                                  selected
                                    ? "bg-white border-white"
                                    : "border-white/20",
                                )}
                              >
                                {selected && <Check className="w-3 h-3 text-black" />}
                              </span>
                              <MapPin className="w-3 h-3 text-fog shrink-0" />
                              <span className="flex-1 min-w-0 text-[10px] font-black truncate text-white/80">
                                {spot.name}
                              </span>
                              <span className="text-[8px] text-steel font-bold uppercase shrink-0">
                                {spot.city}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        <GlassButton
          variant="glass"
          size="md"
          onClick={() => openTrip.id && addDay(openTrip.id)}
          className="w-full uppercase tracking-widest"
        >
          <Plus className="w-4 h-4" /> Add day
        </GlassButton>

        {tripsError && (
          <p className="text-[9px] text-red-400 font-bold px-1">{tripsError}</p>
        )}
      </div>
    );
  }

  // ── Trip list view ────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 pointer-events-auto">
      {trips.length === 0 && !creating && (
        <div className="glass specular rounded-card p-6 text-center">
          <Briefcase className="w-8 h-8 mx-auto text-mist mb-3" />
          <p className="text-xs font-black uppercase tracking-widest text-white mb-1">
            No trips yet
          </p>
          <p className="text-[10px] text-steel font-bold">
            Group your saved spots into day-by-day itineraries.
          </p>
        </div>
      )}

      {trips.map((trip) => {
        const spotCount = trip.days.reduce(
          (acc, d) => acc + d.spot_ids.filter((id) => spotsById.has(id)).length,
          0,
        );
        return (
          <button
            key={trip.id}
            onClick={() => setOpenTripId(trip.id || null)}
            className="w-full glass specular rounded-card p-4 flex items-center gap-3 text-left hover:bg-white/[0.06] transition-all cursor-pointer"
          >
            <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-white/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black uppercase tracking-widest truncate text-white">
                {trip.name}
              </p>
              <p className="text-[9px] text-steel font-bold uppercase tracking-tighter mt-0.5">
                {trip.days.length} {trip.days.length === 1 ? "day" : "days"} ·{" "}
                {spotCount} {spotCount === 1 ? "spot" : "spots"}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-white/20 shrink-0" />
          </button>
        );
      })}

      {creating ? (
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = newTripName.trim();
            if (!name) return;
            const trip = await createTrip(name);
            setNewTripName("");
            setCreating(false);
            if (trip?.id) setOpenTripId(trip.id);
          }}
        >
          <input
            autoFocus
            value={newTripName}
            onChange={(e) => setNewTripName(e.target.value)}
            placeholder="Trip name — e.g. Morocco 2026"
            className="flex-1 min-w-0 glass rounded-xl px-4 py-3 text-xs font-black text-white placeholder-fog outline-none"
          />
          <GlassIconButton label="Create trip" size="md" type="submit">
            <Check className="w-4 h-4" />
          </GlassIconButton>
          <GlassIconButton
            label="Cancel"
            size="md"
            type="button"
            onClick={() => setCreating(false)}
          >
            <X className="w-4 h-4" />
          </GlassIconButton>
        </form>
      ) : (
        <GlassButton
          variant="primary"
          size="md"
          onClick={() => setCreating(true)}
          className="w-full uppercase tracking-widest"
        >
          <Plus className="w-4 h-4" /> New trip
        </GlassButton>
      )}

      {tripsError && (
        <p className="text-[9px] text-red-400 font-bold px-1">
          {tripsError}
          {tripsError.toLowerCase().includes("permission") &&
            " — add a Firestore rule for the trips collection."}
        </p>
      )}
    </div>
  );
}
