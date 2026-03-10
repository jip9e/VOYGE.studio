/**
 * @fileoverview MapComponent — Interactive Mapbox GL Globe
 *
 * A client-side React component that renders a full-screen Mapbox GL JS map
 * in globe projection, displays numbered spot markers, draws an optional
 * route line, and supports live style switching between three visual modes.
 *
 * ## Map Style Modes — `MapStyleMode`
 *
 * | Value         | Mapbox Style URL                              | Use case                        |
 * |---------------|-----------------------------------------------|---------------------------------|
 * | `"dark"`      | `mapbox://styles/mapbox/dark-v11`             | Default; sleek black UI         |
 * | `"satellite"` | `mapbox://styles/mapbox/satellite-streets-v12`| Aerial imagery with street overlay |
 * | `"outdoors"`  | `mapbox://styles/mapbox/outdoors-v12`         | Terrain + hiking/travel details |
 *
 * The `STYLE_URLS` record maps each mode string to its Mapbox style URL and is
 * used both during initial map creation and whenever `mapStyle` prop changes.
 *
 * ## Style-Switching Mechanism
 *
 * When the `mapStyle` prop changes, the component calls `map.setStyle()` which
 * preserves the camera position but **drops all custom sources and layers**.
 * The component listens for the `"style.load"` event after the style swap and
 * re-applies:
 * 1. `applyFog()` — atmospheric fog appropriate for the new mode
 * 2. `addRouteSource()` — re-adds the `"route"` GeoJSON source and both route
 *    layers (`"route-line-blur"` and `"route-line"`)
 * 3. Current `routeGeometry` — re-injects the active route data so the line
 *    reappears immediately after the style swap
 *
 * ## `applyFog()` Behaviour per Mode
 *
 * - **`"dark"`** — Dense black atmosphere with `star-intensity: 0.6`, giving
 *   the globe a dramatic space-view appearance.
 * - **`"outdoors"`** — Soft blue-sky atmosphere (`color: rgb(180,210,230)`)
 *   with low star intensity, simulating daytime aerial perspective.
 * - **`"satellite"`** — Fog is explicitly removed (`setFog(null)`) because
 *   atmospheric haze hides satellite imagery and degrades readability.
 *
 * ## Route Rendering
 *
 * The route is rendered as two stacked `"line"` layers on a single
 * `"route"` GeoJSON source:
 * - `"route-line-blur"` — wide (6 px), blurred (8), semi-transparent white
 *   glow effect underneath
 * - `"route-line"` — crisp 3 px solid white line on top
 *
 * When `routeGeometry` changes, the component updates the source data and
 * calls `map.fitBounds()` to frame all route coordinates with 100 px padding.
 *
 * ## Markers
 *
 * Each spot in the `spots` prop gets a custom DOM marker — a white circle with
 * a black number (1-based index). Clicking a marker opens a dark popup with
 * the spot name. When spots change, all existing markers are removed and
 * recreated. After adding all markers the map calls `fitBounds()` with 120 px
 * padding (maxZoom 14) to frame all spots.
 *
 * ## Global `flyToSpot` Helper
 *
 * On mount the component registers `window.flyToSpot(lng, lat)` so that the
 * sidebar (or any other component) can programmatically fly the camera to a
 * specific spot without needing a direct React ref to the map instance.
 *
 * ## Props
 *
 * | Prop            | Type            | Default    | Description                          |
 * |-----------------|-----------------|------------|--------------------------------------|
 * | `spots`         | `any[]`         | —          | Array of spot objects with `coordinates` and `name` |
 * | `routeGeometry` | `any`           | `undefined`| GeoJSON LineString geometry for the route overlay |
 * | `mapStyle`      | `MapStyleMode`  | `"dark"`   | Active map visual style              |
 *
 * ## Environment Variables
 *
 * - `NEXT_PUBLIC_MAPBOX_TOKEN` — Required. Mapbox GL public access token.
 *
 * @module components/MapComponent
 */
"use client";

import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

/** The three supported visual map styles. */
export type MapStyleMode = "dark" | "satellite" | "outdoors";

interface MapProps {
  spots: any[];
  routeGeometry?: any;
  mapStyle?: MapStyleMode;
}

/** Mapbox style URL for each `MapStyleMode` value. */
const STYLE_URLS: Record<MapStyleMode, string> = {
  dark: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  outdoors: "mapbox://styles/mapbox/outdoors-v12",
};

/**
 * Applies (or removes) Mapbox atmospheric fog appropriate for the given style mode.
 *
 * - `"dark"`      — Black space-like atmosphere with visible stars.
 * - `"outdoors"`  — Soft blue-sky daytime horizon blend.
 * - `"satellite"` — Fog is removed entirely to keep aerial imagery sharp.
 *
 * @param map  - The Mapbox GL map instance.
 * @param mode - The current style mode.
 */
