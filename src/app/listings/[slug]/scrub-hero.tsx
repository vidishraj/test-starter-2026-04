"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type Props = {
  slides: { src: string; label: string; kind: "photo" | "floorplan" }[];
  address: string;
  unit: string;
};

export default function ScrubHero({ slides, address, unit }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Update index when user scroll-snaps (native scroll, wheel, touch)
  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const slideWidth = el.clientWidth;
    const next = Math.round(el.scrollLeft / slideWidth);
    if (next !== index) setIndex(next);
  }, [index]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        handleScroll();
        ticking = false;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [handleScroll]);

  // Keyboard: arrow keys while hero is focused or hovered
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement;
      if (isInput) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(Math.max(0, index - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(Math.min(slides.length - 1, index + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, slides.length]);

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setIndex(i);
  };

  // Pointer drag — mouse-only. Touch already gets native scroll-snap.
  //
  // Smoothness notes:
  //   * scrollLeft writes are coalesced into a single rAF frame per tick —
  //     multiple pointermove events in one frame collapse to one DOM write.
  //   * Velocity is sampled in a rolling 4-point buffer. On release, if the
  //     user was flicking, we resolve to the adjacent slide in the flick
  //     direction instead of just the nearest — feels like a native swipe.
  //   * scroll-snap stays disabled for the whole drag; we restore it after
  //     smooth-scrolling to the final slide so the browser doesn't fight us.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    let startX = 0;
    let startScroll = 0;
    let pointerId: number | null = null;
    let rafId: number | null = null;
    let pendingScroll = 0;
    let lastX = 0;
    let lastTs = 0;
    const velocitySamples: { dx: number; dt: number }[] = [];

    const flushScroll = () => {
      rafId = null;
      el.scrollLeft = pendingScroll;
    };

    const queueScroll = (next: number) => {
      pendingScroll = next;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushScroll);
      }
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      lastX = e.clientX;
      lastTs = performance.now();
      velocitySamples.length = 0;
      setIsDragging(true);
      el.style.scrollSnapType = "none";
      el.style.scrollBehavior = "auto"; // never fight our rAF loop with native smoothing
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture can fail on some touch devices — safe to ignore */
      }
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      const dt = now - lastTs;
      if (dt > 0) {
        velocitySamples.push({ dx, dt });
        if (velocitySamples.length > 4) velocitySamples.shift();
      }
      lastX = e.clientX;
      lastTs = now;
      queueScroll(startScroll - (e.clientX - startX));
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      pointerId = null;
      setIsDragging(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      el.style.scrollSnapType = "";
      el.style.scrollBehavior = "";

      // Compute velocity (px/ms) from the rolling window
      let totalDx = 0;
      let totalDt = 0;
      for (const s of velocitySamples) {
        totalDx += s.dx;
        totalDt += s.dt;
      }
      const velocity = totalDt > 0 ? totalDx / totalDt : 0; // px/ms; + = dragging right, - = left
      const slideWidth = el.clientWidth;
      const raw = el.scrollLeft / slideWidth;
      let target = Math.round(raw);

      // Flick threshold: ~0.35 px/ms sustained = "user was swiping"
      const FLICK = 0.35;
      if (velocity < -FLICK) target = Math.ceil(raw); // flicked left → next slide right
      else if (velocity > FLICK) target = Math.floor(raw); // flicked right → previous slide

      target = Math.max(0, Math.min(slides.length - 1, target));
      el.scrollTo({ left: target * slideWidth, behavior: "smooth" });
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [slides.length]);

  return (
    <div className="relative bg-ink/[0.04] border-y border-border select-none">
      <div
        ref={trackRef}
        className={`scrub-track flex overflow-x-auto ${
          isDragging ? "grabbing" : "cursor-grab"
        }`}
        aria-roledescription="carousel"
        aria-label={`Photos and floor plan for ${address} ${unit}`}
        tabIndex={0}
      >
        {slides.map((s, i) => (
          <div
            key={s.src}
            className="scrub-slide shrink-0 w-full aspect-[16/9] flex items-center justify-center p-2 sm:p-4"
            aria-hidden={i !== index}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.src}
              alt={s.label}
              draggable={false}
              width={s.kind === "floorplan" ? 1200 : 1600}
              height={s.kind === "floorplan" ? 800 : 1000}
              loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={i === 0 ? "high" : "auto"}
              sizes="(min-width: 1280px) 1280px, 100vw"
              className="h-full w-full object-contain bg-bg-elevated rounded-lg border border-border pointer-events-none"
            />
          </div>
        ))}
      </div>

      {/* Controls */}
      <button
        type="button"
        onClick={() => goTo(Math.max(0, index - 1))}
        aria-label="Previous image"
        disabled={index === 0}
        className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-bg-elevated/90 backdrop-blur border border-border text-ink disabled:opacity-40 hover:bg-bg-elevated transition"
      >
        ←
      </button>
      <button
        type="button"
        onClick={() => goTo(Math.min(slides.length - 1, index + 1))}
        aria-label="Next image"
        disabled={index === slides.length - 1}
        className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-bg-elevated/90 backdrop-blur border border-border text-ink disabled:opacity-40 hover:bg-bg-elevated transition"
      >
        →
      </button>

      {/* Index + label pill */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-full bg-ink/85 text-white px-4 py-2 text-xs font-mono tracking-wide backdrop-blur">
        <span>
          {String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
        </span>
        <span className="opacity-60">·</span>
        <span className="uppercase tracking-[0.14em] opacity-90">
          {slides[index]?.label}
        </span>
      </div>

      {/* Scrub dots */}
      <div className="absolute bottom-4 right-5 hidden sm:flex gap-1.5">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => goTo(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? "bg-white w-6" : "bg-white/40 w-1.5 hover:bg-white/70"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
