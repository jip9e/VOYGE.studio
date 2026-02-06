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

export default function BottomSheet({ isOpen, onClose, children, title }: BottomSheetProps) {
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

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: "10%" }}
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
            className="fixed inset-x-0 bottom-0 z-[110] bg-[#0a0a0a] border-t border-white/10 rounded-t-[32px] shadow-[0_-20px_100px_rgba(0,0,0,0.8)] flex flex-col max-h-[90vh]"
          >
            {/* Handle */}
            <div className="w-full flex justify-center py-4 cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-white/10 rounded-full" />
            </div>

            {/* Header */}
            {title && (
              <div className="px-6 pb-4 flex items-center justify-between">
                <h2 className="text-xl font-black italic uppercase tracking-tight">{title}</h2>
                <button onClick={onClose} className="p-2 text-[#404040] hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-10">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
