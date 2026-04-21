"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseBuildiumZip, type ParsedImport } from "@/lib/import/buildium";
import { commitImport } from "@/lib/import/commit";

async function stage(
  buffer: Buffer,
  source: "buildium_zip" | "buildium_sample",
): Promise<string> {
  const parsed = await parseBuildiumZip(buffer);
  const run = await prisma.importRun.create({
    data: {
      source,
      stats: JSON.stringify(parsed.stats),
      payload: JSON.stringify(parsed),
    },
  });
  return run.id;
}

export async function importFromSample() {
  const samplePath = path.resolve(
    process.cwd(),
    "data",
    "buildium_export.zip",
  );
  const buffer = await readFile(samplePath);
  const runId = await stage(buffer, "buildium_sample");
  redirect(`/import/preview/${runId}`);
}

export async function importFromUpload(formData: FormData) {
  const file = formData.get("zip");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No file uploaded");
  }
  const arrayBuffer = await file.arrayBuffer();
  const runId = await stage(Buffer.from(arrayBuffer), "buildium_zip");
  redirect(`/import/preview/${runId}`);
}

export async function commitImportRun(runId: string) {
  const run = await prisma.importRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Import run ${runId} not found`);
  if (run.committedAt) {
    // Idempotent at the run level: already committed, go straight to done.
    redirect(`/import/done/${runId}`);
  }

  const parsed = JSON.parse(run.payload) as ParsedImport;
  await commitImport(parsed);

  await prisma.importRun.update({
    where: { id: runId },
    data: { committedAt: new Date() },
  });

  revalidatePath("/dashboard");
  redirect(`/import/done/${runId}`);
}
