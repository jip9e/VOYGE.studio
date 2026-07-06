"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlaceSuggestion {
  name: string;
  city: string;
  country: string;
  [key: string]: unknown;
}

interface SearchBarProps {
  /** hero = big landing bar; compact = sidebar bar */
  variant: "hero" | "compact";
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isAnalyzing: boolean;
  isSearching: boolean;
  isFocused: boolean;
  onFocusChange: (focused: boolean) => void;
  suggestions: PlaceSuggestion[];
  onSelect: (suggestion: PlaceSuggestion) => void;
}

export default function SearchBar({
  variant,
  value,
  onChange,
  onSubmit,
  isAnalyzing,
  isSearching,
  isFocused,
  onFocusChange,
  suggestions,
  onSelect,
}: SearchBarProps) {
  const hero = variant === "hero";

  return (
    <div className={cn("relative", hero ? "w-full group" : "mb-3")}>
      {hero && (
        <div
          className={cn(
            "absolute -inset-[3px] bg-gradient-to-r from-white/0 via-white/30 to-white/0 rounded-panel blur-2xl opacity-0 transition-all duration-1000",
            isFocused && "opacity-100 scale-105",
          )}
        />
      )}
      <form onSubmit={onSubmit} className="w-full relative">
        <div
          className={cn(
            "glass specular flex items-center transition-all duration-500 hover:border-white/25",
            hero
              ? "rounded-3xl md:rounded-panel px-4 md:px-8 py-3 md:py-5 gap-3 md:gap-6"
              : "rounded-2xl px-4 py-2.5 gap-3",
          )}
        >
          {isSearching ? (
            <Loader2
              className={cn(
                "text-white/40 animate-spin shrink-0",
                hero ? "w-5 md:w-7 h-5 md:h-7" : "w-4 h-4",
              )}
            />
          ) : (
            <Search
              className={cn(
                "transition-all duration-700 shrink-0",
                hero ? "w-5 md:w-7 h-5 md:h-7 hidden sm:block" : "w-4 h-4",
                isFocused ? "text-white rotate-180" : "text-fog",
              )}
            />
          )}
          <input
            type="text"
            placeholder={
              hero
                ? "Paste Instagram/TikTok link or search..."
                : "Add link or search place..."
            }
            className={cn(
              "bg-transparent border-none outline-none flex-1 min-w-0 placeholder-fog font-black tracking-tighter text-white",
              hero ? "text-sm md:text-lg" : "text-xs",
            )}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => onFocusChange(true)}
            onBlur={() => setTimeout(() => onFocusChange(false), 200)}
          />
          <button
            type="submit"
            className={cn(
              "bg-white text-black font-black hover:scale-105 transition-all active:scale-95 disabled:opacity-20 uppercase cursor-pointer shrink-0 shadow-glow",
              hero
                ? "px-6 md:px-10 py-2.5 md:py-3 rounded-xl md:rounded-2xl text-[9px] md:text-[11px] tracking-[0.2em]"
                : "px-4 py-2 rounded-lg text-[9px] tracking-widest",
            )}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? "..." : hero ? "Launch" : "Add"}
          </button>
        </div>
      </form>

      <AnimatePresence>
        {isFocused && suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className={cn(
              "absolute top-full left-0 right-0 glass-deep overflow-hidden z-[200] shadow-2xl",
              hero ? "mt-4 rounded-panel" : "mt-2 rounded-2xl",
            )}
          >
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSelect(s)}
                className={cn(
                  "w-full text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-none group/item cursor-pointer",
                  hero
                    ? "flex items-center justify-between p-5 md:p-6"
                    : "flex flex-col gap-0.5 p-4",
                )}
              >
                <div>
                  <p
                    className={cn(
                      "font-black text-white",
                      hero ? "text-base md:text-lg" : "text-xs",
                    )}
                  >
                    {s.name}
                  </p>
                  <p
                    className={cn(
                      "text-steel font-bold uppercase",
                      hero ? "text-[10px] tracking-widest" : "text-[9px] tracking-tighter",
                    )}
                  >
                    {s.city}, {s.country}
                  </p>
                </div>
                {hero && (
                  <ChevronRight className="w-5 h-5 text-white/10 group-hover/item:text-white transition-all group-hover/item:translate-x-1" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
