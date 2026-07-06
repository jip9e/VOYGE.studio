"use client";

import { useCallback, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Trip, TripDay } from "@/lib/types";

function newDayId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Firestore-backed trip CRUD. Trips are auth-only; every mutation is
 * optimistic and rewrites the embedded `days` array (trip docs are small).
 *
 * NOTE: requires a Firestore rule for the `trips` collection mirroring
 * `spots` (user_id scoping). Errors surface through `error`.
 */
export function useTrips(userId: string | null) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchTrips = useCallback(async (uid: string) => {
    try {
      const snap = await getDocs(
        query(collection(db, "trips"), where("user_id", "==", uid)),
      );
      const loaded: Trip[] = [];
      snap.forEach((d) => loaded.push({ id: d.id, ...d.data() } as Trip));
      setTrips(loaded);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Trips] fetch failed:", msg);
      setError(`Trips: ${msg}`);
    }
  }, []);

  const createTrip = useCallback(
    async (name: string): Promise<Trip | null> => {
      if (!userId) return null;
      const trip: Trip = {
        user_id: userId,
        name,
        days: [{ id: newDayId(), title: "Day 1", spot_ids: [] }],
      };
      try {
        const ref = await addDoc(collection(db, "trips"), {
          ...trip,
          created_at: serverTimestamp(),
        });
        const saved = { ...trip, id: ref.id };
        setTrips((prev) => [saved, ...prev]);
        setError(null);
        return saved;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[Trips] create failed:", msg);
        setError(`Trips: ${msg}`);
        return null;
      }
    },
    [userId],
  );

  const mutateTrip = useCallback(
    async (tripId: string, mutate: (trip: Trip) => Trip) => {
      let updated: Trip | undefined;
      setTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          updated = mutate(t);
          return updated;
        }),
      );
      if (!updated) return;
      try {
        await updateDoc(doc(db, "trips", tripId), {
          name: updated.name,
          days: updated.days,
        });
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[Trips] update failed:", msg);
        setError(`Trips: ${msg}`);
      }
    },
    [],
  );

  const renameTrip = useCallback(
    (tripId: string, name: string) =>
      mutateTrip(tripId, (t) => ({ ...t, name })),
    [mutateTrip],
  );

  const deleteTrip = useCallback(async (tripId: string) => {
    setTrips((prev) => prev.filter((t) => t.id !== tripId));
    try {
      await deleteDoc(doc(db, "trips", tripId));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Trips] delete failed:", msg);
      setError(`Trips: ${msg}`);
    }
  }, []);

  const addDay = useCallback(
    (tripId: string) =>
      mutateTrip(tripId, (t) => ({
        ...t,
        days: [
          ...t.days,
          { id: newDayId(), title: `Day ${t.days.length + 1}`, spot_ids: [] },
        ],
      })),
    [mutateTrip],
  );

  const removeDay = useCallback(
    (tripId: string, dayId: string) =>
      mutateTrip(tripId, (t) => ({
        ...t,
        days: t.days.filter((d) => d.id !== dayId),
      })),
    [mutateTrip],
  );

  const renameDay = useCallback(
    (tripId: string, dayId: string, title: string) =>
      mutateTrip(tripId, (t) => ({
        ...t,
        days: t.days.map((d) => (d.id === dayId ? { ...d, title } : d)),
      })),
    [mutateTrip],
  );

  const setDaySpots = useCallback(
    (tripId: string, dayId: string, spotIds: string[]) =>
      mutateTrip(tripId, (t) => ({
        ...t,
        days: t.days.map((d) =>
          d.id === dayId ? { ...d, spot_ids: spotIds } : d,
        ),
      })),
    [mutateTrip],
  );

  const removeSpotFromDay = useCallback(
    (tripId: string, dayId: string, spotId: string) =>
      mutateTrip(tripId, (t) => ({
        ...t,
        days: t.days.map((d) =>
          d.id === dayId
            ? { ...d, spot_ids: d.spot_ids.filter((id) => id !== spotId) }
            : d,
        ),
      })),
    [mutateTrip],
  );

  const clearTrips = useCallback(() => setTrips([]), []);

  return {
    trips,
    tripsError: error,
    fetchTrips,
    createTrip,
    renameTrip,
    deleteTrip,
    addDay,
    removeDay,
    renameDay,
    setDaySpots,
    removeSpotFromDay,
    clearTrips,
  };
}

export type UseTripsReturn = ReturnType<typeof useTrips>;
export type { Trip, TripDay };
