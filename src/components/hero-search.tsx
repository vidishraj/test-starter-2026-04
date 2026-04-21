"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  chips: string[];
  initialQuery?: string;
  size?: "hero" | "compact";
  placeholder?: string;
};

export default function HeroSearch({
  chips,
  initialQuery = "",
  size = "hero",
  placeholder = "e.g. 10,000 SF pre-built sublease near Grand Central",
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialQuery);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const onChipClick = (chip: string) => {
    setValue(chip);
    inputRef.current?.focus();
    submit(chip);
  };

  const isHero = size === "hero";

  return (
    <div className="w-full">
      <form
        action="/search"
        method="get"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className={
          isHero
            ? "relative rounded-full border border-border-strong bg-bg-elevated shadow-[0_1px_0_rgba(0,0,0,0.02),0_20px_60px_-30px_rgba(15,30,58,0.25)] focus-within:border-ink transition-colors"
            : "relative rounded-full border border-border bg-bg-elevated focus-within:border-ink transition-colors"
        }
      >
        <input
          ref={inputRef}
          type="text"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={
            isHero
              ? "w-full bg-transparent pl-7 pr-36 py-5 text-[17px] placeholder:text-muted-2 focus:outline-none"
              : "w-full bg-transparent pl-5 pr-28 py-3 text-[15px] placeholder:text-muted-2 focus:outline-none"
          }
        />
        <button
          type="submit"
          className={
            isHero
              ? "absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-ink text-white px-6 py-3 text-sm font-medium tracking-tight hover:bg-black transition-colors"
              : "absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-ink text-white px-4 py-2 text-sm font-medium tracking-tight hover:bg-black transition-colors"
          }
        >
          {isHero ? "Find space" : "Refine"}
        </button>
      </form>

      {chips.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${isHero ? "mt-6" : "mt-4"}`}>
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onChipClick(chip)}
              className="rounded-full border border-border bg-bg-elevated px-4 py-2 text-sm text-muted hover:text-fg hover:border-ink hover:bg-bg-elevated transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
