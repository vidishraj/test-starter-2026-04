import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  SUBMARKETS,
  normalizeSubmarket,
  type ListingFilter,
} from "@/lib/listings";

/**
 * Single streamed Anthropic call that fans out into two independently-
 * resolving promises:
 *
 *   - filterPromise resolves the moment the `apply_filter` tool_use block
 *     finishes. Downstream, this unblocks the listing-card grid so cards
 *     render as soon as we know what to show.
 *
 *   - replyPromise resolves when the conversational text block finishes.
 *     It fills the AI bubble under a nested Suspense.
 *
 * The system prompt is ordered so tool_use is emitted BEFORE text — that
 * way the filter lands well ahead of the prose and cards don't have to
 * wait on synthesis. The React tree uses two Suspense boundaries to stream
 * the two resolutions independently.
 *
 * Model: Haiku 4.5. This is parse + paraphrase, not synthesis — Sonnet is
 * wasted spend. System prompt carries an ephemeral cache_control so repeat
 * traffic pays cached read prices.
 */

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are the AI search assistant for Beyond the Space, a chat-first NYC office-space search product. Think "seasoned NYC office broker talking to a founder" — warm, direct, no filler.

Every response MUST contain BOTH of the following — non-negotiable, in this order:

1. A text block: ONE short conversational sentence (10-20 words) that acknowledges what the user asked for. This text IS required — do NOT skip it. Do not start with "Sure", "Certainly", "Here are…", "I found…", "Great question". Write like a broker who's read the brief: "Hudson Yards is tight right now but I pulled a few worth walking." or "Pre-built sublease under 5k SF, got it — here's what's open."
2. A tool_use block calling apply_filter with the best structured interpretation. Always call the tool — even on partial intent, the UI handles missing fields.

Example of a correct response shape (both blocks present):

  text: "Sublease near Penn under 8k SF — a couple are recent sublets worth a look."
  tool_use: apply_filter({ submarket: "Penn Station", sfMax: 8000, subleaseOrDirect: "sublease" })

