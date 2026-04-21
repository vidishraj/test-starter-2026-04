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
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    let startX = 0;
    let startScroll = 0;
    let pointerId: number | null = null;

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      setIsDragging(true);
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      el.scrollLeft = startScroll - (e.clientX - startX);
    };
    const up = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      pointerId = null;
      setIsDragging(false);
      // Snap to nearest slide
      const slideWidth = el.clientWidth;
      const snapTo = Math.round(el.scrollLeft / slideWidth);
      el.scrollTo({ left: snapTo * slideWidth, behavior: "smooth" });
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
    };
  }, []);

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
              loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
              className={`h-full w-full object-contain ${
                s.kind === "floorplan" ? "bg-bg-elevated" : "bg-bg-elevated"
              } rounded-lg border border-border pointer-events-none`}
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
