"use client";

import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface MapProps {
  spots: any[];
  routeGeometry?: any;
}

export default function MapComponent({ spots, routeGeometry }: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Expose flyTo globally for the sidebar to call
  useEffect(() => {
    (window as any).flyToSpot = (lng: number, lat: number) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 2000 });
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [0, 20],
      zoom: 1.5,
      projection: "globe" as any,
    });

    mapRef.current.on("style.load", () => {
      mapRef.current?.setFog({
        color: "rgb(0, 0, 0)",
        "high-color": "rgb(36, 36, 36)",
        "horizon-blend": 0.02,
        "space-color": "rgb(0, 0, 0)",
        "star-intensity": 0.6,
      });

      // Add source for route
      mapRef.current?.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [],
          },
        },
      });

      // Add layer for route (Vercel Style: Thicker solid white line with glow)
      mapRef.current?.addLayer({
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

      mapRef.current?.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": 3,
          "line-opacity": 1,
        },
      });
    });

    return () => {
      mapRef.current?.remove();
    };
  }, []);

  // Update Route Geometry
  useEffect(() => {
    if (!mapRef.current || !routeGeometry) return;
    const source = mapRef.current.getSource("route") as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData({
        type: "Feature",
        properties: {},
        geometry: routeGeometry,
      });

      // Fit map to route
      const coordinates = routeGeometry.coordinates;
      const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
      for (const coord of coordinates) {
        bounds.extend(coord);
      }
      mapRef.current.fitBounds(bounds, { padding: 100, duration: 2000 });
    }
  }, [routeGeometry]);

  // Update Markers and Bounds
  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (spots.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();

    spots.forEach((spot, index) => {
      if (!spot.coordinates || (spot.coordinates[0] === 0 && spot.coordinates[1] === 0)) return;

      const el = document.createElement("div");
      el.className = "group relative flex items-center justify-center";
      
      // The Marker Pin
      const pin = document.createElement("div");
      pin.className = "w-5 h-5 bg-white rounded-full border-[3px] border-black shadow-[0_0_15px_rgba(255,255,255,0.6)] cursor-pointer hover:scale-125 transition-transform flex items-center justify-center text-[10px] font-black text-black";
      pin.innerText = (index + 1).toString();
      
      el.appendChild(pin);

      const marker = new mapboxgl.Marker(el)
        .setLngLat(spot.coordinates)
        .setPopup(
          new mapboxgl.Popup({ offset: 25, closeButton: false })
            .setHTML(`<div class="p-2 bg-black text-white text-[10px] font-black uppercase tracking-widest rounded-lg border border-[#333]">${spot.name}</div>`)
        )
        .addTo(mapRef.current!);

      markersRef.current.push(marker);
      bounds.extend(spot.coordinates);
    });

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, { padding: 120, maxZoom: 14, duration: 2500 });
    }
  }, [spots]);

  return <div ref={mapContainerRef} className="w-full h-full" />;
}
