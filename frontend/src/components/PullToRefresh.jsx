import React, { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ChevronDown } from "lucide-react";

const THRESHOLD = 70;
const MAX_PULL = 120;

export default function PullToRefresh({ onRefresh, children }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const pullRef = useRef(0);

  const onTouchStart = (e) => {
    if (refreshing) return;
    if (window.scrollY <= 0) {
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    } else {
      pulling.current = false;
    }
  };

  const onTouchMove = (e) => {
    if (!pulling.current || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) {
      const resisted = Math.min(delta * 0.5, MAX_PULL);
      pullRef.current = resisted;
      setPull(resisted);
    }
  };

  const onTouchEnd = async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullRef.current >= THRESHOLD) {
      setRefreshing(true);
      setPull(THRESHOLD);
      pullRef.current = THRESHOLD;
      try {
        await onRefresh?.();
      } finally {
        setRefreshing(false);
        setPull(0);
        pullRef.current = 0;
      }
    } else {
      setPull(0);
      pullRef.current = 0;
    }
  };

  const progress = Math.min(pull / THRESHOLD, 1);
  const showIndicator = pull > 0 || refreshing;

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="relative"
    >
      {showIndicator && (
        <div
          className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 flex items-center justify-center"
          style={{ top: "max(8px, env(safe-area-inset-top))" }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-sm">
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown
                className="h-4 w-4 text-muted-foreground transition-transform"
                style={{ transform: `rotate(${180 * progress}deg)` }}
              />
            )}
          </div>
        </div>
      )}
      <motion.div animate={{ y: pull }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
        {children}
      </motion.div>
    </div>
  );
}
