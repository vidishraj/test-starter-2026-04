import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  SUBMARKETS,
  normalizeSubmarket,
  type ListingFilter,
} from "@/lib/listings";

/**
 * Single Anthropic call that returns (a) a short conversational reply and
 * (b) a structured filter, in one response. We rely on Haiku 4.5 — the task
 * is parse + paraphrase, not synthesis, so Sonnet is wasted spend.
 *
 * tool_choice "any" forces the model to call the single registered tool.
 * Text blocks may still precede tool_use in the response, which is how we
 * get the conversational reply in the same call.
 */

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are the AI search assistant for Beyond the Space, a chat-first NYC office-space search product.

The user describes the space they want in plain English. Your job is two things, in one response:

1. Write ONE short conversational sentence (max ~20 words) acknowledging what you heard. Warm, confident, no markdown, no lists, no preambles like "Sure!". Write as if you were a seasoned broker replying.
2. Call the apply_filter tool with the best structured interpretation of the query. Always call the tool, even if intent is partial — the UI falls back gracefully when a field is missing.

Guidance for the filter:
- submarket must be one of the enum values. If the user mentions a neighborhood you don't have (e.g. "Williamsburg"), omit submarket entirely rather than guess.
- sfMin/sfMax: infer from headcount when useful (~200 SF per person for creative offices, ~250 SF for professional services). "10k SF" means ~10000; add a ±20% window unless the user is specific.
- features: free-text short phrases that might match listing features — "outdoor", "furnished", "pre-built", "column-free", "natural light", etc. Keep to ≤3.
- subleaseOrDirect: "sublease" or "direct" only if the user explicitly said so; otherwise "any".`;

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
        description: "Canonical NYC submarket. Omit if user's locale is unclear or unsupported.",
      },
      sfMin: {
        type: "number",
        description: "Minimum square feet.",
      },
      sfMax: {
        type: "number",
        description: "Maximum square feet.",
      },
      features: {
        type: "array",
        items: { type: "string" },
        description:
          "Short free-text feature phrases that should fuzzy-match listing features.",
      },
      subleaseOrDirect: {
        type: "string",
        enum: ["sublease", "direct", "any"],
        description: "Lease type preference. Default to 'any' unless stated.",
      },
    },
    required: [],
  },
};

export type ParseResult = {
  reply: string;
  filter: ListingFilter;
  source: "llm" | "fallback";
  notice?: string;
};

export async function parseSearch(query: string): Promise<ParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ...heuristicFallback(query),
      notice: "AI parse is offline — using a basic keyword match.",
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.2,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [filterTool],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: query }],
    });

    let reply = "";
    let rawFilter: unknown = null;
    for (const block of response.content) {
      if (block.type === "text") reply += block.text;
      if (block.type === "tool_use" && block.name === "apply_filter") {
        rawFilter = block.input;
      }
    }

    const parsed = filterSchema.safeParse(rawFilter);
    if (!parsed.success) {
      return {
        ...heuristicFallback(query),
        notice: "I had trouble parsing that — showing a broader match.",
      };
    }

    return {
      reply: reply.trim() || defaultReplyFor(query),
      filter: {
        submarket: parsed.data.submarket ?? null,
        sfMin: parsed.data.sfMin ?? null,
        sfMax: parsed.data.sfMax ?? null,
        features: parsed.data.features ?? null,
        subleaseOrDirect: parsed.data.subleaseOrDirect ?? "any",
      },
      source: "llm",
    };
  } catch (err) {
    console.error("[parseSearch] LLM call failed:", err);
    return {
      ...heuristicFallback(query),
      notice: "AI is temporarily unavailable — showing a keyword match.",
    };
  }
}

/**
 * Regex/keyword fallback for when the LLM is unavailable. Deliberately
 * coarse — enough to return a useful result, not enough to pretend it's
 * the real parser. Surfaced to the user via `notice`.
 */
function heuristicFallback(query: string): ParseResult {
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

  const sfMatch = q.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|sf|sqft|square\s*feet)?/);
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
    reply: defaultReplyFor(query),
    filter: {
      submarket,
      sfMin: sfTarget ? Math.round(sfTarget * 0.8) : null,
      sfMax: sfTarget ? Math.round(sfTarget * 1.2) : null,
      features: null,
      subleaseOrDirect,
    },
    source: "fallback",
  };
}

function defaultReplyFor(query: string): string {
  const clean = query.trim().replace(/\s+/g, " ");
  const snippet = clean.length > 60 ? clean.slice(0, 60) + "…" : clean;
  return `Here's what I found for "${snippet}".`;
}
