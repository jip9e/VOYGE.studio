/**
 * @fileoverview BottomSheet — Mobile-First Interactive Drawer
 *
 * A mobile-optimised bottom sheet component built with Framer Motion.
 * Slides up from the bottom of the screen and supports multiple dismissal
 * gestures for a native-feeling mobile UX.
 *
 * ## Behaviour
 *
 * - **Entry animation** — The sheet slides up from `y: "100%"` (fully
 *   off-screen) to `y: 0` (fully visible, capped at 85dvh), using a
 *   spring animation (`damping: 25, stiffness: 200`).
 * - **Exit animation** — Slides back down to `y: "100%"` when dismissed.
 * - **Backdrop** — A semi-transparent black backdrop (`bg-black/60`) with
 *   a `backdrop-blur-sm` effect renders behind the sheet. Clicking anywhere
 *   on the backdrop calls `onClose()`.
 * - **Drag-to-dismiss** — The sheet is draggable on the Y axis. If the user
 *   drags it downward more than **100 px** (`info.offset.y > 100`), the sheet
 *   is dismissed via `onClose()`. The drag is constrained so the sheet cannot
 *   be dragged upward beyond its resting position (`dragConstraints: { top: 0 }`).
 * - **Scroll lock** — While the sheet is open, `document.body.style.overflow`
 *   is set to `"hidden"` to prevent the page behind the sheet from scrolling.
 *   This is restored to `"unset"` on close or unmount.
 *
 * ## Visual Structure
 *
 * ```
 * ┌────────────────────────────────────┐  ← Fixed backdrop (z-[100])
 * │                                    │
 * │  ╔══════════════════════════════╗  │
 * │  ║  ── drag handle ──           ║  │  ← Sheet (z-[110])
 * │  ║                              ║  │
 * │  ║  Title              [✕]      ║  │  ← Header (optional, shown when `title` is set)
 * │  ║                              ║  │
 * │  ║  {children}                  ║  │  ← Scrollable content area
 * │  ║                              ║  │
 * │  ╚══════════════════════════════╝  │
 * └────────────────────────────────────┘
 * ```
 *
 * The sheet uses `rounded-t-[32px]` corners, a `bg-[#0a0a0a]` background,
 * a `border-t border-white/10` top border, and a dramatic box shadow.
 * Content inside `.custom-scrollbar` scrolls independently of the page.
 *
 * ## Props
 *
 * | Prop       | Type                  | Required | Description                              |
 * |------------|-----------------------|----------|------------------------------------------|
 * | `isOpen`   | `boolean`             | ✅       | Controls visibility; drives AnimatePresence |
 * | `onClose`  | `() => void`          | ✅       | Called on backdrop click or drag-dismiss |
 * | `children` | `React.ReactNode`     | ✅       | Content rendered inside the scrollable area |
 * | `title`    | `string`              | ❌       | Optional header title. When provided, also renders an ✕ close button. |
 *
 * ## Usage
 *
 * ```tsx
 * <BottomSheet isOpen={isOpen} onClose={() => setIsOpen(false)} title="My Spots">
 *   <SpotList spots={spots} />
 * </BottomSheet>
 * ```
 *
 * @module components/BottomSheet
 */
"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  title,
}: BottomSheetProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Sheet — animates fully into view (y: 0); previously it rested at
              y: "10%" which pushed the bottom tenth of the content offscreen */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) {
                onClose();
              }
            }}
            className="fixed inset-x-0 bottom-0 z-[110] glass-deep rounded-t-sheet shadow-[0_-20px_100px_rgba(0,0,0,0.8)] flex flex-col max-h-[85dvh]"
          >
            {/* Handle */}
            <div className="w-full flex justify-center py-4 cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-white/10 rounded-full" />
            </div>

            {/* Header */}
            {title && (
              <div className="px-6 pb-4 flex items-center justify-between">
                <h2 className="text-xl font-black italic uppercase tracking-tight">
                  {title}
                </h2>
                <button
                  aria-label="Close"
                  onClick={onClose}
                  className="p-2 text-fog hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-safe-4 flex flex-col">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
