"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Loader2, LogIn, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamicMap from "next/dynamic";
import BottomSheet from "@/components/BottomSheet";
import SidebarBody, { type SidebarView } from "@/components/Sidebar";
import SearchBar, { type PlaceSuggestion } from "@/components/SearchBar";
import NavDock from "@/components/NavDock";
import IntelligenceDrawer from "@/components/IntelligenceDrawer";
import AuthModal from "@/components/modals/AuthModal";
import ShortcutModal from "@/components/modals/ShortcutModal";
import { useTrips } from "@/hooks/useTrips";
import type { SpotFilter, TravelSpot, Trip, TripDay } from "@/lib/types";

// Firebase
import { auth, db } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import type { MapStyleMode } from "@/components/MapComponent";

const MapComponent = dynamicMap(() => import("@/components/MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-black flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-10 h-10 text-white animate-spin opacity-20" />
      <div className="text-fog text-[10px] font-black uppercase tracking-[0.4em] italic text-center px-10">
        VOYGE Engine Booting
      </div>
    </div>
  ),
});

const FAILURE_MESSAGES: Record<string, string> = {
  weak_signals:
    "This post gave us almost nothing to work with — no caption, location tag, or comments. Try a post with a caption or a tagged location.",
  no_spots_found:
    "We analyzed the post but couldn't pin a real-world place. Try a post that names the spot in its caption or comments.",
  ai_timeout:
    "The analysis timed out before finding a confident location. Give it another try in a moment.",
  scrape_failed:
    "We couldn't read this post — it may be private, removed, or region-locked.",
};

