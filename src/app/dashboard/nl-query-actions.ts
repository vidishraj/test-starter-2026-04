"use server";

import { answerNLQuery, type NLQueryResponse } from "@/lib/ai/nl-query";

export async function runNLQuery(question: string): Promise<NLQueryResponse> {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      reply: "Type a question to get started.",
      spec: null,
      result: null,
      source: "fallback",
    };
  }
  return answerNLQuery(trimmed);
}
