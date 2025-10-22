"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useAnimation } from "framer-motion";

type Palette = { start: string; mid: string; end: string; accent: string };
const PALETTES: Palette[] = [
  // Azure → Cobalt
  { start: "#B9F0FF", mid: "#45B7FF", end: "#204FEA", accent: "#FFFFFF" },
  // Emerald → Teal
  { start: "#B6FFE1", mid: "#28D6A3", end: "#0A8C7A", accent: "#E9FFF7" },
  // Amethyst → Violet
  { start: "#E3CCFF", mid: "#A770FF", end: "#5A2BE1", accent: "#FFFFFF" },
  // Sunset → Magenta
  { start: "#FFD6B0", mid: "#FF6E7A", end: "#D21EBB", accent: "#FFF3F7" },
  // Gold → Amber
  { start: "#FFF1B6", mid: "#FFC23A", end: "#C27A00", accent: "#FFF8D9" },
];

type Props = {
  show: boolean;
  label?: string;
  progress?: number | null;
  blurBg?: boolean;
  palettes?: Palette[]; // optional override
};

export default function Loader({
  show,
  label = "Cutting your rock…",
  progress = null,
  blurBg = true,
  palettes = PALETTES,
}: Props) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Choose a random palette whenever the loader becomes visible.
  const paletteRef = React.useRef<Palette>(palettes[0]);
  const [palette, setPalette] = React.useState<Palette>(paletteRef.current);

  React.useEffect(() => {
    if (!show) return;
    let next = palettes[Math.floor(Math.random() * palettes.length)];
    // avoid picking the exact same one twice in a row
    if (palettes.length > 1) {
      while (next === paletteRef.current) {
        next = palettes[Math.floor(Math.random() * palettes.length)];
      }
    }
    paletteRef.current = next;
    setPalette(next);
  }, [show, palettes]);

  // Animations (slower + weighty)
  const leftCtrl = useAnimation();
  const rightCtrl = useAnimation();
  const coreCtrl = useAnimation();
  const sparkCtrl = useAnimation();

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!show) return;
      await Promise.all([
        leftCtrl.start({ x: 0, y: 0, rotate: 0, transition: { duration: 0 } }),
        rightCtrl.start({ x: 0, y: 0, rotate: 0, transition: { duration: 0 } }),
        coreCtrl.start({
          opacity: 0,
          scale: 0.92,
          transition: { duration: 0 },
        }),
        sparkCtrl.start({ opacity: 0, transition: { duration: 0 } }),
      ]);
      if (cancelled) return;

      // slower open: tween with ease and longer duration
      await Promise.all([
        leftCtrl.start({
          x: -130,
          y: -12,
          rotate: -6,
          transition: {
            type: "tween",
            ease: [0.25, 0.0, 0.2, 1],
            duration: 1.1,
            delay: 0.05,
          },
        }),
        rightCtrl.start({
          x: 130,
          y: -10,
          rotate: 6,
          transition: {
            type: "tween",
            ease: [0.25, 0.0, 0.2, 1],
            duration: 1.1,
            delay: 0.05,
          },
        }),
        coreCtrl.start({
          opacity: 1,
          scale: 1,
          transition: {
            type: "tween",
            ease: [0.22, 0.0, 0.2, 1],
            duration: 0.9,
            delay: 0.25,
          },
        }),
      ]);
      if (cancelled) return;

      sparkCtrl.start({
        opacity: [0.2, 1, 0.5, 1, 0.7, 1],
        transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" },
      });
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [show, leftCtrl, rightCtrl, coreCtrl, sparkCtrl]);

  const overlay = (
    <AnimatePresence>
      {show && (
        <motion.div
          key="geode-overlay"
          className="fixed inset-0 z-[1000] grid place-items-center"
          aria-live="polite"
          role="status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className={`absolute inset-0 ${
              blurBg ? "backdrop-blur-sm" : ""
            } bg-black/35`}
          />
          <div className="relative w-[min(920px,94vw)]">
            <svg viewBox="0 0 900 420" className="w-full h-auto">
              <defs>
                <linearGradient id="stoneA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#bcb6aa" />
                  <stop offset="60%" stopColor="#9c9588" />
                  <stop offset="100%" stopColor="#7f796f" />
                </linearGradient>
                <linearGradient id="stoneB" x1="1" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c9c3b6" />
                  <stop offset="50%" stopColor="#a79e90" />
                  <stop offset="100%" stopColor="#6f6a61" />
                </linearGradient>
                <filter
                  id="softShadow"
                  x="-25%"
                  y="-25%"
                  width="150%"
                  height="150%"
                >
                  <feDropShadow
                    dx="0"
                    dy="8"
                    stdDeviation="14"
                    floodColor="#000"
                    floodOpacity="0.28"
                  />
                </filter>
                <filter
                  id="granite"
                  x="-20%"
                  y="-20%"
                  width="140%"
                  height="140%"
                >
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="0.8"
                    numOctaves="2"
                    seed="5"
                    result="n"
                  />
                  <feColorMatrix in="n" type="saturate" values="0" />
                  <feComponentTransfer>
                    <feFuncA type="table" tableValues="0 0.08" />
                  </feComponentTransfer>
                  <feBlend in="SourceGraphic" mode="multiply" />
                </filter>
                <linearGradient id="core" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.start} />
                  <stop offset="52%" stopColor={palette.mid} />
                  <stop offset="100%" stopColor={palette.end} />
                </linearGradient>
              </defs>

              <ellipse
                cx="450"
                cy="332"
                rx="230"
                ry="26"
                fill="#000"
                opacity="0.12"
              />

              {/* Crystal core */}
              <motion.g animate={coreCtrl} filter="url(#softShadow)">
                <polygon
                  points="250,312 350,210 455,232 520,308 410,356 300,342"
                  fill="url(#core)"
                />
                <polygon
                  points="350,210 455,232 415,268 328,252"
                  fill={palette.mid}
                  opacity="0.85"
                />
                <polygon
                  points="415,268 520,308 410,356 365,305"
                  fill={palette.end}
                  opacity="0.9"
                />
                <polygon
                  points="250,312 328,252 365,305 300,342"
                  fill={palette.start}
                  opacity="0.85"
                />
                <ellipse
                  cx="450"
                  cy="300"
                  rx="210"
                  ry="30"
                  fill={palette.start}
                  opacity={0.35}
                />
              </motion.g>

              {/* Left half */}
              <motion.g animate={leftCtrl} filter="url(#softShadow)">
                <g filter="url(#granite)">
                  <polygon
                    points="250,312 350,210 395,230 352,270 305,340"
                    fill="url(#stoneA)"
                  />
                  <polygon
                    points="350,210 395,230 352,270 328,252"
                    fill="url(#stoneB)"
                  />
                </g>
                <polyline
                  points="350,210 395,230 352,270 250,312"
                  fill="none"
                  stroke="#fff"
                  strokeOpacity="0.12"
                  strokeWidth="2"
                />
                <polyline
                  points="350,210 328,252 305,340"
                  fill="none"
                  stroke="#000"
                  strokeOpacity="0.18"
                  strokeWidth="2"
                />
              </motion.g>

              {/* Right half */}
              <motion.g animate={rightCtrl} filter="url(#softShadow)">
                <g filter="url(#granite)">
                  <polygon
                    points="395,230 520,308 410,356 365,305 352,270"
                    fill="url(#stoneA)"
                  />
                  <polygon
                    points="395,230 520,308 455,232"
                    fill="url(#stoneB)"
                  />
                </g>
                <polyline
                  points="395,230 520,308 410,356"
                  fill="none"
                  stroke="#fff"
                  strokeOpacity="0.12"
                  strokeWidth="2"
                />
                <polyline
                  points="395,230 352,270 365,305"
                  fill="none"
                  stroke="#000"
                  strokeOpacity="0.18"
                  strokeWidth="2"
                />
              </motion.g>

              {/* Sparkles */}
              <motion.g animate={sparkCtrl}>
                {Array.from({ length: 14 }).map((_, i) => {
                  const x = 320 + (i % 7) * 34 + (i % 2 ? 9 : -6);
                  const y = 252 + Math.floor(i / 7) * 28 + (i % 3 ? 6 : -4);
                  const r = i % 4 ? 2.2 : 3.6;
                  return (
                    <motion.circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={r}
                      fill={palette.accent}
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{
                        scale: [0.9, 1.25, 0.95, 1.15, 1],
                        opacity: [0.2, 1, 0.5, 1, 0.7],
                      }}
                      transition={{
                        duration: 2.6 + (i % 5) * 0.25,
                        repeat: Infinity,
                        delay: (i % 6) * 0.12,
                        ease: "easeInOut",
                      }}
                    />
                  );
                })}
              </motion.g>
            </svg>

            {/* label + progress */}
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-medium text-white shadow-sm backdrop-blur">
                <span className="inline-block h-2 w-2 rounded-full bg-[#E01C24] animate-pulse" />
                {label}
              </div>
              {typeof progress === "number" && (
                <div className="w-[min(560px,90vw)]">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                    <motion.div
                      className="h-2 bg-white"
                      initial={{ width: "0%" }}
                      animate={{
                        width: `${Math.min(100, Math.max(0, progress))}%`,
                      }}
                      transition={{ ease: "easeInOut", duration: 0.25 }}
                    />
                  </div>
                  <div className="mt-1 text-center text-[11px] text-white/85">
                    {Math.round(progress)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return mounted ? createPortal(overlay, document.body) : null;
}
