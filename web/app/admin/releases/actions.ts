"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/credits";
import { fdBool, fdStr } from "@/lib/form";
import { SECTION_FIELD as FIELD, SECTION_TITLES, checkText, isVersion, itemsFromText, normalizeNotes, type SectionTitle } from "@/lib/release-notes";
import { saveNotesOverride } from "@/lib/release-notes-db";

export type NotesState = { errors: string[] } | null;

function refresh() {
  revalidatePath("/admin/releases");
  revalidatePath("/changelog");
}

/** Saves, then reloads the editor with a confirmation (so the form shows what is really stored). */
export async function saveReleaseNotes(_prev: NotesState, fd: FormData): Promise<NotesState> {
  const admin = await requireAdmin();
  const version = fdStr(fd, "version", 20);
  if (!isVersion(version)) return { errors: ["Unknown version."] };
  const hidden = fdBool(fd, "hidden");
  const headline = fdStr(fd, "headline", 400);
  const texts = Object.fromEntries(SECTION_TITLES.map((t) => [t, fdStr(fd, FIELD[t], 20_000)])) as Record<SectionTitle, string>;

  // A hidden version needs no words; a shown one needs at least one point.
  const errors = hidden ? [] : checkText(headline, texts);
  if (errors.length) return { errors };

  const notes = normalizeNotes({
    headline,
    hidden,
    sections: SECTION_TITLES.map((title) => ({ title, items: itemsFromText(texts[title]) })),
  });
  try {
    await saveNotesOverride(version, notes, admin.email);
  } catch (err) {
    console.error("release notes save failed", err);
    return { errors: ["Could not save. Please try again."] };
  }
  await audit(admin.email, "release_notes.save", version, { hidden }).catch(() => {});
  refresh();
  redirect(`/admin/releases/edit?v=${version}&done=${hidden ? "hidden" : "saved"}`);
}

export async function resetReleaseNotes(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const version = fdStr(fd, "version", 20);
  if (!isVersion(version)) return;
  await saveNotesOverride(version, null, admin.email);
  await audit(admin.email, "release_notes.reset", version).catch(() => {});
  refresh();
  redirect(`/admin/releases/edit?v=${version}&done=reset`);
}
