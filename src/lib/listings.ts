import raw from "../../data/listings.json";

export type ListingType = "direct" | "sublease";
export type ListingCondition =
  | "pre-built"
  | "warm-shell"
  | "move-in-ready"
  | "cold-shell";
export type ListingAvailability =
  | "immediate"
  | "30-days"
  | "60-days"
  | "90-days";

export type Listing = {
  id: string;
  slug: string;
  address: string;
  unit: string;
  submarket: string;
  sf: number;
  pricePerSf: number;
  availability: ListingAvailability;
  type: ListingType;
  condition: ListingCondition;
  features: string[];
  description: string;
  heroImage: string;
  photos: string[];
  floorplan: string;
  buildingClass: string;
  yearBuilt: number;
};

export const LISTINGS: Listing[] = raw as Listing[];

/**
 * Canonical submarket list. `Grand Central Area` collapses into `Grand Central`
 * — source data contains both spellings and the LLM must see one enum value.
 */
export const SUBMARKETS = [
  "Hudson Yards",
  "Flatiron",
  "FiDi",
  "Midtown East",
  "Midtown West",
  "SoHo",
  "Tribeca",
  "Penn Station",
  "Grand Central",
  "Chelsea",
] as const;

export type Submarket = (typeof SUBMARKETS)[number];

const SUBMARKET_ALIASES: Record<string, Submarket> = {
  "grand central area": "Grand Central",
  "grand central": "Grand Central",
  "financial district": "FiDi",
  fidi: "FiDi",
  midtown: "Midtown East",
};

export function normalizeSubmarket(input: string | undefined | null): Submarket | null {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if (key in SUBMARKET_ALIASES) return SUBMARKET_ALIASES[key];
  const direct = SUBMARKETS.find((s) => s.toLowerCase() === key);
  return direct ?? null;
}

export type ListingFilter = {
  submarket?: string | null;
  sfMin?: number | null;
  sfMax?: number | null;
  features?: string[] | null;
  subleaseOrDirect?: ListingType | "any" | null;
};

/**
 * Pure filter — no side effects, no LLM calls. Testable and safe to run in
 * a Server Component on every request.
 */
export function applyFilter(listings: Listing[], filter: ListingFilter): Listing[] {
  const targetSubmarket = normalizeSubmarket(filter.submarket ?? undefined);
  const wantedFeatures = (filter.features ?? [])
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);

  return listings.filter((l) => {
    if (targetSubmarket && normalizeSubmarket(l.submarket) !== targetSubmarket) {
      return false;
    }
    if (filter.sfMin != null && l.sf < filter.sfMin) return false;
    if (filter.sfMax != null && l.sf > filter.sfMax) return false;
    if (
      filter.subleaseOrDirect &&
      filter.subleaseOrDirect !== "any" &&
      l.type !== filter.subleaseOrDirect
    ) {
      return false;
    }
    if (wantedFeatures.length > 0) {
      const hay = l.features.map((f) => f.toLowerCase()).join(" | ");
      const anyMatch = wantedFeatures.some((w) => hay.includes(w));
      if (!anyMatch) return false;
    }
    return true;
  });
}

export function findBySlug(slug: string): Listing | undefined {
  return LISTINGS.find((l) => l.slug === slug);
}

export function adjacentPhotos(listing: Listing): string[] {
  return [listing.heroImage, ...listing.photos, listing.floorplan];
}

export function formatSf(sf: number): string {
  return sf.toLocaleString("en-US");
}

export function formatPricePerSf(price: number): string {
  return `$${price}/SF`;
}

export function formatAnnualRent(listing: Listing): string {
  return `$${(listing.sf * listing.pricePerSf).toLocaleString("en-US")}/yr`;
}
