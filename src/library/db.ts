/**
 * Typed wrapper over the component library SQLite database (schema + seed data defined
 * in `src-tauri/src/lib.rs`'s migrations). One function per CRUD operation — no ORM,
 * this is a small enough schema that hand-written parameterized SQL stays readable and
 * avoids a dependency for four tables. All access goes through the `@tauri-apps/plugin-sql`
 * JS API directly (no custom Rust commands), consistent with how fs/dialog are used.
 *
 * Hierarchy: `Family` (Valve, Pump, ... — a loose UI grouping + ISA tag letter, no
 * symbol/attribute logic of its own) → `Category` (Automated 2-Way Valve — the real
 * classification: owns the symbol, port count, and its own attribute schema) →
 * `RealPart` (Berkurt X100 — a specific manufacturer/model within a category).
 */
import Database from '@tauri-apps/plugin-sql';
import type { ComponentSnapshot, RealPartSnapshot } from '../types/geometry';
import { resolveSymbol } from './builtinSymbols';

let dbPromise: Promise<Database> | null = null;
function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load('sqlite:library.db');
  return dbPromise;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export interface Family {
  id: string;
  name: string;
  tagLetter: string | null;
  sortOrder: number;
}

export type AttributeType = 'text' | 'number' | 'select' | 'boolean' | 'url';

export interface AttributeDefinition {
  id: string;
  categoryId: string;
  key: string;
  label: string;
  type: AttributeType;
  unit: string | null;
  options: string[] | null;
  required: boolean;
  sortOrder: number;
}

export interface Category {
  id: string;
  familyId: string;
  name: string;
  subtype: string | null;
  actuation: string | null;
  portCount: number;
  symbolId: string | null;
}

export interface RealPart {
  id: string;
  categoryId: string;
  manufacturer: string;
  modelNumber: string;
  description: string | null;
  datasheetUrl: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  specs: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------------
// Families (loose UI grouping — Valve, Pump, Instrument, Fitting, Gas Inlet)
// ---------------------------------------------------------------------------------

interface FamilyRow {
  id: string;
  name: string;
  tag_letter: string | null;
  sort_order: number;
}

function rowToFamily(r: FamilyRow): Family {
  return { id: r.id, name: r.name, tagLetter: r.tag_letter, sortOrder: r.sort_order };
}

export async function listFamilies(): Promise<Family[]> {
  const db = await getDb();
  const rows = await db.select<FamilyRow[]>('SELECT * FROM families ORDER BY sort_order, name');
  return rows.map(rowToFamily);
}

export async function getFamily(id: string): Promise<Family | null> {
  const db = await getDb();
  const rows = await db.select<FamilyRow[]>('SELECT * FROM families WHERE id = $1', [id]);
  return rows[0] ? rowToFamily(rows[0]) : null;
}

export async function upsertFamily(input: { id?: string; name: string; tagLetter: string | null; sortOrder?: number }): Promise<Family> {
  const db = await getDb();
  const id = input.id ?? newId('fam');
  const sortOrder = input.sortOrder ?? 0;
  await db.execute(
    `INSERT INTO families (id, name, tag_letter, sort_order) VALUES ($1, $2, $3, $4)
     ON CONFLICT(id) DO UPDATE SET name = $2, tag_letter = $3, sort_order = $4`,
    [id, input.name, input.tagLetter, sortOrder],
  );
  return { id, name: input.name, tagLetter: input.tagLetter, sortOrder };
}

/** Cascades to that family's categories, and from there to their attribute
 * definitions and real parts (all FK'd with ON DELETE CASCADE) — deliberately no
 * separate confirmation here; the caller's UI is responsible for warning before
 * calling this. */
export async function deleteFamily(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM families WHERE id = $1', [id]);
}

// ---------------------------------------------------------------------------------
// Categories (the fine-grained, symbol-owning classification — Automated 2-Way Valve)
// ---------------------------------------------------------------------------------

interface CategoryRow {
  id: string;
  family_id: string;
  name: string;
  subtype: string | null;
  actuation: string | null;
  port_count: number;
  symbol_id: string | null;
}

function rowToCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    familyId: r.family_id,
    name: r.name,
    subtype: r.subtype,
    actuation: r.actuation,
    portCount: r.port_count,
    symbolId: r.symbol_id,
  };
}