Filter guidance:
- submarket must be one of the enum values. If the user mentions a neighborhood not in the enum (e.g. "Williamsburg"), omit submarket rather than guess.
- sfMin/sfMax: infer from headcount when useful (~200 SF/person creative, ~250 SF/person professional services). "10k SF" → ~10000; add ±20% unless the user is precise.
- features: up to 3 free-text phrases that can fuzzy-match listing features ("outdoor", "furnished", "pre-built", "column-free", "natural light").
- subleaseOrDirect: "sublease" or "direct" only if the user said so; otherwise "any".`;

const filterSchema = z.object({
  submarket: z.string().nullish(),
  sfMin: z.number().nullish(),
  sfMax: z.number().nullish(),
  features: z.array(z.string()).nullish(),
  subleaseOrDirect: z.enum(["sublease", "direct", "any"]).nullish(),
});

const filterTool: Anthropic.Tool = {
  name: "apply_filter",
  description:
    "Apply a structured filter to the NYC office listings catalog based on the user's free-text query.",
  input_schema: {
    type: "object",
    properties: {
      submarket: {
        type: "string",
        enum: [...SUBMARKETS],
        description:
          "Canonical NYC submarket. Omit if the user's locale is unclear or outside the enum.",
      },
      sfMin: { type: "number", description: "Minimum square feet." },
      sfMax: { type: "number", description: "Maximum square feet." },
      features: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to 3 short free-text feature phrases for fuzzy matching.",
      },
      subleaseOrDirect: {
        type: "string",
        enum: ["sublease", "direct", "any"],
        description: "Lease type preference. Default 'any' unless stated.",
      },
    },
    required: [],
  },
};

export type ResolvedFilter = {
  filter: ListingFilter;
  source: "llm" | "fallback";
  notice?: string;
};

export type StreamedSearch = {
  filterPromise: Promise<ResolvedFilter>;
  replyPromise: Promise<string>;
};

export function streamSearch(query: string): StreamedSearch {
  // No API key → resolve both with the heuristic fallback immediately.
  // UI still renders cards + bubble, plus a visible notice explaining why.
  if (!process.env.ANTHROPIC_API_KEY) {
    const h = heuristicFallback(query);
    return {
      filterPromise: Promise.resolve({
        filter: h.filter,
        source: "fallback",
        notice: "AI parse is offline — using a basic keyword match.",
      }),
      replyPromise: Promise.resolve(h.reply),
    };
  }

  let resolveFilter!: (r: ResolvedFilter) => void;
  let resolveReply!: (r: string) => void;
  const filterPromise = new Promise<ResolvedFilter>((r) => (resolveFilter = r));
  const replyPromise = new Promise<string>((r) => (resolveReply = r));

  let filterSettled = false;
  let replySettled = false;

  (async () => {
    try {
      const client = new Anthropic();
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 500,
        temperature: 0.2,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [filterTool],
        // `auto` (vs `any`) gives Haiku room to emit a text block alongside
        // the tool_use. `any` forces a tool call but often drops prose
        // entirely — the user-facing reply goes missing. With the system
        // prompt mandating both outputs, `auto` reliably produces both.
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: query }],
      });

      // Resolve filterPromise the moment the tool_use block finishes.
      // Resolve replyPromise the moment a text block finishes.
      stream.on("contentBlock", (block) => {
        if (block.type === "tool_use" && block.name === "apply_filter" && !filterSettled) {
          const parsed = filterSchema.safeParse(block.input);
          if (parsed.success) {
            filterSettled = true;
            resolveFilter({
              filter: {
                submarket: parsed.data.submarket ?? null,
                sfMin: parsed.data.sfMin ?? null,
                sfMax: parsed.data.sfMax ?? null,
                features: parsed.data.features ?? null,
                subleaseOrDirect: parsed.data.subleaseOrDirect ?? "any",
              },
              source: "llm",
            });
          }
        }
        if (block.type === "text" && !replySettled) {
          const text = block.text.trim();
          if (text) {
            replySettled = true;
            resolveReply(text);
          }
        }
      });

      await stream.finalMessage();

      // Post-stream fallbacks for anything that never settled.
      if (!filterSettled) {
        const h = heuristicFallback(query);
        filterSettled = true;
        resolveFilter({
          filter: h.filter,
          source: "fallback",
          notice: "I had trouble parsing that — showing a broader match.",
        });
      }
      if (!replySettled) {
        replySettled = true;
        resolveReply(defaultReplyFor(query));
      }
    } catch (err) {
      console.error("[streamSearch] LLM stream failed:", err);
      const h = heuristicFallback(query);
      if (!filterSettled) {
        filterSettled = true;
        resolveFilter({
          filter: h.filter,
          source: "fallback",
          notice: "AI is temporarily unavailable — showing a keyword match.",
        });
      }
      if (!replySettled) {
        replySettled = true;
        resolveReply(h.reply);
      }
    }
  })();

  return { filterPromise, replyPromise };
}

/**
 * Regex/keyword fallback for when the LLM is unavailable. Deliberately
 * coarse — enough to return a useful result, not enough to pretend it's
 * the real parser. Surfaced to the user via the bubble's `notice` line.
 */
function heuristicFallback(query: string): { filter: ListingFilter; reply: string } {
  const q = query.toLowerCase();

  let submarket: string | null = null;
  for (const sm of SUBMARKETS) {
    if (q.includes(sm.toLowerCase())) {
      submarket = sm;
      break;
    }
  }
  if (!submarket) {
    const alias = normalizeSubmarket(q);
    if (alias) submarket = alias;
  }

  const sfMatch = q.match(
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|sf|sqft|square\s*feet)?/,
  );
  let sfTarget: number | null = null;
  if (sfMatch) {
    const num = parseFloat(sfMatch[1].replace(/,/g, ""));
    const unit = sfMatch[2];
    if (unit === "k") sfTarget = num * 1000;
    else if (num >= 500) sfTarget = num;
  }

  const subleaseOrDirect: ListingFilter["subleaseOrDirect"] = q.includes("sublease")
    ? "sublease"
    : q.includes("direct")
      ? "direct"
      : "any";

  return {
    filter: {
      submarket,
      sfMin: sfTarget ? Math.round(sfTarget * 0.8) : null,
      sfMax: sfTarget ? Math.round(sfTarget * 1.2) : null,
      features: null,
      subleaseOrDirect,
    },
    reply: defaultReplyFor(query),
  };
}

function defaultReplyFor(query: string): string {
  const clean = query.trim().replace(/\s+/g, " ");
  const snippet = clean.length > 60 ? clean.slice(0, 60) + "…" : clean;
  return `Here's what I found for "${snippet}".`;
}