function applyFog(map: mapboxgl.Map, mode: MapStyleMode) {
  if (mode === "dark") {
    map.setFog({
      color: "rgb(0, 0, 0)",
      "high-color": "rgb(36, 36, 36)",
      "horizon-blend": 0.02,
      "space-color": "rgb(0, 0, 0)",
      "star-intensity": 0.6,
    });
  } else if (mode === "outdoors") {
    map.setFog({
      color: "rgb(180, 210, 230)",
      "high-color": "rgb(100, 160, 210)",
      "horizon-blend": 0.04,
      "space-color": "rgb(10, 20, 50)",
      "star-intensity": 0.3,
    });
  } else {
    // satellite — no fog, it hides the imagery
    try {
      (map as any).setFog(null);
    } catch (_) {}
  }
}

/**
 * Adds the `"route"` GeoJSON source and its two line layers to the map if
 * they do not already exist. Safe to call multiple times (idempotent).
 *
 * Layers added:
 * - `"route-line-blur"` — wide blurred glow underlay
 * - `"route-line"`      — crisp solid line overlay
 *
 * @param map - The Mapbox GL map instance.
 */
function addRouteSource(map: mapboxgl.Map) {
  if (!map.getSource("route")) {
    map.addSource("route", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [] },
      },
    });
  }

  if (!map.getLayer("route-line-blur")) {
    map.addLayer({
      id: "route-line-blur",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#ffffff",
        "line-width": 6,
        "line-blur": 8,
        "line-opacity": 0.4,
      },
    });
  }

  if (!map.getLayer("route-line")) {
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": 3,
        "line-opacity": 1,
      },
    });
  }
}

/**
 * Interactive Mapbox GL globe with spot markers, an optional route line,
 * and live style switching.
 *
 * @param props.spots         - Travel spots to render as numbered markers.
 * @param props.routeGeometry - Optional GeoJSON LineString for the route overlay.
 * @param props.mapStyle      - Visual style mode; defaults to `"dark"`.
 */
export default function MapComponent({
  spots,
  routeGeometry,
  mapStyle = "dark",
}: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const currentStyle = useRef<MapStyleMode>(mapStyle);

  // Expose flyTo globally so the sidebar can call it
  useEffect(() => {
    (window as any).flyToSpot = (lng: number, lat: number) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 2000 });
    };
  }, []);

  // ── Initial map creation ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: STYLE_URLS[mapStyle],
      center: [0, 20],
      zoom: 1.5,
      projection: "globe" as any,
    });

    mapRef.current.on("style.load", () => {
      const map = mapRef.current!;
      applyFog(map, currentStyle.current);
      addRouteSource(map);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Only run once on mount — style changes handled separately below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Style switching ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStyle === currentStyle.current) return;

    currentStyle.current = mapStyle;

    // setStyle keeps the camera position but drops all sources/layers.
    // We re-add them once the new style finishes loading.
    map.setStyle(STYLE_URLS[mapStyle]);

    map.once("style.load", () => {
      applyFog(map, mapStyle);
      addRouteSource(map);

      // Re-inject current routeGeometry if any
      if (routeGeometry) {
        const src = map.getSource("route") as
          | mapboxgl.GeoJSONSource
          | undefined;
        src?.setData({
          type: "Feature",
          properties: {},
          geometry: routeGeometry,
        });
      }
    });
  }, [mapStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Route geometry ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeGeometry) return;

    const trySet = () => {
      const src = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: "Feature",
        properties: {},
        geometry: routeGeometry,
      });

      const coords = routeGeometry.coordinates as [number, number][];
      if (coords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds(coords[0], coords[0]);
        coords.forEach((c) => bounds.extend(c));
        map.fitBounds(bounds, { padding: 100, duration: 2000 });
      }
    };

    if (map.isStyleLoaded()) {
      trySet();
    } else {
      map.once("style.load", trySet);
    }
  }, [routeGeometry]);

  // ── Markers ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (spots.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();

    spots.forEach((spot, index) => {
      if (
        !spot.coordinates ||
        (spot.coordinates[0] === 0 && spot.coordinates[1] === 0)
      )
        return;

      const el = document.createElement("div");
      el.className = "group relative flex items-center justify-center";

      const pin = document.createElement("div");
      pin.className =
        "w-5 h-5 bg-white rounded-full border-[3px] border-black shadow-[0_0_15px_rgba(255,255,255,0.6)] cursor-pointer hover:scale-125 transition-transform flex items-center justify-center text-[10px] font-black text-black";
      pin.innerText = (index + 1).toString();

      el.appendChild(pin);

      const marker = new mapboxgl.Marker(el)
        .setLngLat(spot.coordinates)
        .setPopup(
          new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(
            `<div class="p-2 bg-black text-white text-[10px] font-black uppercase tracking-widest rounded-lg border border-[#333]">${spot.name}</div>`,
          ),
        )
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend(spot.coordinates);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 120, maxZoom: 14, duration: 2500 });
    }
  }, [spots]);

  return <div ref={mapContainerRef} className="w-full h-full" />;
}