export async function listCategories(familyId?: string): Promise<Category[]> {
  const db = await getDb();
  const rows = familyId
    ? await db.select<CategoryRow[]>('SELECT * FROM categories WHERE family_id = $1 ORDER BY name', [familyId])
    : await db.select<CategoryRow[]>('SELECT * FROM categories ORDER BY name');
  return rows.map(rowToCategory);
}

export async function getCategory(id: string): Promise<Category | null> {
  const db = await getDb();
  const rows = await db.select<CategoryRow[]>('SELECT * FROM categories WHERE id = $1', [id]);
  return rows[0] ? rowToCategory(rows[0]) : null;
}

export async function upsertCategory(input: {
  id?: string;
  familyId: string;
  name: string;
  subtype?: string | null;
  actuation?: string | null;
  portCount?: number;
  symbolId?: string | null;
}): Promise<Category> {
  const db = await getDb();
  const id = input.id ?? newId('cat');
  const subtype = input.subtype ?? null;
  const actuation = input.actuation ?? null;
  const portCount = input.portCount ?? 2;
  const symbolId = input.symbolId ?? null;
  await db.execute(
    `INSERT INTO categories (id, family_id, name, subtype, actuation, port_count, symbol_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET family_id=$2, name=$3, subtype=$4, actuation=$5, port_count=$6, symbol_id=$7`,
    [id, input.familyId, input.name, subtype, actuation, portCount, symbolId],
  );
  return { id, familyId: input.familyId, name: input.name, subtype, actuation, portCount, symbolId };
}

/** Cascades to that category's attribute definitions and real parts (ON DELETE
 * CASCADE) — same no-separate-confirmation contract as `deleteFamily`. */
export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM categories WHERE id = $1', [id]);
}

// ---------------------------------------------------------------------------------
// Attribute definitions (scoped to a category)
// ---------------------------------------------------------------------------------

interface AttributeDefinitionRow {
  id: string;
  category_id: string;
  key: string;
  label: string;
  type: string;
  unit: string | null;
  options: string | null;
  required: number;
  sort_order: number;
}

function rowToAttributeDefinition(r: AttributeDefinitionRow): AttributeDefinition {
  return {
    id: r.id,
    categoryId: r.category_id,
    key: r.key,
    label: r.label,
    type: r.type as AttributeType,
    unit: r.unit,
    options: r.options ? JSON.parse(r.options) : null,
    required: r.required === 1,
    sortOrder: r.sort_order,
  };
}

export async function listAttributeDefinitions(categoryId: string): Promise<AttributeDefinition[]> {
  const db = await getDb();
  const rows = await db.select<AttributeDefinitionRow[]>(
    'SELECT * FROM attribute_definitions WHERE category_id = $1 ORDER BY sort_order, label',
    [categoryId],
  );
  return rows.map(rowToAttributeDefinition);
}

export async function upsertAttributeDefinition(input: {
  id?: string;
  categoryId: string;
  key: string;
  label: string;
  type: AttributeType;
  unit?: string | null;
  options?: string[] | null;
  required?: boolean;
  sortOrder?: number;
}): Promise<AttributeDefinition> {
  const db = await getDb();
  const id = input.id ?? newId('attr');
  const unit = input.unit ?? null;
  const options = input.options ?? null;
  const required = input.required ?? false;
  const sortOrder = input.sortOrder ?? 0;
  await db.execute(
    `INSERT INTO attribute_definitions (id, category_id, key, label, type, unit, options, required, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET category_id=$2, key=$3, label=$4, type=$5, unit=$6, options=$7, required=$8, sort_order=$9`,
    [id, input.categoryId, input.key, input.label, input.type, unit, options ? JSON.stringify(options) : null, required ? 1 : 0, sortOrder],
  );
  return { id, categoryId: input.categoryId, key: input.key, label: input.label, type: input.type, unit, options, required, sortOrder };
}

export async function deleteAttributeDefinition(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM attribute_definitions WHERE id = $1', [id]);
}

