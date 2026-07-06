/**
 * Shared UI-facing data models.
 *
 * `TravelSpot` mirrors the Firestore `spots` document shape; `Trip` mirrors
 * the `trips` collection. Optional fields follow the existing convention of
 * being absent (not null) on older documents.
 */

export interface TravelSpot {
  id?: string;
  name: string;
  city: string;
  country: string;
  category: string;
  vibe: string;
  /** [lng, lat] — Mapbox order */
  coordinates: [number, number];
  full_address: string;
  thumbnail?: string;
  original_link?: string;
  is_favorite?: boolean;
  description?: string;
  /** Absent means wishlist (default) */
  status?: "visited" | "wishlist";
  user_id?: string;
  created_at?: { seconds?: number };
}

export type SpotFilter = "all" | "favorites" | "visited";

export interface TripDay {
  id: string;
  title: string;
  /** References `spots` document ids — dangling ids are filtered on render */
  spot_ids: string[];
}

export interface Trip {
  id?: string;
  user_id: string;
  name: string;
  /** Ordered day list, embedded in the trip document */
  days: TripDay[];
}
