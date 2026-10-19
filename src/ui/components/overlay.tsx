"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { IconName } from "../icons";
import { Toast } from "./feedback";

const EASE = [0.2, 0.8, 0.2, 1] as const;

let scrollLocks = 0;
/** While a sheet is open the page behind it doesn't scroll. */
function lockPageScroll() {
  const html = document.documentElement;
  if (scrollLocks++ === 0) html.style.overflow = "hidden";
  return () => {
    if (--scrollLocks === 0) html.style.overflow = "";
  };
}

/** Swipe down anywhere on the sheet closes it, as long as its content is scrolled to the top (otherwise it scrolls). */
function useSwipeToClose(sheet: RefObject<HTMLDivElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    const el = sheet.current;
    if (!open || !el) return;
    let x0 = 0, y0 = 0, dy = 0, lastY = 0, lastT = 0, speed = 0;
    let mode: "pending" | "drag" | "scroll" = "scroll";
    const move = (y: number, animated = false) => {
      el.style.transition = animated ? "translate 200ms cubic-bezier(.2,.8,.2,1)" : "none";
      el.style.setProperty("translate", y ? `0 ${y}px` : "");
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return void (mode = "scroll");
      x0 = e.touches[0].clientX;
      y0 = lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
      dy = speed = 0;
      mode = "pending";
    };
    const touchMove = (e: TouchEvent) => {
      if (mode === "scroll") return;
      const { clientX: x, clientY: y } = e.touches[0];
      if (mode === "pending") {
        if (Math.abs(y - y0) < 8 && Math.abs(x - x0) < 8) return;
        // down, mostly vertical, content at the top → drag the sheet; anything else is a normal scroll
        mode = y > y0 && Math.abs(y - y0) > Math.abs(x - x0) && el.scrollTop <= 0 ? "drag" : "scroll";
        if (mode === "scroll") return;
        y0 = y;
      }
      e.preventDefault();
      dy = Math.max(0, y - y0);
      speed = (y - lastY) / Math.max(1, e.timeStamp - lastT); // px/ms
      lastY = y;
      lastT = e.timeStamp;
      move(dy);
    };
    const end = () => {
      if (mode !== "drag") return void (mode = "scroll");
      mode = "scroll";
      if (dy > 120 || speed > 0.6) onClose();
      else move(0, true);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [sheet, open, onClose]);
}

/** Modal bottom sheet: scrim, slide up (280 ms), swipe down (anywhere on touch, the handle with a mouse) or tap outside to close. */
export function BottomSheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const unlock = lockPageScroll();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [open, onClose]);
  useSwipeToClose(sheet, open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <motion.div className="absolute inset-0 touch-none bg-[var(--scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div
            ref={sheet}
            role="dialog"
            aria-modal
            aria-label={label}
            className="relative mx-auto flex max-h-[92dvh] w-full max-w-[560px] flex-col gap-3.5 overflow-y-auto overscroll-contain rounded-t-[28px] bg-surface2 px-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-calma"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <Grabber sheet={sheet} onClose={onClose} />
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Mouse drag-down-to-close on the handle (touch is handled by useSwipeToClose); moves the sheet with `translate`, which the open/close animation (transform) doesn't own. */
function Grabber({ sheet, onClose }: { sheet: RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const move = (y: number) => sheet.current?.style.setProperty("translate", y ? `0 ${y}px` : "");
  return (
    <motion.div
      aria-hidden
      className="-mx-5 flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1"
      onPan={(e: PointerEvent, info: PanInfo) => e.pointerType !== "touch" && move(Math.max(0, info.offset.y))}
      onPanEnd={(e: PointerEvent, info: PanInfo) => {
        if (e.pointerType === "touch") return;
        if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        else move(0);
      }}
    >
      <div className="h-1 w-9 rounded-sm bg-border2" />
    </motion.div>
  );
}

// ---------- toasts ----------

interface ToastItem {
  id: number;
  message: string;
  icon?: IconName;
  action?: string;
  onAction?: () => void;
}

const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++seq.current;
    setItems([{ ...t, id }]); // one at a time, as in the design
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {/* below sheets (z-40), above the tab bar (z-30) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[35] mx-auto flex max-w-[560px] flex-col gap-2 px-4 md:bottom-6">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} className="pointer-events-auto" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.2, ease: EASE }}>
              <Toast
                icon={t.icon}
                message={t.message}
                action={t.action}
                onAction={() => {
                  t.onAction?.();
                  setItems((xs) => xs.filter((x) => x.id !== t.id));
                }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
