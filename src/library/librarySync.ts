/**
 * Rebuilds the local sqlite cache (`library.db`) from the on-disk library-data tree —
 * the "files -> cache" direction of the write-through architecture described in
 * `libraryRoot.ts`. Call `syncLibraryFromDisk()` on startup (once a root is configured)
 * and from a manual "Sync Now" button, so a folder someone else updated (a `git pull`
 * on the org data repo, a synced drive, or the catalog-import pipeline promoting new
 * parts) shows up in this app's Library panel without a reinstall.
 *
 * One-directional and non-destructive: it only ever upserts, matching sqlite's
 * ON CONFLICT(id) DO UPDATE semantics (see db.ts). Rows that exist in sqlite but have
 * no corresponding file (e.g. added before a library root was ever connected) are left
 * alone rather than deleted, so connecting a folder for the first time can never
 * silently wipe out existing local data. Insert order matters — categories reference
 * families, attribute definitions and real parts reference categories — so families and
 * symbols go first.
 */
import * as db from './db';
import { ensureLibraryTree, readCategories, readFamilies, readParts, readSymbols } from './fileStore';
import { withWriteThroughSuppressed } from './libraryRoot';

export interface LibrarySyncResult {
  families: number;
  categories: number;
  attributeDefinitions: number;
  symbols: number;
  parts: number;
}

export async function syncLibraryFromDisk(root: string): Promise<LibrarySyncResult> {
  return withWriteThroughSuppressed(async () => {
    await ensureLibraryTree(root);

    const families = await readFamilies(root);
    for (const f of families) await db.upsertFamily(f);

    const symbols = await readSymbols(root);
    for (const s of symbols) await db.upsertSymbol(s);

    const categories = await readCategories(root);
    let attributeDefinitions = 0;
    for (const { category, attributeDefinitions: attrs } of categories) {
      await db.upsertCategory(category);
      for (const a of attrs) {
        await db.upsertAttributeDefinition(a);
        attributeDefinitions++;
      }
    }

    const parts = await readParts(root);
    for (const p of parts) await db.upsertRealPart(p);

    return { families: families.length, categories: categories.length, attributeDefinitions, symbols: symbols.length, parts: parts.length };
  });
}
