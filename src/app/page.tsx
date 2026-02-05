"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, MapPin, Navigation, List, FolderOpen, 
  MoreHorizontal, User, Sparkles, ExternalLink, 
  Compass, Route, Trash2, Heart, ChevronLeft, 
  ChevronRight, LogIn, X, Loader2, RefreshCw,
  Folder, Globe, Menu, Key, Check, Copy, Share
} from "lucide-react";
import { cn } from "@/lib/utils";
import dynamicMap from "next/dynamic";

// Firebase Imports
import { auth, db } from "@/lib/firebase";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
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
  orderBy, 
  serverTimestamp 
} from "firebase/firestore";

const MapComponent = dynamicMap(() => import("@/components/MapComponent"), { 
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#000] flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-10 h-10 text-white animate-spin opacity-20" />
      <div className="text-[#404040] text-[10px] font-black uppercase tracking-[0.4em] italic text-center px-10">VOYGE Engine Booting</div>
    </div>
  )
});

interface TravelSpot {
  id?: string;
  name: string;
  city: string;
  country: string;
  category: string;
  vibe: string;
  coordinates: [number, number];
  full_address: string;
  thumbnail?: string;
  original_link?: string;
  is_favorite?: boolean;
}

export default function ZenDashboard() {
  const [url, setUrl] = useState("");
  const [isBloomed, setIsBloomed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [masterSpots, setMasterSpots] = useState<TravelSpot[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<TravelSpot[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<any>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | "favorites">("all");
  const [linkToken, setLinkToken] = useState("");
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showShortcutInstructions, setShowShortcutInstructions] = useState(false);
  
  // Auth State
  const [user, setUser] = useState<any>(null);
  const [isAuthVisible, setIsAuthVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState("Disconnected");

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const fetchSpots = useCallback(async (userId: string) => {
    setDbStatus("Syncing Firestore...");
    try {
      const q = query(
        collection(db, "spots"), 
        where("user_id", "==", userId)
      );
      const querySnapshot = await getDocs(q);
      const spots: TravelSpot[] = [];
      querySnapshot.forEach((doc) => {
        spots.push({ id: doc.id, ...doc.data() } as TravelSpot);
      });
      
      const sortedSpots = spots.sort((a: any, b: any) => {
        const timeA = a.created_at?.seconds || 0;
        const timeB = b.created_at?.seconds || 0;
        return timeB - timeA;
      });

      setMasterSpots(sortedSpots);
      if (sortedSpots.length > 0) setIsBloomed(true);
      setDbStatus(`Live: ${sortedSpots.length} spots`);
    } catch (error: any) {
      console.error("Fetch error:", error);
      setDbStatus(`Error: ${error.message}`);
    }
  }, []);

  // Groups spots by country
  const groupedSpots = useMemo(() => {
    const filtered = activeFilter === "favorites" 
      ? masterSpots.filter(s => s.is_favorite) 
      : masterSpots;

    const groups: { [key: string]: TravelSpot[] } = {};
    filtered.forEach(spot => {
      const country = spot.country || "Unknown";
      if (!groups[country]) groups[country] = [];
      groups[country].push(spot);
    });
    return groups;
  }, [masterSpots, activeFilter]);

  const toggleFolder = (country: string) => {
    setExpandedFolders(prev => 
      prev.includes(country) ? prev.filter(c => c !== country) : [...prev, country]
    );
  };

  // 1. BOOTSTRAP: Load Auth and Spots
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        fetchSpots(firebaseUser.uid);
        
        // Ensure user doc exists and get telegram ID
        const userRef = doc(db, "users", firebaseUser.uid);
        const userSnap = await getDocs(query(collection(db, "users"), where("uid", "==", firebaseUser.uid)));
        
        if (userSnap.empty) {
          await setDoc(userRef, { uid: firebaseUser.uid, email: firebaseUser.email }, { merge: true });
        } else {
          setTelegramId(userSnap.docs[0].data().telegram_id || null);
        }
      } else {
        setUser(null);
        setMasterSpots([]);
        setIsBloomed(false);
        setDbStatus("Logged Out");
      }
    });

    return () => unsubscribe();
  }, [fetchSpots]);

  const generateLinkToken = async () => {
    if (!user) return;
    const token = Math.random().toString(36).substring(2, 8).toUpperCase();
    await updateDoc(doc(db, "users", user.uid), { link_token: token });
    setLinkToken(token);
  };

  const handleAuth = async (type: "login" | "signup") => {
    setAuthLoading(true);
    try {
      if (type === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setIsAuthVisible(false);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  // 2. THE ANALYZER
  const handlePaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsAnalyzing(true);
    setIsBloomed(true);
    if (!isMobile) setSidebarVisible(true);
    setCurrentAnalysis([]);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      
      if (data.travel_spots) {
        const proxiedThumbnail = data.thumbnail ? `/api/proxy?url=${encodeURIComponent(data.thumbnail)}` : null;
        const newSpots = data.travel_spots.map((s: any) => ({
          ...s,
          thumbnail: proxiedThumbnail,
          original_link: url,
          is_favorite: false
        }));

        setCurrentAnalysis(newSpots);
        
        // Database save
        if (user) {
          for (const spot of newSpots) {
            await addDoc(collection(db, "spots"), {
              ...spot,
              user_id: user.uid,
              created_at: serverTimestamp()
            });
          }
          await fetchSpots(user.uid);
        } else {
          setMasterSpots((prev) => {
            const uniqueNew = newSpots.filter((ns: any) => !prev.some(ps => ps.name === ns.name));
            return [...uniqueNew, ...prev];
          });
        }
      }
    } catch (error: any) {
      console.error("Analysis failed:", error);
      setDbStatus(`Save Error: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleFavorite = async (id: string, currentState: boolean) => {
    if (user) {
      const spotRef = doc(db, "spots", id);
      await updateDoc(spotRef, { is_favorite: !currentState });
      setMasterSpots(prev => prev.map(s => s.id === id ? { ...s, is_favorite: !currentState } : s));
    }
  };

  const deleteSpot = async (id?: string, index?: number) => {
    if (!window.confirm("Delete this spot?")) return;
    if (id && user) {
      try {
        await deleteDoc(doc(db, "spots", id));
        setMasterSpots(prev => prev.filter(s => s.id !== id));
      } catch (error) {
        console.error("Delete error:", error);
      }
    } else {
      setMasterSpots(prev => prev.filter((_, i) => i !== index));
    }
  };

  const deleteFolder = async (country: string, spots: TravelSpot[]) => {
    if (!window.confirm(`Delete all ${spots.length} spots in ${country}?`)) return;
    if (user) {
      try {
        setDbStatus(`Deleting ${country}...`);
        for (const spot of spots) {
          if (spot.id) await deleteDoc(doc(db, "spots", spot.id));
        }
        setMasterSpots(prev => prev.filter(s => s.country !== country));
        setDbStatus(`Deleted ${country}`);
      } catch (error: any) {
        setDbStatus(`Error: ${error.message}`);
      }
    }
  };

  const runOptimization = async (spotsToOptimize: TravelSpot[]) => {
    if (spotsToOptimize.length < 2) return;
    setIsOptimizing(true);
    setRouteGeometry(null); // Reset previous route
    try {
      const coords = spotsToOptimize.map(s => s.coordinates);
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

  return (
    <div className="fixed inset-0 bg-black text-white font-sans selection:bg-white selection:text-black overflow-hidden touch-none">
      
      {/* 1. MAP FLOOR (Z-0) */}
      <div className={cn(
        "absolute inset-0 z-0 transition-all duration-[2000ms] ease-in-out touch-auto",
        isBloomed ? "opacity-100 scale-100" : "opacity-20 scale-110 grayscale"
      )}>
        <MapComponent spots={masterSpots} routeGeometry={routeGeometry} />
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/60 via-transparent to-black/60" />
      </div>

      {/* 2. AUTH MODAL (Z-[200]) */}
      <AnimatePresence>
        {showShortcutInstructions && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 md:p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-[#0a0a0a] border border-[#262626] p-6 md:p-10 rounded-[32px] md:rounded-[40px] w-full max-w-xl shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <button onClick={() => setShowShortcutInstructions(false)} className="absolute top-6 right-6 text-[#404040] hover:text-white transition-colors p-2 cursor-pointer">
                <X className="w-6 h-6" />
              </button>
              <h2 className="text-2xl font-black tracking-tighter mb-2 italic uppercase">iOS Shortcut Setup</h2>
              <p className="text-[10px] text-[#737373] font-bold uppercase tracking-widest mb-8">Fast-sync from Instagram / TikTok</p>
              
              <div className="space-y-8">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black">1</div>
                    <p className="text-xs font-black uppercase text-white/80">Create Shortcut</p>
                  </div>
                  <p className="text-[11px] text-[#525252] leading-relaxed pl-9">Open the <b>Shortcuts</b> app on your iPhone and create a new shortcut named <b>"Sync to Voyge"</b>. Enable <b>"Show in Share Sheet"</b> in the settings.</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black">2</div>
                    <p className="text-xs font-black uppercase text-white/80">Add "Get Contents of URL"</p>
                  </div>
                  <div className="pl-9 space-y-4">
                    <div className="space-y-2">
                      <p className="text-[10px] text-[#404040] uppercase font-black">URL</p>
                      <div className="flex items-center justify-between bg-black rounded-xl p-3 border border-white/5">
                        <code className="text-[10px] text-white break-all">https://voyge-studio.vercel.app/api/telegram</code>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] text-[#404040] uppercase font-black">Method & Headers</p>
                      <p className="text-[10px] text-[#525252]">Set Method to <b>POST</b>. Add header <b>Content-Type: application/json</b></p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black">3</div>
                    <p className="text-xs font-black uppercase text-white/80">Request Body (JSON)</p>
                  </div>
                  <div className="pl-9 space-y-4">
                    <p className="text-[11px] text-[#525252] leading-relaxed">
                      1. Add a <b>"Text"</b> action above the URL block.<br/>
                      2. Paste the JSON below into it (Replace <code>SHORTCUT_INPUT</code> with the <b>Shortcut Input</b> variable).<br/>
                      3. In the URL block, set <b>Request Body</b> to <b>File</b> and select that <b>"Text"</b> box.
                    </p>
                    <div className="relative group">
                      <pre className="bg-black rounded-2xl p-4 border border-white/10 text-[10px] text-white/60 overflow-x-auto">
{`{
  "message": {
    "text": "SHORTCUT_INPUT",
    "chat": { "id": ${telegramId} },
    "from": { "id": ${telegramId} }
  }
}`}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowShortcutInstructions(false)}
                className="w-full mt-10 bg-white/5 border border-white/10 text-white py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white/10 transition-all"
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}

        {isAuthVisible && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-[#0a0a0a] border border-[#262626] p-10 rounded-[40px] w-full max-w-md shadow-2xl relative"
            >
              <button onClick={() => setIsAuthVisible(false)} className="absolute top-6 right-6 text-[#404040] hover:text-white transition-colors p-2 cursor-pointer">
                <X className="w-6 h-6" />
              </button>
              <h2 className="text-2xl md:text-3xl font-black tracking-tighter mb-2 italic uppercase">Voyge Access</h2>
              <p className="text-[10px] md:text-xs text-[#737373] font-bold uppercase tracking-widest mb-8">Synchronize your master map</p>
              <div className="space-y-4">
                <input 
                  type="email" placeholder="Email Address" 
                  className="w-full bg-black border border-[#262626] rounded-2xl px-5 py-4 text-sm font-bold placeholder-[#404040] outline-none focus:border-white/20 transition-all text-white"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
                <input 
                  type="password" placeholder="Password" 
                  className="w-full bg-black border border-[#262626] rounded-2xl px-5 py-4 text-sm font-bold placeholder-[#404040] outline-none focus:border-white/20 transition-all text-white"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <button onClick={() => handleAuth("login")} disabled={authLoading} className="bg-white text-black py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:scale-[1.02] active:scale-95 transition-all cursor-pointer">
                    {authLoading ? "Checking..." : "Sign In"}
                  </button>
                  <button onClick={() => handleAuth("signup")} disabled={authLoading} className="bg-white/5 border border-white/10 text-white py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white/10 transition-all cursor-pointer">
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. TOP NAV (Z-[150]) */}
      <div className="fixed top-4 md:top-8 right-4 md:right-8 z-[150] flex items-center gap-4 pointer-events-none">
        {user ? (
          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-xl border border-white/5 pl-2 pr-4 py-2 rounded-2xl shadow-2xl pointer-events-auto mt-16 md:mt-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 text-[10px] font-black italic text-white/80">
              {user.email?.[0].toUpperCase()}
            </div>
            {!isMobile && <p className="text-[10px] font-black text-[#737373] uppercase tracking-widest truncate max-w-[100px]">{user.email.split('@')[0]}</p>}
            <button onClick={handleLogout} className="text-[9px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-tighter transition-colors px-2 py-1 cursor-pointer">Out</button>
          </div>
        ) : (
          <button 
            onClick={() => setIsAuthVisible(true)}
            className="flex items-center justify-center bg-white/5 hover:bg-white/10 text-[#737373] hover:text-white w-10 md:w-12 h-10 md:h-12 rounded-2xl border border-white/5 transition-all group shadow-2xl pointer-events-auto cursor-pointer mt-16 md:mt-0"
          >
            <LogIn className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 4. SIDEBAR / MOBILE DRAWER (Z-[100]) */}
      <AnimatePresence>
        {isBloomed && sidebarVisible && (
          <>
            {isMobile && (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setSidebarVisible(false)}
                className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm pointer-events-auto"
              />
            )}
            <motion.aside
              initial={{ x: -320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -320, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 100 }}
              className={cn(
                "fixed left-0 top-0 bottom-0 bg-[#000] border-r border-white/5 z-[100] flex flex-col p-5 shadow-[30px_0_100px_rgba(0,0,0,0.8)] pointer-events-auto",
                isMobile ? "w-[280px]" : "w-80"
              )}
            >
              {!isMobile && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setSidebarVisible(false); }}
                  className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-12 bg-[#171717] border border-white/10 rounded-full flex items-center justify-center text-[#737373] hover:text-white transition-all shadow-2xl z-[110] cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}

              <div className="flex items-center justify-between px-2 py-6 mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.3)]">
                    <Navigation className="text-black w-6 h-6 fill-current" />
                  </div>
                  <span className="text-2xl font-black tracking-tighter uppercase italic tracking-widest text-white">Voyge</span>
                </div>
                {isMobile && <button onClick={() => setSidebarVisible(false)} className="p-2 text-[#404040]"><X className="w-6 h-6" /></button>}
              </div>

              <nav className="space-y-1 flex-1 overflow-y-auto custom-scrollbar pr-2 relative pointer-events-auto">
                {[
                  { icon: MapPin, label: "Master Map", id: "all", count: masterSpots.length },
                  { icon: Compass, label: "Itineraries", id: "itineraries", count: routeGeometry ? 1 : 0 },
                  { icon: Heart, label: "Favorites", id: "favorites", count: masterSpots.filter(s => s.is_favorite).length },
                ].map((item) => (
                  <button 
                    key={item.label} 
                    onClick={(e) => { e.stopPropagation(); if (item.id === "all" || item.id === "favorites") setActiveFilter(item.id as any); }}
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm transition-all group mb-1 cursor-pointer pointer-events-auto", 
                      (item.id === activeFilter) ? "bg-white text-black shadow-xl" : "text-[#a1a1aa] hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <div className="flex items-center gap-3 pointer-events-none">
                      <item.icon className={cn("w-4 h-4", (item.id === activeFilter) ? "stroke-[3px]" : "stroke-2")} />
                      <span className="font-bold tracking-tight">{item.label}</span>
                    </div>
                    {item.count !== undefined && <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-lg", (item.id === activeFilter) ? "bg-black/10 text-black" : "bg-white/5")}>{item.count}</span>}
                  </button>
                ))}
                
                <div className="h-10" />
                
                <div className="flex items-center justify-between px-4 mb-4">
                  <p className="text-[10px] uppercase font-black tracking-[0.2em] text-[#404040]">Countries</p>
                  <Globe className="w-3 h-3 text-[#404040]" />
                </div>

                <div className="space-y-2 pointer-events-auto">
                  {Object.entries(groupedSpots).map(([country, spots]) => (
                    <div key={country} className="space-y-1">
                      <button 
                        onClick={() => toggleFolder(country)}
                        className="w-full flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Folder className={cn("w-4 h-4 transition-all", expandedFolders.includes(country) ? "fill-white text-white" : "text-[#525252]")} />
                            <span className="text-xs font-black uppercase tracking-widest truncate max-w-[120px]">{country}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); runOptimization(spots); }}
                              disabled={isOptimizing}
                              className="p-1.5 text-white/60 hover:text-white transition-all bg-white/10 rounded-lg active:scale-95"
                            >
                              <Route className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); deleteFolder(country, spots); }}
                              className="p-1.5 text-red-500/60 hover:text-red-500 transition-all bg-white/10 rounded-lg active:scale-95"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <span className="text-[9px] font-black text-[#525252] bg-white/5 px-2 py-0.5 rounded-md">{spots.length}</span>
                      </button>

                      <AnimatePresence>
                        {expandedFolders.includes(country) && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden space-y-2 pl-4 py-2"
                          >
                            {spots.map((spot, i) => (
                              <div 
                                key={spot.id || i} 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  if (spot.coordinates) (window as any).flyToSpot?.(...spot.coordinates);
                                  if (isMobile) setSidebarVisible(false);
                                }}
                                className="group relative flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.01] border border-transparent hover:border-white/10 hover:bg-white/[0.03] transition-all cursor-pointer"
                              >
                                <div className="w-8 h-8 rounded-lg overflow-hidden bg-black border border-white/5 flex-shrink-0">
                                  {spot.thumbnail ? <img src={spot.thumbnail} className="w-full h-full object-cover grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all" /> : <MapPin className="w-full h-full p-2.5 text-[#262626]" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-bold truncate tracking-tight">{spot.name}</p>
                                  <p className="text-[8px] text-[#525252] font-black uppercase truncate">{spot.city}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); if (spot.id) toggleFavorite(spot.id, !!spot.is_favorite); }} 
                                    className={cn("p-2 transition-all active:scale-125", spot.is_favorite ? "text-red-500" : "text-[#404040] hover:text-white")}
                                  >
                                    <Heart className={cn("w-4 h-4", spot.is_favorite && "fill-current")} />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); deleteSpot(spot.id, i); }} 
                                    className="p-2 text-[#404040] hover:text-red-500 transition-all active:scale-95"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>

                <div className="h-10" />
                <div className="px-4 mb-4">
                  <p className="text-[10px] uppercase font-black tracking-[0.2em] text-[#404040] mb-4">Integrations</p>
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-white/40 mb-1">
                      <Share className="w-3 h-3" />
                      <span className="text-[10px] font-black uppercase">Sync Shortcut</span>
                    </div>
                    {telegramId ? (
                      <button 
                        onClick={() => setShowShortcutInstructions(true)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black rounded-xl text-[10px] font-black uppercase transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                      >
                        Setup Shortcut
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[8px] text-[#737373] font-bold uppercase leading-tight italic">Link your Telegram first to unlock the iPhone Shortcut</p>
                        {linkToken ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between bg-black rounded-lg p-2 border border-white/10">
                              <code className="text-[10px] font-black text-white">{linkToken}</code>
                              <button onClick={() => { navigator.clipboard.writeText(`/link ${linkToken}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="text-white/40 hover:text-white transition-all">
                                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={generateLinkToken} className="w-full flex items-center justify-center gap-2 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[9px] font-black uppercase transition-all">
                            <Key className="w-3 h-3" /> Get Code
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </nav>

              <div className="mt-6 px-2 space-y-2 pointer-events-auto">
                 {routeGeometry ? (
                   <button onClick={(e) => { e.stopPropagation(); setRouteGeometry(null); }} className="w-full bg-white text-black hover:bg-[#e5e5e5] py-4 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-2xl active:scale-95 cursor-pointer pointer-events-auto">
                     <X className="w-5 h-5" />
                     <span className="text-[11px] font-black uppercase tracking-widest">Clear Journey</span>
                   </button>
                 ) : (
                   <button onClick={(e) => { e.stopPropagation(); runOptimization(masterSpots); }} disabled={masterSpots.length < 2 || isOptimizing} className="w-full bg-white text-black hover:bg-[#e5e5e5] py-4 rounded-2xl flex items-center justify-center gap-3 transition-all disabled:opacity-20 shadow-2xl active:scale-95 cursor-pointer pointer-events-auto">
                     <Route className={cn("w-5 h-5", isOptimizing && "animate-spin")} />
                     <span className="text-[11px] font-black uppercase tracking-widest">{isOptimizing ? "Calculating..." : "Plan All Spots"}</span>
                   </button>
                 )}
                 {user && (
                   <button onClick={(e) => { e.stopPropagation(); fetchSpots(user.uid); }} className="w-full flex items-center justify-center gap-2 py-2 text-[#404040] hover:text-white transition-all text-[9px] font-black uppercase tracking-widest cursor-pointer pointer-events-auto">
                     <RefreshCw className="w-3 h-3" /> Sync Firestore
                   </button>
                 )}
              </div>

              <div className="mt-8 border-t border-white/5 pt-6 flex items-center gap-3 px-2 mb-2 pointer-events-none">
                <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10"><User className="w-5 h-5 text-[#737373]" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate text-white/80">{user ? user.email.split('@')[0] : "Guest Account"}</p>
                  <p className={cn("text-[9px] uppercase tracking-tighter font-black transition-all", dbStatus.includes("Error") ? "text-red-500" : "text-[#525252]")}>{dbStatus}</p>
                </div>
                <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px]", user ? "bg-green-500 shadow-green-500/40" : "bg-orange-500 shadow-orange-500/40")} />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* 5. MINIMIZED TRIGGER (Z-[150]) */}
      <AnimatePresence>
        {isBloomed && !sidebarVisible && (
          <motion.button
            initial={{ x: -100 }} animate={{ x: 0 }} exit={{ x: -100 }}
            onClick={() => setSidebarVisible(true)}
            className="fixed left-4 md:left-6 top-1/2 -translate-y-1/2 w-10 md:w-12 h-10 md:h-12 bg-black border border-white/10 rounded-2xl z-[150] flex items-center justify-center text-white shadow-2xl hover:scale-110 active:scale-95 transition-all cursor-pointer pointer-events-auto"
          >
            {isMobile ? <Menu className="w-5 h-5" /> : <ChevronRight className="w-6 h-6" />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* 6. MAIN CONTENT (Z-10) */}
      <div className={cn(
        "fixed inset-0 z-10 flex flex-col items-center justify-center transition-all duration-[1000ms] pointer-events-none px-4",
        isBloomed && sidebarVisible && !isMobile ? "pl-80" : "pl-0"
      )}>
        <div className="w-full max-w-2xl flex flex-col items-center gap-8 md:gap-12">
          
          <AnimatePresence>
            {!isBloomed && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="text-center">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/5 border border-white/10 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-[0.4em] mb-6 md:mb-8 text-white/40 shadow-2xl">
                  <Sparkles className="w-3 h-3 text-white/60" /> Next-Gen Travel
                </div>
                <h1 className="text-[60px] md:text-[120px] leading-[0.8] font-black tracking-tighter mb-6 md:mb-8 bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/10">VOYGE</h1>
                <p className="text-[#525252] text-lg md:text-xl max-w-lg mx-auto leading-relaxed font-bold tracking-tight italic">Your social media saves, <span className="text-white not-italic">mathematically perfected.</span></p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* SEARCH BAR */}
          <div className={cn(
            "w-full transition-all duration-1000 ease-in-out pointer-events-auto",
            isBloomed && "fixed top-6 md:top-10 max-w-xl scale-90 md:scale-100"
          )}>
            <form onSubmit={handlePaste} className="w-full relative group">
              <div className={cn("absolute -inset-[3px] bg-gradient-to-r from-white/0 via-white/30 to-white/0 rounded-[32px] blur-2xl opacity-0 transition-all duration-1000", isFocused && "opacity-100 scale-105")} />
              <div className="relative bg-black/60 backdrop-blur-3xl border border-white/10 rounded-3xl md:rounded-[32px] flex items-center px-4 md:px-8 py-4 md:py-6 gap-3 md:gap-6 transition-all duration-500 hover:border-white/20 shadow-[0_50px_150px_rgba(0,0,0,1)]">
                <Search className={cn("w-5 md:w-7 h-5 md:h-7 transition-all duration-700 hidden sm:block", isFocused ? "text-white rotate-180" : "text-[#404040]")} />
                <input type="text" placeholder={isMobile ? "Paste link here..." : "Paste Instagram or TikTok link here..."} className="bg-transparent border-none outline-none flex-1 text-sm md:text-lg placeholder-[#404040] font-black tracking-tighter text-white" value={url} onChange={(e) => setUrl(e.target.value)} onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)} />
                <button type="submit" className="bg-white text-black px-6 md:px-10 py-2.5 md:py-3 rounded-xl md:rounded-2xl text-[9px] md:text-[11px] font-black hover:scale-105 transition-all active:scale-95 disabled:opacity-20 uppercase tracking-[0.2em] shadow-xl cursor-pointer" disabled={isAnalyzing}>
                  {isAnalyzing ? "..." : isBloomed ? "Add" : "Launch"}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* 7. INTELLIGENCE DRAWER (Z-150) */}
        <AnimatePresence>
          {isBloomed && currentAnalysis.length > 0 && (
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 50, opacity: 0, scale: 0.9 }}
              className="fixed inset-x-4 bottom-4 md:right-12 md:bottom-12 md:left-auto z-[150] pointer-events-auto"
            >
              <div className="bg-[#000]/80 backdrop-blur-3xl border border-white/10 p-6 md:p-10 rounded-[32px] md:rounded-[48px] md:w-[480px] shadow-[0_80px_150px_-20px_rgba(0,0,0,0.8)] flex flex-col gap-6 md:gap-8">
                {isAnalyzing ? (
                  <div className="space-y-6 md:space-y-8 py-6 md:py-10 text-center">
                    <div className="relative w-16 md:w-24 h-16 md:h-24 mx-auto">
                       <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }} className="absolute inset-0 border-[3px] border-dashed border-white/10 rounded-full" />
                       <div className="absolute inset-0 flex items-center justify-center"><Sparkles className="w-6 md:w-10 h-6 md:h-10 text-white animate-pulse" /></div>
                    </div>
                    <div><h3 className="text-xl md:text-2xl font-black tracking-tighter uppercase italic text-white">Voyge Intelligence</h3><p className="text-[10px] text-[#525252] font-black uppercase tracking-[0.3em] mt-3">Synthesizing Location Data</p></div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_20px_rgba(34,197,94,1)] animate-pulse" />
                        <h3 className="font-black text-[10px] md:text-[11px] uppercase tracking-[0.4em] text-white/40">Latest Discoveries</h3>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setCurrentAnalysis([]); }} className="bg-white/5 p-2 md:p-3 rounded-xl md:rounded-2xl text-[#737373] hover:text-white transition-all hover:bg-white/10 cursor-pointer pointer-events-auto"><X className="w-5 h-5" /></button>
                    </div>
                    <div className="flex flex-col gap-4 md:gap-5 max-h-[300px] md:max-h-[400px] overflow-y-auto pr-2 md:pr-4 custom-scrollbar pointer-events-auto">
                      {currentAnalysis.map((spot, i) => (
                        <motion.div key={i} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1, type: "spring", damping: 15 }} className="group flex gap-4 md:gap-6 p-4 md:p-6 rounded-[24px] md:rounded-[32px] bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10 transition-all cursor-pointer shadow-2xl relative overflow-hidden pointer-events-auto">
                          <div className="w-16 md:w-20 h-16 md:h-20 rounded-[16px] md:rounded-[24px] bg-black flex-shrink-0 overflow-hidden border border-white/10 relative group-hover:scale-110 transition-transform duration-700">
                            {spot.thumbnail ? <img src={spot.thumbnail} className="w-full h-full object-cover grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-1000" /> : <MapPin className="w-full h-full p-4 md:p-6 text-[#262626]" />}
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center pointer-events-none">
                            <h4 className="text-lg md:text-xl font-black truncate tracking-tighter group-hover:text-white text-white">{spot.name}</h4>
                            <div className="flex items-center gap-2 md:gap-3 mt-1"><p className="text-[10px] md:text-[11px] text-[#525252] font-black uppercase tracking-tighter">{spot.city}</p><span className="w-1 h-1 bg-white/10 rounded-full" /><p className="text-[10px] md:text-[11px] text-white/40 font-black uppercase tracking-tighter">{spot.category}</p></div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
