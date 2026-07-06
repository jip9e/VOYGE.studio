"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { GlassButton, GlassIconButton, GlassInput } from "@/components/glass/Glass";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuth: (type: "login" | "signup", email: string, password: string) => void;
  loading: boolean;
}

export default function AuthModal({
  open,
  onClose,
  onAuth,
  loading,
}: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="glass-deep specular rounded-sheet p-8 md:p-10 w-full max-w-md relative"
      >
        <GlassIconButton
          label="Close"
          size="sm"
          onClick={onClose}
          className="absolute top-5 right-5"
        >
          <X className="w-5 h-5" />
        </GlassIconButton>
        <h2 className="text-2xl md:text-3xl font-black tracking-tighter mb-2 italic uppercase">
          Voyge Access
        </h2>
        <p className="text-[10px] md:text-xs text-mist font-bold uppercase tracking-widest mb-8">
          Synchronize your master map
        </p>
        <div className="space-y-4">
          <GlassInput
            type="email"
            placeholder="Email Address"
            autoComplete="email"
            className="font-bold"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <GlassInput
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            className="font-bold"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-4 pt-4">
            <GlassButton
              variant="primary"
              size="lg"
              disabled={loading}
              onClick={() => onAuth("login", email, password)}
              className="uppercase text-[10px] tracking-widest rounded-2xl"
            >
              {loading ? "Checking..." : "Sign In"}
            </GlassButton>
            <GlassButton
              variant="glass"
              size="lg"
              disabled={loading}
              onClick={() => onAuth("signup", email, password)}
              className="uppercase text-[10px] tracking-widest rounded-2xl"
            >
              Create
            </GlassButton>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