export default function ZenDashboard() {
  const [inputValue, setInputValue] = useState("");
  const [isBloomed, setIsBloomed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyleMode>("dark");
  const [masterSpots, setMasterSpots] = useState<TravelSpot[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<TravelSpot[]>([]);
  const [analysisFailure, setAnalysisFailure] = useState<string | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<unknown>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>("spots");
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<SpotFilter>("all");
  const [activeCategory, setActiveCategory] = useState("All");
  const [linkToken, setLinkToken] = useState("");
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showShortcutInstructions, setShowShortcutInstructions] =
    useState(false);

  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [isAuthVisible, setIsAuthVisible] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState("Disconnected");

  // Trips
  const tripsApi = useTrips(user?.uid || null);
  const [activeTripDay, setActiveTripDay] = useState<{
    tripId: string;
    dayId: string;
  } | null>(null);

  // Structural mobile switch (bottom sheet vs. sidebar) — visual scaling is
  // handled by md: classes, this only picks the layout skeleton.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (inputValue.length < 3 || inputValue.startsWith("http")) {
        setSuggestions([]);
        return;
      }
      setIsSearching(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(inputValue)}`,
        );
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch (e) {
        console.error("Search fail", e);
      } finally {
        setIsSearching(false);
      }
    };

    const timeout = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timeout);
  }, [inputValue]);

  const fetchSpots = useCallback(async (userId: string) => {
    setDbStatus("Syncing Firestore...");
    try {
      const q = query(collection(db, "spots"), where("user_id", "==", userId));
      const querySnapshot = await getDocs(q);
      const spots: TravelSpot[] = [];
      querySnapshot.forEach((d) => {
        spots.push({ id: d.id, ...d.data() } as TravelSpot);
      });

      const sortedSpots = spots.sort(
        (a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0),
      );

      setMasterSpots(sortedSpots);
      if (sortedSpots.length > 0) setIsBloomed(true);
      setDbStatus(`Live: ${sortedSpots.length} spots`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Fetch error:", error);
      setDbStatus(`Error: ${msg}`);
    }
  }, []);

  const handleSearchSelect = async (suggestion: PlaceSuggestion) => {
    setInputValue("");
    setSuggestions([]);
    setIsAnalyzing(true);
    setIsBloomed(true);
    setCurrentAnalysis([]);
    setAnalysisFailure(null);

    try {
      const enhanceRes = await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suggestion.name,
          city: suggestion.city,
          country: suggestion.country,
        }),
      });
      const aiData = await enhanceRes.json();

      const { geocodeSpot } = await import("@/lib/geo");
      const geo = await geocodeSpot(suggestion.name, suggestion.city);

      const newSpot: TravelSpot = {
        name: suggestion.name,
        city: suggestion.city || geo.country,
        country: suggestion.country || geo.country,
        category: aiData.category,
        vibe: aiData.vibe,
        description: aiData.description,
        thumbnail: aiData.thumbnail,
        coordinates: geo.coordinates as [number, number],
        full_address: geo.full_address,
        is_favorite: false,
      };

      setCurrentAnalysis([newSpot]);

      if (user) {
        await addDoc(collection(db, "spots"), {
          ...newSpot,
          user_id: user.uid,
          created_at: serverTimestamp(),
        });
        await fetchSpots(user.uid);
      } else {
        setMasterSpots((prev) => [newSpot, ...prev]);
      }
    } catch (e) {
      console.error("Search selection fail", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const groupedSpots = useMemo(() => {
    let filtered = masterSpots;
    if (activeFilter === "favorites")
      filtered = filtered.filter((s) => s.is_favorite);
    else if (activeFilter === "visited")
      filtered = filtered.filter((s) => s.status === "visited");

    if (activeCategory !== "All") {
      filtered = filtered.filter((s) =>
        s.category?.toLowerCase().includes(activeCategory.toLowerCase()),
      );
    }

    const groups: Record<string, Record<string, TravelSpot[]>> = {};
    filtered.forEach((spot) => {
      const country = spot.country || "Unknown";
      const city = spot.city || "Other";
      if (!groups[country]) groups[country] = {};
      if (!groups[country][city]) groups[country][city] = [];
      groups[country][city].push(spot);
    });
    return groups;
  }, [masterSpots, activeFilter, activeCategory]);

  const toggleFolder = (country: string) => {
    setExpandedFolders((prev) =>
      prev.includes(country)
        ? prev.filter((c) => c !== country)
        : [...prev, country],
    );
  };

  // Bootstrap auth + data
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        fetchSpots(firebaseUser.uid);
        tripsApi.fetchTrips(firebaseUser.uid);

        const userRef = doc(db, "users", firebaseUser.uid);
        const userSnap = await getDocs(
          query(collection(db, "users"), where("uid", "==", firebaseUser.uid)),
        );

        if (userSnap.empty) {
          await setDoc(
            userRef,
            { uid: firebaseUser.uid, email: firebaseUser.email },
            { merge: true },
          );
        } else {
          setTelegramId(userSnap.docs[0].data().telegram_id || null);
        }
      } else {
        setUser(null);
        setMasterSpots([]);
        tripsApi.clearTrips();
        setIsBloomed(false);
        setDbStatus("Logged Out");
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSpots]);

  const generateLinkToken = async () => {
    if (!user) return;
    const token = Math.random().toString(36).substring(2, 8).toUpperCase();
    await updateDoc(doc(db, "users", user.uid), { link_token: token });
    setLinkToken(token);
  };

  const handleAuth = async (
    type: "login" | "signup",
    email: string,
    password: string,
  ) => {
    setAuthLoading(true);
    try {
      if (type === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setIsAuthVisible(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handlePaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const isUrl = inputValue.startsWith("http");
    if (!isUrl) return; // non-URLs resolve through the suggestion dropdown

    setIsAnalyzing(true);
    setIsBloomed(true);
    if (!isMobile) setSidebarVisible(true);
    setCurrentAnalysis([]);
    setAnalysisFailure(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputValue }),
      });
      const data = await response.json();

      if (data.travel_spots && data.travel_spots.length > 0) {
        const proxiedThumbnail = data.thumbnail
          ? `/api/proxy?url=${encodeURIComponent(data.thumbnail)}`
          : null;
        const newSpots: TravelSpot[] = await Promise.all(
          data.travel_spots.map(async (s: TravelSpot) => {
            let thumbnail = proxiedThumbnail;

            if (!thumbnail) {
              try {
                const imgRes = await fetch(
                  `/api/images?query=${encodeURIComponent(s.name + " " + s.city)}`,
                );
                const imgData = await imgRes.json();
                thumbnail = imgData.url;
              } catch (imgErr) {
                console.error("Image fetch fail", imgErr);
              }
            }

            return {
              ...s,
              thumbnail: thumbnail || undefined,
              original_link: inputValue,
              is_favorite: false,
            };
          }),
        );

        setCurrentAnalysis(newSpots);

        if (user) {
          for (const spot of newSpots) {
            await addDoc(collection(db, "spots"), {
              ...spot,
              user_id: user.uid,
              created_at: serverTimestamp(),
            });
          }
          await fetchSpots(user.uid);
        } else {
          setMasterSpots((prev) => {
            const uniqueNew = newSpots.filter(
              (ns) => !prev.some((ps) => ps.name === ns.name),
            );
            return [...uniqueNew, ...prev];
          });
        }
      } else {
        setAnalysisFailure(
          FAILURE_MESSAGES[data.failure_reason as string] ||
            data.error ||
            FAILURE_MESSAGES.no_spots_found,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Analysis failed:", error);
      setAnalysisFailure(FAILURE_MESSAGES.scrape_failed);
      setDbStatus(`Save Error: ${msg}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleFavorite = async (spot: TravelSpot) => {
    const next = !spot.is_favorite;
    setMasterSpots((prev) =>
      prev.map((s) => (s === spot ? { ...s, is_favorite: next } : s)),
    );
    if (user && spot.id) {
      await updateDoc(doc(db, "spots", spot.id), { is_favorite: next });
    }
  };

  const toggleVisited = async (spot: TravelSpot) => {
    const next: TravelSpot["status"] =
      spot.status === "visited" ? "wishlist" : "visited";
    setMasterSpots((prev) =>
      prev.map((s) => (s === spot ? { ...s, status: next } : s)),
    );
    if (user && spot.id) {
      await updateDoc(doc(db, "spots", spot.id), { status: next });
    }
  };

  const deleteSpot = async (spot: TravelSpot, _index: number) => {
    if (!window.confirm("Delete this spot?")) return;
    if (spot.id && user) {
      try {
        await deleteDoc(doc(db, "spots", spot.id));
        setMasterSpots((prev) => prev.filter((s) => s.id !== spot.id));
      } catch (error) {
        console.error("Delete error:", error);
      }
    } else {
      setMasterSpots((prev) => prev.filter((s) => s !== spot));
    }
  };

  const deleteFolder = async (country: string, spots: TravelSpot[]) => {
    if (!window.confirm(`Delete all ${spots.length} spots in ${country}?`))
      return;
    if (user) {
      try {
        setDbStatus(`Deleting ${country}...`);
        for (const spot of spots) {
          if (spot.id) await deleteDoc(doc(db, "spots", spot.id));
        }
        setMasterSpots((prev) => prev.filter((s) => s.country !== country));
        setDbStatus(`Deleted ${country}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setDbStatus(`Error: ${msg}`);
      }
    } else {
      setMasterSpots((prev) => prev.filter((s) => s.country !== country));
    }
  };

  const runOptimization = async (spotsToOptimize: TravelSpot[]) => {
    if (spotsToOptimize.length < 2) return;
    setIsOptimizing(true);
    setRouteGeometry(null);
    setActiveTripDay(null);
    try {
      const coords = spotsToOptimize.map((s) => s.coordinates);
      const response = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: coords }),
      });
      const data = await response.json();
      if (data.geometry) {
        setRouteGeometry(data.geometry);
        setIsBloomed(true);
        if (isMobile) setSidebarVisible(false);
      }
    } catch (error) {
      console.error("Optimization failed:", error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const routeDay = async (trip: Trip, day: TripDay, daySpots: TravelSpot[]) => {
    if (daySpots.length < 2 || !trip.id) return;
    await runOptimization(daySpots);
    setActiveTripDay({ tripId: trip.id, dayId: day.id });
  };

  const clearRoute = () => {
    setRouteGeometry(null);
    setActiveTripDay(null);
  };

  const onSpotClick = (spot: TravelSpot) => {
    if (spot.coordinates)
      (
        window as unknown as { flyToSpot?: (lng: number, lat: number) => void }
      ).flyToSpot?.(...spot.coordinates);
    if (isMobile) setSidebarVisible(false);
  };

  // When a trip day is being routed, the map shows only that day's spots so
  // marker numbers match the itinerary order.
  const mapSpots = useMemo(() => {
    if (!activeTripDay) return masterSpots;
    const trip = tripsApi.trips.find((t) => t.id === activeTripDay.tripId);
    const day = trip?.days.find((d) => d.id === activeTripDay.dayId);
    if (!day) return masterSpots;
    const byId = new Map(masterSpots.filter((s) => s.id).map((s) => [s.id!, s]));
    const daySpots = day.spot_ids
      .map((id) => byId.get(id))
      .filter((s): s is TravelSpot => !!s);
    return daySpots.length > 0 ? daySpots : masterSpots;
  }, [activeTripDay, masterSpots, tripsApi.trips]);

  const drawerOpen =
    isBloomed &&
    (isAnalyzing || currentAnalysis.length > 0 || !!analysisFailure);

  const sidebarUser = user
    ? { uid: user.uid, email: user.email || "" }
    : null;

  const sidebarBody = (
    <SidebarBody
      inputValue={inputValue}
      setInputValue={setInputValue}
      handlePaste={handlePaste}
      isAnalyzing={isAnalyzing}
      isSearching={isSearching}
      isFocused={isFocused}
      setIsFocused={setIsFocused}
      suggestions={suggestions}
      handleSearchSelect={handleSearchSelect}
      view={sidebarView}
      setView={setSidebarView}
      isMobile={isMobile}
      onCloseSidebar={() => setSidebarVisible(false)}
      masterSpots={masterSpots}
      groupedSpots={groupedSpots}
      expandedFolders={expandedFolders}
      toggleFolder={toggleFolder}
      activeFilter={activeFilter}
      setActiveFilter={setActiveFilter}
      activeCategory={activeCategory}
      setActiveCategory={setActiveCategory}
      onSpotClick={onSpotClick}
      toggleFavorite={toggleFavorite}
      toggleVisited={toggleVisited}
      deleteSpot={deleteSpot}
      deleteFolder={deleteFolder}
      routeGeometry={routeGeometry}
      clearRoute={clearRoute}
      runOptimization={runOptimization}
      isOptimizing={isOptimizing}
      tripsApi={tripsApi}
      onRouteDay={routeDay}
      onRequestLogin={() => setIsAuthVisible(true)}
      user={sidebarUser}
      dbStatus={dbStatus}
      telegramId={telegramId}
      linkToken={linkToken}
      copied={copied}
      setCopied={setCopied}
      generateLinkToken={generateLinkToken}
      openShortcutInstructions={() => setShowShortcutInstructions(true)}
      fetchSpots={fetchSpots}
    />
  );

  return (
    <div className="fixed inset-0 bg-black text-white font-sans selection:bg-white selection:text-black overflow-hidden touch-none">
      {/* 1. MAP FLOOR (Z-0) */}
      <div
        className={cn(
          "absolute inset-0 z-0 transition-all duration-[2000ms] ease-in-out touch-auto",
          isBloomed ? "opacity-100 scale-100" : "opacity-20 scale-110 grayscale",
        )}
      >
        <MapComponent
          spots={mapSpots}
          routeGeometry={routeGeometry}
          mapStyle={mapStyle}
        />
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/60 via-transparent to-black/60" />
      </div>

      {/* 2. MODALS (Z-200) */}
      <AnimatePresence>
        {showShortcutInstructions && (
          <ShortcutModal
            open
            onClose={() => setShowShortcutInstructions(false)}
            telegramId={telegramId}
          />
        )}
        {isAuthVisible && (
          <AuthModal
            open
            onClose={() => setIsAuthVisible(false)}
            onAuth={handleAuth}
            loading={authLoading}
          />
        )}
      </AnimatePresence>

      {/* 3. TOP NAV (Z-150) */}
      <div className="fixed top-[calc(env(safe-area-inset-top)+1rem)] md:top-8 right-4 md:right-8 z-[150] flex items-center gap-4 pointer-events-none">
        {user ? (
          <div className="flex items-center gap-3 glass specular pl-2 pr-4 py-2 rounded-2xl pointer-events-auto">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 text-[10px] font-black italic text-white/80">
              {user.email?.[0]?.toUpperCase()}
            </div>
            <p className="hidden md:block text-[10px] font-black text-mist uppercase tracking-widest truncate max-w-[100px]">
              {user.email?.split("@")[0]}
            </p>
            <button
              onClick={handleLogout}
              className="text-[9px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-tighter transition-colors px-2 py-2 cursor-pointer"
            >
              Out
            </button>
          </div>
        ) : (
          <button
            aria-label="Sign in"
            onClick={() => setIsAuthVisible(true)}
            className="flex items-center justify-center glass specular text-mist hover:text-white w-11 md:w-12 h-11 md:h-12 rounded-2xl transition-all pointer-events-auto cursor-pointer"
          >
            <LogIn className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 4. SIDEBAR / BOTTOM SHEET (Z-100) */}
      {isMobile ? (
        <BottomSheet
          isOpen={isBloomed && sidebarVisible}
          onClose={() => setSidebarVisible(false)}
        >
          {sidebarBody}
        </BottomSheet>
      ) : (
        <AnimatePresence>
          {isBloomed && sidebarVisible && (
            <motion.aside
              initial={{ x: -400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -400, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 120 }}
              className="fixed left-0 top-0 bottom-0 glass-deep border-r border-white/5 z-[100] flex flex-col px-4 pt-4 pb-2 overflow-hidden shadow-[40px_0_120px_rgba(0,0,0,0.9)] pointer-events-auto w-sidebar rounded-none"
            >
              <button
                aria-label="Hide sidebar"
                onClick={(e) => {
                  e.stopPropagation();
                  setSidebarVisible(false);
                }}
                className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-14 glass-deep rounded-full flex items-center justify-center text-mist hover:text-white transition-all shadow-2xl z-[110] cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              {sidebarBody}
            </motion.aside>
          )}
        </AnimatePresence>
      )}

      {/* 5. FLOATING NAV DOCK (Z-150) — hidden on phones while the drawer or
          sheet is up so nothing stacks in the same corner */}
      <NavDock
        visible={isBloomed && !(isMobile && (drawerOpen || sidebarVisible))}
        mapStyle={mapStyle}
        onMapStyle={setMapStyle}
        sidebarVisible={sidebarVisible}
        activeFilter={activeFilter}
        onOpenSpots={() => {
          setSidebarVisible(true);
          setSidebarView("spots");
          setActiveFilter("all");
        }}
        onOpenFavorites={() => {
          setSidebarVisible(true);
          setSidebarView("spots");
          setActiveFilter("favorites");
        }}
        onNewTrip={() => {
          setSidebarVisible(true);
          setSidebarView("trips");
        }}
      />

      {/* 6. HERO CONTENT (Z-10) */}
      <div
        className={cn(
          "fixed inset-0 z-10 flex flex-col items-center justify-center transition-all duration-[1000ms] pointer-events-none px-4",
          isBloomed && sidebarVisible && !isMobile ? "md:pl-sidebar" : "pl-0",
        )}
      >
        <div className="w-full max-w-2xl flex flex-col items-center gap-8 md:gap-12">
          <AnimatePresence>
            {!isBloomed && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center"
              >
                <div className="inline-flex items-center gap-2 px-4 py-1.5 glass rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-[0.4em] mb-6 md:mb-8 text-white/40">
                  <Sparkles className="w-3 h-3 text-white/60" /> Next-Gen Travel
                </div>
                <h1 className="text-[60px] md:text-[120px] leading-[0.8] font-black tracking-tighter mb-6 md:mb-8 bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/10">
                  VOYGE
                </h1>
                <p className="text-steel text-lg md:text-xl max-w-lg mx-auto leading-relaxed font-bold tracking-tight italic">
                  Your social media saves,{" "}
                  <span className="text-white not-italic">
                    mathematically perfected.
                  </span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!isBloomed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full relative pointer-events-auto"
              >
                <SearchBar
                  variant="hero"
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={handlePaste}
                  isAnalyzing={isAnalyzing}
                  isSearching={isSearching}
                  isFocused={isFocused}
                  onFocusChange={setIsFocused}
                  suggestions={suggestions}
                  onSelect={handleSearchSelect}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 7. INTELLIGENCE DRAWER (Z-150) */}
      <IntelligenceDrawer
        open={drawerOpen}
        isAnalyzing={isAnalyzing}
        spots={currentAnalysis}
        failureMessage={analysisFailure}
        onClose={() => {
          setCurrentAnalysis([]);
          setAnalysisFailure(null);
        }}
      />
    </div>
  );
}
