"use client";

import { useFormStatus } from "react-dom";

export default function SampleButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full border border-ink text-ink py-3 text-sm font-medium hover:bg-ink hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Parsing sample…" : "Try with sample data"}
    </button>
  );
}
