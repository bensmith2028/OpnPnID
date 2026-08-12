/**
 * The staging schema an external catalog-extraction agent writes into
 * `users/<name>/imports/extracted/*.json` (see `libraryRoot.ts`'s folder layout), plus
 * the promotion step that turns a reviewed candidate into a real, synced library entry.
 *
 * Deliberately no UI yet: extraction (catalog PDF -> candidate JSON) stays an external,
 * manually-run agent for now, and review happens by hand-editing/moving files until an
 * in-app "Import Queue" is built on top of `listExtractedCandidates`/
 * `promoteExtractedPart`/`rejectExtractedPart` — the three functions that UI will call.
 *
 * The extraction agent won't know this app's internal category ids, so a candidate
 * carries a `categoryHint` (family/subtype/actuation/portCount guess) instead;
 * `scoreCategoryMatch`/`bestCategoryMatch` resolve that hint against the real,
 * already-synced categories so a human only has to confirm/correct a suggestion rather
 * than pick one from scratch.
 */
import { readDir, readTextFile, remove } from '@tauri-apps/plugin-fs';
import type { RealPart } from './db';
import * as db from './db';
import { importsExtractedDir } from './libraryRoot';

export interface CategoryHint {
  family: string;
  subtype?: string | null;
  actuation?: string | null;
  portCount?: number | null;
}

export interface ExtractedPartCandidate {
  manufacturer: string;
  modelNumber: string;
  categoryHint: CategoryHint;
  description?: string | null;
  datasheetUrl?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  specs?: Record<string, string | number | boolean>;
  /** Provenance — which catalog/page this came from, and how confident the extraction
   * agent was. Purely informational; not stored on the promoted RealPart. */
  sourceFile?: string;
  sourcePage?: number;
  confidence?: number;
}

export interface ExtractedCandidateFile {
  fileName: string;
  path: string;
  candidate: ExtractedPartCandidate;
}

/** Lists every pending candidate in `users/<user>/imports/extracted/`, skipping files
 * that don't parse (left in place — not this function's job to clean up bad output). */
export async function listExtractedCandidates(root: string, user?: string): Promise<ExtractedCandidateFile[]> {
  const dir = await importsExtractedDir(root, user);
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return [];
  }
  const out: ExtractedCandidateFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith('.json')) continue;
    const path = `${dir}/${entry.name}`;
    try {
      const candidate = JSON.parse(await readTextFile(path)) as ExtractedPartCandidate;
      out.push({ fileName: entry.name, path, candidate });
    } catch {
      // Unparsable/partial write — surfaced to a human by simply not showing up as a
      // valid candidate; the raw file stays put for inspection.
    }
  }
  return out;
}

/** A category shape wide enough to score against a hint — callers join `familyName` in
 * themselves (a plain `db.Category` only has `familyId`), so this stays decoupled from
 * exactly how that join is fetched. */
export interface MatchableCategory {
  familyName: string;
  subtype: string | null;
  actuation: string | null;
  portCount: number;
}

/** Scores how well an existing category matches a candidate's `categoryHint` — higher
 * is better, 0 means "no real match" (family name didn't match at all, the one
 * dimension treated as required rather than a bonus). Case-insensitive, whitespace-
 * trimmed comparisons throughout since extracted text is rarely normalized. */
export function scoreCategoryMatch(hint: CategoryHint, category: MatchableCategory): number {
  if (norm(hint.family) !== norm(category.familyName)) return 0;
  let score = 1;
  if (hint.subtype && category.subtype && norm(hint.subtype) === norm(category.subtype)) score += 2;
  if (hint.actuation && category.actuation && norm(hint.actuation) === norm(category.actuation)) score += 2;
  if (hint.portCount != null && hint.portCount === category.portCount) score += 1;
  return score;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Picks the highest-scoring category for a hint, or null if nothing scored above 0
 * (i.e. no category even shares the hinted family). Ties keep whichever was seen first. */
export function bestCategoryMatch<T extends MatchableCategory>(hint: CategoryHint, categories: T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const category of categories) {
    const score = scoreCategoryMatch(hint, category);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

/** Writes the candidate into the library as a real part under `categoryId` (synced to
 * disk automatically via `db.ts`'s write-through, same as any other in-app edit), then
 * removes it from the staging folder. This is the only place a candidate becomes a real
 * `RealPart` — call it only once a human has confirmed the category and skimmed the
 * specs, since extraction quality varies a lot by manufacturer/catalog layout. */
export async function promoteExtractedPart(file: ExtractedCandidateFile, categoryId: string): Promise<RealPart> {
  const part = await db.upsertRealPart({
    categoryId,
    manufacturer: file.candidate.manufacturer,
    modelNumber: file.candidate.modelNumber,
    description: file.candidate.description ?? null,
    datasheetUrl: file.candidate.datasheetUrl ?? null,
    imageUrl: file.candidate.imageUrl ?? null,
    price: file.candidate.price ?? null,
    currency: file.candidate.currency ?? null,
    specs: file.candidate.specs ?? {},
  });
  await remove(file.path).catch(() => {});
  return part;
}

/** Discards a candidate without promoting it (bad extraction, duplicate, out of scope). */
export async function rejectExtractedPart(file: ExtractedCandidateFile): Promise<void> {
  await remove(file.path).catch(() => {});
}