// ---------------------------------------------------------------------------------
// Real parts (a specific manufacturer/model within a category, with configurable specs)
// ---------------------------------------------------------------------------------

interface RealPartRow {
  id: string;
  category_id: string;
  manufacturer: string;
  model_number: string;
  description: string | null;
  datasheet_url: string | null;
  image_url: string | null;
  price: number | null;
  currency: string | null;
  specs: string;
}

function rowToRealPart(r: RealPartRow): RealPart {
  let specs: Record<string, string | number | boolean> = {};
  try {
    specs = JSON.parse(r.specs);
  } catch {
    specs = {};
  }
  return {
    id: r.id,
    categoryId: r.category_id,
    manufacturer: r.manufacturer,
    modelNumber: r.model_number,
    description: r.description,
    datasheetUrl: r.datasheet_url,
    imageUrl: r.image_url,
    price: r.price,
    currency: r.currency,
    specs,
  };
}

export async function listRealParts(categoryId: string): Promise<RealPart[]> {
  const db = await getDb();
  const rows = await db.select<RealPartRow[]>(
    'SELECT * FROM real_parts WHERE category_id = $1 ORDER BY manufacturer, model_number',
    [categoryId],
  );
  return rows.map(rowToRealPart);
}

export async function getRealPart(id: string): Promise<RealPart | null> {
  const db = await getDb();
  const rows = await db.select<RealPartRow[]>('SELECT * FROM real_parts WHERE id = $1', [id]);
  return rows[0] ? rowToRealPart(rows[0]) : null;
}

export async function upsertRealPart(input: {
  id?: string;
  categoryId: string;
  manufacturer: string;
  modelNumber: string;
  description?: string | null;
  datasheetUrl?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  specs?: Record<string, string | number | boolean>;
}): Promise<RealPart> {
  const db = await getDb();
  const id = input.id ?? newId('rp');
  const description = input.description ?? null;
  const datasheetUrl = input.datasheetUrl ?? null;
  const imageUrl = input.imageUrl ?? null;
  const price = input.price ?? null;
  const currency = input.currency ?? null;
  const specs = input.specs ?? {};
  await db.execute(
    `INSERT INTO real_parts (id, category_id, manufacturer, model_number, description, datasheet_url, image_url, price, currency, specs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT(id) DO UPDATE SET category_id=$2, manufacturer=$3, model_number=$4, description=$5, datasheet_url=$6, image_url=$7, price=$8, currency=$9, specs=$10`,
    [id, input.categoryId, input.manufacturer, input.modelNumber, description, datasheetUrl, imageUrl, price, currency, JSON.stringify(specs)],
  );
  return {
    id,
    categoryId: input.categoryId,
    manufacturer: input.manufacturer,
    modelNumber: input.modelNumber,
    description,
    datasheetUrl,
    imageUrl,
    price,
    currency,
    specs,
  };
}

export async function deleteRealPart(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM real_parts WHERE id = $1', [id]);
}

// ---------------------------------------------------------------------------------
// Snapshot helper — used when placing/re-assigning a component on the canvas
// ---------------------------------------------------------------------------------

/** Builds the portable snapshot embedded in a placed ComponentInstance (see
 * types/geometry.ts) from current library data, resolving and embedding the
 * category's vector symbol. Returns null if the category no longer exists
 * (shouldn't normally happen from UI flows that just looked it up). */
export async function buildComponentSnapshot(categoryId: string, realPartId: string | null): Promise<ComponentSnapshot | null> {
  const category = await getCategory(categoryId);
  if (!category) return null;
  const family = await getFamily(category.familyId);
  let realPart: RealPartSnapshot | null = null;
  if (realPartId) {
    const rp = await getRealPart(realPartId);
    if (rp) realPart = { manufacturer: rp.manufacturer, modelNumber: rp.modelNumber, datasheetUrl: rp.datasheetUrl ?? undefined, specs: rp.specs };
  }
  const symbol = resolveSymbol(category.subtype, category.actuation, category.portCount);
  return { familyName: family?.name ?? 'Unknown', categoryName: category.name, symbol, realPart };
}
