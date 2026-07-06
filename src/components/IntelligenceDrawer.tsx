"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ExternalLink, MapPin, Sparkles, X } from "lucide-react";
import { getCountryFlag } from "@/lib/flags";
import { GlassIconButton } from "@/components/glass/Glass";
import type { TravelSpot } from "@/lib/types";

interface IntelligenceDrawerProps {
  open: boolean;
  isAnalyzing: boolean;
  spots: TravelSpot[];
  /** Human-readable failure message when analysis returned nothing */
  failureMessage: string | null;
  onClose: () => void;
}

/** Bottom-right results drawer shown after pasting a link. */
export default function IntelligenceDrawer({
  open,
  isAnalyzing,
  spots,
  failureMessage,
  onClose,
}: IntelligenceDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 50, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 50, opacity: 0, scale: 0.9 }}
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] md:right-12 md:bottom-28 md:left-auto z-[150] pointer-events-auto"
        >
          <div className="glass-deep specular p-6 md:p-10 rounded-panel md:rounded-[48px] md:w-[480px] flex flex-col gap-6 md:gap-8">
            {isAnalyzing ? (
              <div className="space-y-6 md:space-y-8 py-6 md:py-10 text-center">
                <div className="relative w-16 md:w-24 h-16 md:h-24 mx-auto">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                    className="absolute inset-0 border-[3px] border-dashed border-white/10 rounded-full"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="w-6 md:w-10 h-6 md:h-10 text-white animate-pulse" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl md:text-2xl font-black tracking-tighter uppercase italic text-white">
                    Voyge Intelligence
                  </h3>
                  <p className="text-[10px] text-steel font-black uppercase tracking-[0.3em] mt-3">
                    Synthesizing Location Data
                  </p>
                </div>
              </div>
            ) : failureMessage ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    <h3 className="font-black text-[10px] md:text-[11px] uppercase tracking-[0.4em] text-white/40">
                      No Location Found
                    </h3>
                  </div>
                  <GlassIconButton label="Dismiss" size="sm" onClick={onClose}>
                    <X className="w-4 h-4" />
                  </GlassIconButton>
                </div>
                <p className="text-xs text-white/70 leading-relaxed">
                  {failureMessage}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_20px_rgba(34,197,94,1)] animate-pulse" />
                    <h3 className="font-black text-[10px] md:text-[11px] uppercase tracking-[0.4em] text-white/40">
                      Latest Discoveries
                    </h3>
                  </div>
                  <GlassIconButton label="Close discoveries" size="sm" onClick={onClose}>
                    <X className="w-4 h-4" />
                  </GlassIconButton>
                </div>
                <div className="flex flex-col gap-4 md:gap-5 max-h-[40dvh] md:max-h-[400px] overflow-y-auto pr-2 md:pr-4 custom-scrollbar">
                  {spots.map((spot, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 30 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1, type: "spring", damping: 15 }}
                      className="group flex gap-4 md:gap-6 p-4 md:p-6 rounded-card md:rounded-panel glass hover:bg-white/[0.06] transition-all shadow-2xl relative overflow-hidden"
                    >
                      <div className="w-16 md:w-20 h-16 md:h-20 rounded-2xl md:rounded-card bg-black flex-shrink-0 overflow-hidden border border-white/10 relative group-hover:scale-110 transition-transform duration-700">
                        {spot.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={spot.thumbnail}
                            alt={spot.name}
                            className="w-full h-full object-cover grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-1000"
                          />
                        ) : (
                          <MapPin className="w-full h-full p-4 md:p-6 text-[#262626]" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h4 className="text-lg md:text-xl font-black truncate tracking-tighter text-white">
                          {spot.name}
                        </h4>
                        <div className="flex items-center gap-2 md:gap-3 mt-1">
                          <span className="text-sm">{getCountryFlag(spot.country)}</span>
                          <p className="text-[10px] md:text-[11px] text-steel font-black uppercase tracking-tighter">
                            {spot.city}
                          </p>
                          <span className="w-1 h-1 bg-white/10 rounded-full" />
                          <p className="text-[10px] md:text-[11px] text-white/40 font-black uppercase tracking-tighter">
                            {spot.category}
                          </p>
                        </div>
                        {spot.description && (
                          <p className="text-[10px] text-fog mt-2 line-clamp-2 group-hover:text-white/40 transition-colors italic leading-relaxed">
                            {spot.description}
                          </p>
                        )}
                        {spot.original_link && (
                          <a
                            href={spot.original_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 mt-2 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-colors w-fit"
                          >
                            <ExternalLink className="w-3 h-3" /> View post
                          </a>
                        )}
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
  );
}
