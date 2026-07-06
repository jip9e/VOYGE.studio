"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { GlassButton, GlassIconButton } from "@/components/glass/Glass";

interface ShortcutModalProps {
  open: boolean;
  onClose: () => void;
  telegramId: string | null;
}

export default function ShortcutModal({
  open,
  onClose,
  telegramId,
}: ShortcutModalProps) {
  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 md:p-6"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="glass-deep specular rounded-panel md:rounded-sheet p-6 md:p-10 w-full max-w-xl relative max-h-[90dvh] overflow-y-auto custom-scrollbar"
      >
        <GlassIconButton
          label="Close"
          size="sm"
          onClick={onClose}
          className="absolute top-5 right-5"
        >
          <X className="w-5 h-5" />
        </GlassIconButton>
        <h2 className="text-2xl font-black tracking-tighter mb-2 italic uppercase">
          iOS Shortcut Setup
        </h2>
        <p className="text-[10px] text-mist font-bold uppercase tracking-widest mb-8">
          Fast-sync from Instagram / TikTok
        </p>

        <div className="space-y-8">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black">
                1
              </div>
              <p className="text-xs font-black uppercase text-white/80">
                Create Shortcut
              </p>
            </div>
            <p className="text-[11px] text-steel leading-relaxed pl-9">
              Open the <b>Shortcuts</b> app on your iPhone and create a new
              shortcut named <b>&quot;Sync to Voyge&quot;</b>. Enable{" "}
              <b>&quot;Show in Share Sheet&quot;</b> in the settings.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black">
                2
              </div>
              <p className="text-xs font-black uppercase text-white/80">
                Add &quot;Get Contents of URL&quot;
              </p>
            </div>
            <div className="pl-9 space-y-4">
              <div className="space-y-2">
                <p className="text-[10px] text-fog uppercase font-black">URL</p>
                <div className="flex items-center justify-between bg-black/60 rounded-xl p-3 border border-white/5">
                  <code className="text-[10px] text-white break-all">
                    https://voyge-studio.vercel.app/api/telegram
                  </code>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] text-fog uppercase font-black">
                  Method &amp; Headers
                </p>
                <p className="text-[10px] text-steel">
                  Set Method to <b>POST</b>. Add header{" "}
                  <b>Content-Type: application/json</b>
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-black">
                3
              </div>
              <p className="text-xs font-black uppercase text-white/80">
                Request Body (JSON)
              </p>
            </div>
            <div className="pl-9 space-y-4">
              <p className="text-[11px] text-steel leading-relaxed">
                1. Add a <b>&quot;Text&quot;</b> action above the URL block.
                <br />
                2. Paste the JSON below into it (Replace{" "}
                <code>SHORTCUT_INPUT</code> with the <b>Shortcut Input</b>{" "}
                variable).
                <br />
                3. In the URL block, set <b>Request Body</b> to <b>File</b> and
                select that <b>&quot;Text&quot;</b> box.
              </p>
              <div className="relative group">
                <pre className="bg-black/60 rounded-2xl p-4 border border-white/10 text-[10px] text-white/60 overflow-x-auto">
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

        <GlassButton
          variant="glass"
          size="lg"
          onClick={onClose}
          className="w-full mt-10 uppercase text-[10px] tracking-widest rounded-2xl"
        >
          Done
        </GlassButton>
      </motion.div>
    </motion.div>
  );
}
