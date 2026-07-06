"use client";

/**
 * Liquid-glass UI primitives.
 *
 * Every surface in the app composes these instead of ad-hoc utility
 * clusters, so the glass look (and touch-target sizes) stay consistent.
 * Brand typography (font-black italic uppercase) intentionally stays in
 * the consuming components.
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── GlassPanel ──────────────────────────────────────────────────────────────

interface GlassPanelProps {
  /** card = 24px radius, panel = 32px, sheet = 40px */
  variant?: "card" | "panel" | "sheet";
  /** More opaque background — for modals and text over satellite imagery */
  deep?: boolean;
  className?: string;
  children: ReactNode;
}

export function GlassPanel({
  variant = "card",
  deep = false,
  className,
  children,
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        deep ? "glass-deep" : "glass",
        "specular",
        variant === "card" && "rounded-card",
        variant === "panel" && "rounded-panel",
        variant === "sheet" && "rounded-sheet",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── GlassButton ─────────────────────────────────────────────────────────────

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = white brand pill, glass = translucent, ghost = borderless, danger = red tint */
  variant?: "primary" | "glass" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  function GlassButton(
    { variant = "glass", size = "md", className, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(
          "flex items-center justify-center gap-2 font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
          size === "sm" && "min-h-9 px-4 rounded-full text-[10px]",
          size === "md" && "min-h-11 px-6 rounded-full text-xs",
          size === "lg" && "min-h-14 px-8 rounded-full text-sm",
          variant === "primary" &&
            "bg-white text-black shadow-glow hover:scale-[1.03] active:scale-95",
          variant === "glass" &&
            "glass text-white hover:bg-white/10 active:scale-95",
          variant === "ghost" &&
            "text-mist hover:text-white hover:bg-white/5 active:scale-95",
          variant === "danger" &&
            "glass text-red-400 hover:bg-red-500/20 hover:text-red-300 active:scale-95",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

// ─── GlassIconButton ─────────────────────────────────────────────────────────

interface GlassIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — icon-only buttons must always have one */
  label: string;
  size?: "sm" | "md" | "lg";
  active?: boolean;
}

export const GlassIconButton = forwardRef<
  HTMLButtonElement,
  GlassIconButtonProps
>(function GlassIconButton(
  { label, size = "md", active = false, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center justify-center rounded-full transition-all cursor-pointer active:scale-90",
        // 44px minimum touch target at md+
        size === "sm" && "w-9 h-9",
        size === "md" && "w-11 h-11",
        size === "lg" && "w-14 h-14",
        active
          ? "bg-white text-black shadow-glow"
          : "glass text-mist hover:text-white hover:bg-white/10",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

// ─── GlassChip ───────────────────────────────────────────────────────────────

interface GlassChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export const GlassChip = forwardRef<HTMLButtonElement, GlassChipProps>(
  function GlassChip({ selected = false, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "min-h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all cursor-pointer active:scale-95",
          selected
            ? "bg-white text-black shadow-glow"
            : "glass text-mist hover:text-white hover:bg-white/10",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

// ─── GlassInput ──────────────────────────────────────────────────────────────

type GlassInputProps = InputHTMLAttributes<HTMLInputElement>;

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  function GlassInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full glass rounded-2xl px-5 py-4 text-sm text-white outline-none placeholder:text-fog focus:border-white/30 transition-colors",
          className,
        )}
        {...props}
      />
    );
  },
);
