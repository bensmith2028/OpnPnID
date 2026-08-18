// File I/O (open/save dialogs, reading/writing project files) is handled entirely on the
// frontend via the fs and dialog plugins below — no custom commands are needed for that.
// The component library lives in its own SQLite database (separate from project files),
// managed via tauri-plugin-sql migrations below; the frontend talks to it directly
// through the plugin's JS API (src/library/db.ts) rather than hand-rolled Rust commands,
// consistent with how fs/dialog are already used as plugins rather than custom commands.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Whether the drawing on screen has edits that aren't on disk yet. Mirrored here from the
/// frontend's own `dirty` flag (see the store) because the *decision* to hold the app open
/// has to happen in Rust: by the time a close/quit reaches the frontend it's already too
/// late to stop it, and asking the webview and waiting for an answer isn't possible from
/// inside the synchronous event handlers below.
#[derive(Default)]
struct UnsavedChanges(AtomicBool);

/// Called by the frontend whenever its dirty flag changes — see src/platform/appClose.ts.
#[tauri::command]
fn set_unsaved_changes(state: tauri::State<'_, UnsavedChanges>, has_unsaved: bool) {
    state.0.store(has_unsaved, Ordering::SeqCst);
}

/// Quits for real, from the frontend's "Save"/"Don't Save" answer to the prompt below.
/// Clearing the flag first is what stops the exit it triggers from being intercepted all
/// over again by the same handlers.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.state::<UnsavedChanges>().0.store(false, Ordering::SeqCst);
    app.exit(0);
}

/// Emitted to the frontend in place of a close/quit that was held back — the frontend puts
/// up the unsaved-changes prompt and answers with `quit_app` (or nothing, to stay open).
const CLOSE_REQUESTED_EVENT: &str = "app-close-requested";

fn has_unsaved(app: &tauri::AppHandle) -> bool {
    app.state::<UnsavedChanges>().0.load(Ordering::SeqCst)
}

fn library_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_library_schema",
            kind: MigrationKind::Up,
            sql: r#"
                CREATE TABLE categories (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    tag_letter TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE attribute_definitions (
                    id TEXT PRIMARY KEY,
                    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    key TEXT NOT NULL,
                    label TEXT NOT NULL,
                    type TEXT NOT NULL,
                    unit TEXT,
                    options TEXT,
                    required INTEGER NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(category_id, key)
                );

                CREATE TABLE generic_components (
                    id TEXT PRIMARY KEY,
                    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    subtype TEXT,
                    actuation TEXT,
                    port_count INTEGER NOT NULL DEFAULT 2,
                    symbol_id TEXT
                );

                CREATE TABLE real_parts (
                    id TEXT PRIMARY KEY,
                    generic_component_id TEXT NOT NULL REFERENCES generic_components(id) ON DELETE CASCADE,
                    manufacturer TEXT NOT NULL,
                    model_number TEXT NOT NULL,
                    description TEXT,
                    datasheet_url TEXT,
                    image_url TEXT,
                    price REAL,
                    currency TEXT,
                    specs TEXT NOT NULL DEFAULT '{}'
                );
            "#,
        },
        Migration {
            version: 2,
            description: "seed_categories_and_attributes",
            kind: MigrationKind::Up,
            sql: r#"
                INSERT INTO categories (id, name, tag_letter, sort_order) VALUES
                    ('valve', 'Valve', 'V', 0),
                    ('pump', 'Pump', NULL, 1),
                    ('instrument', 'Instrument', NULL, 2),
                    ('fitting', 'Fitting', NULL, 3),
                    ('gas_inlet', 'Gas Inlet / Process Connection', NULL, 4);

                INSERT INTO attribute_definitions (id, category_id, key, label, type, unit, options, required, sort_order) VALUES
                    ('valve_cv', 'valve', 'cv', 'Cv (Flow Coefficient)', 'number', NULL, NULL, 0, 0),
                    ('valve_pressure_rating', 'valve', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 1),
                    ('valve_port_size', 'valve', 'port_size', 'Port Size', 'text', NULL, NULL, 0, 2),
                    ('valve_body_material', 'valve', 'body_material', 'Body Material', 'text', NULL, NULL, 0, 3),
                    ('valve_seat_material', 'valve', 'seat_material', 'Seat/Seal Material', 'text', NULL, NULL, 0, 4),
                    ('valve_connection_type', 'valve', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 5),
                    ('valve_actuation_voltage', 'valve', 'actuation_voltage', 'Actuation Voltage/Supply', 'text', NULL, NULL, 0, 6),
                    ('valve_fail_position', 'valve', 'fail_position', 'Fail Position', 'select', NULL, '["FC","FO","FL","N/A"]', 0, 7),

                    ('pump_flow_rate', 'pump', 'flow_rate', 'Flow Rate', 'number', 'GPM', NULL, 0, 0),
                    ('pump_head', 'pump', 'head', 'Head', 'number', 'ft', NULL, 0, 1),
                    ('pump_power', 'pump', 'power', 'Power', 'number', 'HP', NULL, 0, 2),
                    ('pump_inlet_size', 'pump', 'inlet_size', 'Inlet Size', 'text', NULL, NULL, 0, 3),
                    ('pump_outlet_size', 'pump', 'outlet_size', 'Outlet Size', 'text', NULL, NULL, 0, 4),
                    ('pump_npsh', 'pump', 'npsh_required', 'NPSH Required', 'number', 'ft', NULL, 0, 5),
                    ('pump_efficiency', 'pump', 'efficiency', 'Efficiency', 'number', '%', NULL, 0, 6),
                    ('pump_speed', 'pump', 'speed', 'Speed', 'number', 'RPM', NULL, 0, 7),
                    ('pump_seal_type', 'pump', 'seal_type', 'Seal Type', 'text', NULL, NULL, 0, 8),
                    ('pump_motor_voltage', 'pump', 'motor_voltage', 'Motor Voltage', 'text', NULL, NULL, 0, 9),

                    ('instrument_variable', 'instrument', 'measured_variable', 'Measured Variable', 'select', NULL, '["Pressure","Temperature","Flow","Level","Analytical","Speed","Position","Weight","Multivariable"]', 1, 0),
                    ('instrument_range', 'instrument', 'range', 'Range (Span)', 'text', NULL, NULL, 0, 1),
                    ('instrument_accuracy', 'instrument', 'accuracy', 'Accuracy', 'text', NULL, NULL, 0, 2),
                    ('instrument_output', 'instrument', 'output_signal', 'Output Signal', 'select', NULL, '["4-20mA","4-20mA HART","0-10V","Modbus","Foundation Fieldbus","Profibus","Wireless"]', 0, 3),
                    ('instrument_process_connection', 'instrument', 'process_connection', 'Process Connection', 'text', NULL, NULL, 0, 4),
                    ('instrument_wetted_material', 'instrument', 'wetted_material', 'Wetted Material', 'text', NULL, NULL, 0, 5),
                    ('instrument_enclosure_rating', 'instrument', 'enclosure_rating', 'Enclosure Rating', 'text', NULL, NULL, 0, 6),
                    ('instrument_hazardous_area', 'instrument', 'hazardous_area_rating', 'Hazardous Area Rating', 'text', NULL, NULL, 0, 7),
                    ('instrument_power_supply', 'instrument', 'power_supply', 'Power Supply', 'text', NULL, NULL, 0, 8),

                    ('fitting_size1', 'fitting', 'size1', 'Size', 'text', NULL, NULL, 0, 0),
                    ('fitting_size2', 'fitting', 'size2', 'Size 2 (if reducer)', 'text', NULL, NULL, 0, 1),
                    ('fitting_schedule', 'fitting', 'schedule', 'Schedule', 'text', NULL, NULL, 0, 2),
                    ('fitting_material', 'fitting', 'material', 'Material', 'text', NULL, NULL, 0, 3),
                    ('fitting_connection_type', 'fitting', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 4),
                    ('fitting_angle', 'fitting', 'angle', 'Angle', 'number', 'deg', NULL, 0, 5),
                    ('fitting_rating', 'fitting', 'rating', 'Rating', 'text', NULL, NULL, 0, 6),

                    ('gas_inlet_media', 'gas_inlet', 'media_type', 'Gas/Media Type', 'text', NULL, NULL, 0, 0),
                    ('gas_inlet_connection_type', 'gas_inlet', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Quick-Connect","Hose Barb","Compression"]', 0, 1),
                    ('gas_inlet_size', 'gas_inlet', 'size', 'Size', 'text', NULL, NULL, 0, 2),
                    ('gas_inlet_pressure_rating', 'gas_inlet', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 3),
                    ('gas_inlet_filtered', 'gas_inlet', 'filtered_regulated', 'Filter/Regulation Included', 'boolean', NULL, NULL, 0, 4);
            "#,
        },
        Migration {
            version: 3,
            description: "seed_starter_valve_generics",
            kind: MigrationKind::Up,
            sql: r#"
                INSERT INTO generic_components (id, category_id, name, subtype, actuation, port_count, symbol_id) VALUES
                    ('gc_valve_manual_2way', 'valve', 'Manual 2-Way Valve', '2-way', 'manual', 2, NULL),
                    ('gc_valve_manual_3way', 'valve', 'Manual 3-Way Valve', '3-way', 'manual', 3, NULL),
                    ('gc_valve_auto_2way', 'valve', 'Automated 2-Way Valve', '2-way', 'automated', 2, NULL),
                    ('gc_valve_auto_3way', 'valve', 'Automated 3-Way Valve', '3-way', 'automated', 3, NULL),
                    ('gc_valve_check', 'valve', 'Check Valve', 'check', NULL, 2, NULL),
                    ('gc_valve_needle', 'valve', 'Needle Valve', 'needle', 'manual', 2, NULL);
            "#,
        },
        // Re-affirms the starter valve set from migration 3. Migrations only ever run
        // once per install, so if a user later *deletes* those rows through the UI,
        // relaunching won't bring them back on its own — this is a safety net for that
        // (idempotent via ON CONFLICT DO NOTHING, so it's a no-op wherever the rows are
        // already present, e.g. every fresh install where migration 3 just created them).
        Migration {
            version: 4,
            description: "restore_starter_valve_generics_if_missing",
            kind: MigrationKind::Up,
            sql: r#"
                INSERT INTO generic_components (id, category_id, name, subtype, actuation, port_count, symbol_id) VALUES
                    ('gc_valve_manual_2way', 'valve', 'Manual 2-Way Valve', '2-way', 'manual', 2, NULL),
                    ('gc_valve_manual_3way', 'valve', 'Manual 3-Way Valve', '3-way', 'manual', 3, NULL),
                    ('gc_valve_auto_2way', 'valve', 'Automated 2-Way Valve', '2-way', 'automated', 2, NULL),
                    ('gc_valve_auto_3way', 'valve', 'Automated 3-Way Valve', '3-way', 'automated', 3, NULL),
                    ('gc_valve_check', 'valve', 'Check Valve', 'check', NULL, 2, NULL),
                    ('gc_valve_needle', 'valve', 'Needle Valve', 'needle', 'manual', 2, NULL)
                ON CONFLICT(id) DO NOTHING;
            "#,
        },
        // Collapses the 3-tier Category->GenericComponent->RealPart model into
        // Family->Category->RealPart: the fine-grained thing (e.g. "Automated 2-Way
        // Valve") becomes the real `categories` row (symbol/ports/attributes all live
        // there), and the old `categories` (Valve/Pump/...) become `families` — a pure
        // UI-grouping label with no attribute/symbol logic of its own. Every table with
        // a foreign key is fully rebuilt (CREATE new shape -> INSERT...SELECT -> DROP ->
        // RENAME) rather than relying on SQLite auto-updating FK reference text on
        // table rename, which does *not* happen (verified empirically against a scratch
        // database before writing this — a plain `ALTER TABLE ... RENAME TO` leaves
        // other tables' embedded `REFERENCES old_name(id)` text stale, which
        // `PRAGMA foreign_key_check` then correctly flags as broken).
        Migration {
            version: 5,
            description: "restructure_family_category_realpart",
            kind: MigrationKind::Up,
            sql: r#"
                ALTER TABLE categories RENAME TO families;

                CREATE TABLE categories_new (
                    id TEXT PRIMARY KEY,
                    family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    subtype TEXT,
                    actuation TEXT,
                    port_count INTEGER NOT NULL DEFAULT 2,
                    symbol_id TEXT
                );
                INSERT INTO categories_new (id, family_id, name, subtype, actuation, port_count, symbol_id)
                SELECT id, category_id, name, subtype, actuation, port_count, symbol_id FROM generic_components;
                DROP TABLE generic_components;
                ALTER TABLE categories_new RENAME TO categories;

                CREATE TABLE real_parts_new (
                    id TEXT PRIMARY KEY,
                    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    manufacturer TEXT NOT NULL,
                    model_number TEXT NOT NULL,
                    description TEXT,
                    datasheet_url TEXT,
                    image_url TEXT,
                    price REAL,
                    currency TEXT,
                    specs TEXT NOT NULL DEFAULT '{}'
                );
                INSERT INTO real_parts_new (id, category_id, manufacturer, model_number, description, datasheet_url, image_url, price, currency, specs)
                SELECT id, generic_component_id, manufacturer, model_number, description, datasheet_url, image_url, price, currency, specs FROM real_parts;
                DROP TABLE real_parts;
                ALTER TABLE real_parts_new RENAME TO real_parts;

                CREATE TABLE attribute_definitions_new (
                    id TEXT PRIMARY KEY,
                    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    key TEXT NOT NULL,
                    label TEXT NOT NULL,
                    type TEXT NOT NULL,
                    unit TEXT,
                    options TEXT,
                    required INTEGER NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(category_id, key)
                );
                INSERT INTO attribute_definitions_new (id, category_id, key, label, type, unit, options, required, sort_order)
                SELECT c.id || '__' || old.key, c.id, old.key, old.label, old.type, old.unit, old.options, old.required, old.sort_order
                FROM attribute_definitions old
                JOIN categories c ON c.family_id = old.category_id;
                DROP TABLE attribute_definitions;
                ALTER TABLE attribute_definitions_new RENAME TO attribute_definitions;
            "#,
        },
        // User-drawn/uploaded symbols, referenced by `categories.symbol_id` (that column
        // has existed since migration 1 but was always NULL until now — every category
        // resolved its symbol from the hardcoded subtype/actuation lookup in
        // src/library/builtinSymbols.ts instead). `geometry` is a JSON-serialized
        // SymbolGeometry (points/lines/arcs/ports, plus an optional embedded image for
        // upload-based symbols — see types/geometry.ts). Purely additive: `symbol_id`
        // has no FK constraint (by original design, so a category can reference a symbol
        // without forcing insert order / cascade complexity), so this migration is just
        // a CREATE TABLE — no rebuild-and-migrate-data dance needed like migration 5.
        Migration {
            version: 6,
            description: "create_symbols_table",
            kind: MigrationKind::Up,
            sql: r#"
                CREATE TABLE symbols (
                    id TEXT PRIMARY KEY,
                    geometry TEXT NOT NULL,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            "#,
        },
        Migration {
            version: 7,
            description: "replace_starter_library_with_default_library",
            kind: MigrationKind::Up,
            sql: r#"
                -- Replaces the placeholder starter library seeded by migrations 2-4
                -- with the maintainer's actual working library (families, categories,
                -- hand-drawn symbols, attribute definitions), so a brand-new install
                -- starts from real content instead of generic Valve/Pump/Instrument/
                -- Fitting/Gas-Inlet placeholders. Full delete-then-reinsert of every
                -- content table, child tables first so nothing dangles mid-migration;
                -- real_parts is empty at the time this was captured, but cleared too
                -- (via its FK to categories) for symmetry with the rest.
                DELETE FROM attribute_definitions;
                DELETE FROM real_parts;
                DELETE FROM categories;
                DELETE FROM families;
                DELETE FROM symbols;

                INSERT INTO families (id, name, tag_letter, sort_order) VALUES
                    ('valve', 'Valve', 'V', 0),
                    ('pump', 'Pump', 'P', 1),
                    ('instrument', 'Instrument', 'T', 2),
                    ('gas_inlet', 'Gas Inlet / Process Connection', 'G', 4);

                INSERT INTO categories (id, family_id, name, subtype, actuation, port_count, symbol_id) VALUES
                    ('gc_valve_manual_2way', 'valve', 'Manual 2-Way Valve', '2-way', 'manual', 2, NULL),
                    ('gc_valve_manual_3way', 'valve', 'Manual 3-Way Valve', '3-way', 'manual', 3, NULL),
                    ('gc_valve_auto_2way', 'valve', 'Solenoid 2-Way Valve', '2-way', 'automated', 2, 'sym_66c9fd54-5b6c-4416-a16f-d94d033d596f'),
                    ('gc_valve_auto_3way', 'valve', 'Solenoid 3-Way Valve', '3-way', 'automated', 3, 'sym_68d5c85f-ba3e-49a4-9ff7-2089f77bd8b9'),
                    ('gc_valve_check', 'valve', 'Check Valve', 'check', NULL, 2, 'sym_ec018f03-299f-4aa6-a4ae-03863c2248e6'),
                    ('gc_valve_needle', 'valve', 'Needle Valve', 'needle', 'manual', 2, 'sym_04205f32-6f1f-43fb-b6d7-e69a3eb62d5b'),
                    ('cat_f1920438-0c80-44d3-9eb8-30f403b31186', 'valve', 'Motor 2-Way Valve', NULL, '2', 2, 'sym_f2de43b7-048b-429f-87e4-d50a41ff6be2'),
                    ('cat_5c214129-9cb4-4994-97de-23c32e62fd6c', 'valve', 'Motor 3-Way Valve', NULL, NULL, 2, 'sym_fcb8f595-35bd-4645-830c-e827a3402aeb'),
                    ('cat_db7b11ad-cd35-4f8c-94ec-a3055778fe73', 'pump', 'Vacuum Pump', NULL, NULL, 2, 'sym_fcb61482-dda3-4dfb-adab-18dfc0eeed5a'),
                    ('cat_6746bc57-c296-4394-a7c4-f0f98d2cd6f1', 'pump', 'Mixing Pump', NULL, NULL, 2, 'sym_0fd2d3a9-48c1-4fdd-b70c-d592dc56740c'),
                    ('cat_2b4ca14c-d7dc-425f-9aed-c40afc0b228b', 'gas_inlet', 'Gas Inlet', NULL, NULL, 1, 'sym_ca2732fa-e9a7-438d-ada8-5e4559e77e97'),
                    ('cat_1eeca241-8d0e-40a8-a0ed-ae8b9164e3e5', 'instrument', 'SPT', NULL, NULL, 1, 'sym_30d52ac5-98c8-418a-ae3b-4f6b8f3a013c'),
                    ('cat_511898d9-4025-45a2-8148-6c224fbca33d', 'instrument', 'DPT', NULL, NULL, 1, 'sym_2e667701-bbc4-4c5d-81ae-ca220bad1e91'),
                    ('cat_84ef2708-d84a-4e9b-9337-4b5222734314', 'instrument', 'HF Scrubber', NULL, NULL, 2, 'sym_f4f162c4-1400-454b-ada6-1b9a505fea84'),
                    ('cat_c275b07f-dafa-4f99-92e4-d7789f082cd4', 'valve', 'Screw Valve', NULL, NULL, 2, 'sym_dc8dbfb8-afb2-46c0-a1fb-d22453aabe1e');

                INSERT INTO symbols (id, geometry) VALUES
                    ('sym_04205f32-6f1f-43fb-b6d7-e69a3eb62d5b', '{"points":{"center":{"x":0,"y":0},"lTop":{"x":-8,"y":-6},"lMid":{"x":-8,"y":0},"lBot":{"x":-8,"y":6},"lPort":{"x":-14,"y":0},"rTop":{"x":8,"y":6},"rMid":{"x":8,"y":0},"rBot":{"x":8,"y":-6},"rPort":{"x":14,"y":0},"p0":{"x":0,"y":-10},"p1":{"x":0,"y":10}},"lines":[["lTop","lMid"],["lMid","lBot"],["lBot","center"],["center","lTop"],["lMid","lPort"],["rTop","rMid"],["rMid","rBot"],["rBot","center"],["center","rTop"],["rMid","rPort"],["p0","p1"]],"arcs":[],"ports":["lPort","rPort"]}'),
                    ('sym_0fd2d3a9-48c1-4fdd-b70c-d592dc56740c', '{"points":{"port0":{"x":-12,"y":0},"port1":{"x":12,"y":0},"p0":{"x":0,"y":-10},"p1":{"x":0,"y":10},"p2":{"x":-6,"y":-8},"p3":{"x":8,"y":-6},"p4":{"x":8,"y":6},"p5":{"x":-6,"y":8},"p6":{"x":-10,"y":0},"p7":{"x":10,"y":0}},"lines":[["p2","p3"],["p4","p5"],["port0","p6"],["port1","p7"]],"arcs":[{"a":"p0","b":"p1","bulge":1},{"a":"p1","b":"p0","bulge":1}],"ports":["port0","port1"],"texts":[{"x":0,"y":0,"text":"MP","size":10}]}'),
                    ('sym_2e667701-bbc4-4c5d-81ae-ca220bad1e91', '{"points":{"p0":{"x":0,"y":-14},"p1":{"x":0,"y":14},"p2":{"x":14,"y":0},"p3":{"x":18,"y":0}},"lines":[["p2","p3"]],"arcs":[{"a":"p0","b":"p1","bulge":1},{"a":"p1","b":"p0","bulge":1}],"ports":["p3"],"texts":[{"x":0,"y":0,"text":"DPT","size":10}]}'),
                    ('sym_30d52ac5-98c8-418a-ae3b-4f6b8f3a013c', '{"points":{"p0":{"x":0,"y":-14},"p1":{"x":0,"y":14},"p2":{"x":14,"y":0},"p3":{"x":18,"y":0}},"lines":[["p2","p3"]],"arcs":[{"a":"p0","b":"p1","bulge":1},{"a":"p1","b":"p0","bulge":1}],"ports":["p3"],"texts":[{"x":0,"y":0,"text":"SPT","size":10}]}'),
                    ('sym_66c9fd54-5b6c-4416-a16f-d94d033d596f', '{"points":{"center":{"x":0,"y":0},"lTop":{"x":-8,"y":-6},"lMid":{"x":-8,"y":0},"lBot":{"x":-8,"y":6},"lPort":{"x":-14,"y":0},"rTop":{"x":8,"y":6},"rMid":{"x":8,"y":0},"rBot":{"x":8,"y":-6},"rPort":{"x":14,"y":0},"stemTop":{"x":0,"y":-12},"boxBL":{"x":-8,"y":-12},"boxBR":{"x":8,"y":-12},"boxTR":{"x":8,"y":-24},"boxTL":{"x":-8,"y":-24}},"lines":[["lTop","lMid"],["lMid","lBot"],["lBot","center"],["center","lTop"],["lMid","lPort"],["rTop","rMid"],["rMid","rBot"],["rBot","center"],["center","rTop"],["rMid","rPort"],["center","stemTop"],["boxBL","boxBR"],["boxBR","boxTR"],["boxTR","boxTL"],["boxTL","boxBL"]],"arcs":[],"ports":["lPort","rPort"],"texts":[{"x":0,"y":-18,"text":"S","size":10}]}'),
                    ('sym_68d5c85f-ba3e-49a4-9ff7-2089f77bd8b9', '{"points":{"center":{"x":0,"y":0},"lTop":{"x":-8,"y":-6},"lMid":{"x":-8,"y":0},"lBot":{"x":-8,"y":6},"lPort":{"x":-14,"y":0},"rTop":{"x":8,"y":6},"rMid":{"x":8,"y":0},"rBot":{"x":8,"y":-6},"rPort":{"x":14,"y":0},"bTop":{"x":-6,"y":8},"bMid":{"x":0,"y":8},"bBot":{"x":6,"y":8},"bPort":{"x":0,"y":14},"stemTop":{"x":0,"y":-12},"boxBL":{"x":-8,"y":-12},"boxBR":{"x":8,"y":-12},"boxTR":{"x":8,"y":-24},"boxTL":{"x":-8,"y":-24}},"lines":[["lTop","lMid"],["lMid","lBot"],["lBot","center"],["center","lTop"],["lMid","lPort"],["rTop","rMid"],["rMid","rBot"],["rBot","center"],["center","rTop"],["rMid","rPort"],["bTop","bMid"],["bMid","bBot"],["bBot","center"],["center","bTop"],["bMid","bPort"],["center","stemTop"],["boxBL","boxBR"],["boxBR","boxTR"],["boxTR","boxTL"],["boxTL","boxBL"]],"arcs":[],"ports":["lPort","rPort","bPort"],"texts":[{"x":0,"y":-18,"text":"S","size":10}]}'),
                    ('sym_ca2732fa-e9a7-438d-ada8-5e4559e77e97', '{"points":{"p0":{"x":0,"y":0},"p1":{"x":0,"y":-8},"p2":{"x":0,"y":8},"p3":{"x":0,"y":-4},"p4":{"x":0,"y":4}},"lines":[],"arcs":[{"a":"p1","b":"p2","bulge":1},{"a":"p2","b":"p1","bulge":1},{"a":"p3","b":"p4","bulge":1},{"a":"p4","b":"p3","bulge":1}],"ports":["p0"]}'),
                    ('sym_dc8dbfb8-afb2-46c0-a1fb-d22453aabe1e', '{"points":{"p0":{"x":0,"y":-10},"p1":{"x":0,"y":10},"p2":{"x":-10,"y":10},"p3":{"x":10,"y":10},"p4":{"x":-10,"y":-10},"p5":{"x":10,"y":-10}},"lines":[["p0","p1"],["p2","p3"],["p4","p5"]],"arcs":[],"ports":["p1","p0"]}'),
                    ('sym_ec018f03-299f-4aa6-a4ae-03863c2248e6', '{"points":{"portL":{"x":-14,"y":0},"baseMid":{"x":-6,"y":0},"tip":{"x":8,"y":0},"portR":{"x":14,"y":0},"p0":{"x":0,"y":-6},"p1":{"x":0,"y":6},"p2":{"x":0,"y":-10},"p3":{"x":0,"y":10}},"lines":[["portL","baseMid"],["tip","portR"],["tip","p2"],["tip","p3"]],"arcs":[{"a":"p0","b":"p1","bulge":1},{"a":"p1","b":"p0","bulge":1}],"ports":["portL","portR"]}'),
                    ('sym_f2de43b7-048b-429f-87e4-d50a41ff6be2', '{"points":{"center":{"x":0,"y":0},"lTop":{"x":-8,"y":-6},"lMid":{"x":-8,"y":0},"lBot":{"x":-8,"y":6},"lPort":{"x":-14,"y":0},"rTop":{"x":8,"y":6},"rMid":{"x":8,"y":0},"rBot":{"x":8,"y":-6},"rPort":{"x":14,"y":0},"stemTop":{"x":0,"y":-12},"boxBL":{"x":-8,"y":-12},"boxBR":{"x":8,"y":-12},"boxTR":{"x":8,"y":-24},"boxTL":{"x":-8,"y":-24}},"lines":[["lTop","lMid"],["lMid","lBot"],["lBot","center"],["center","lTop"],["lMid","lPort"],["rTop","rMid"],["rMid","rBot"],["rBot","center"],["center","rTop"],["rMid","rPort"],["center","stemTop"],["boxBL","boxBR"],["boxBR","boxTR"],["boxTR","boxTL"],["boxTL","boxBL"]],"arcs":[],"ports":["lPort","rPort"],"texts":[{"x":0,"y":-18,"text":"M","size":10}]}'),
                    ('sym_f4f162c4-1400-454b-ada6-1b9a505fea84', '{"points":{"p0":{"x":0,"y":-26},"p1":{"x":0,"y":26},"p2":{"x":-2,"y":-26},"p3":{"x":2,"y":-26},"p4":{"x":2,"y":-22},"p5":{"x":-2,"y":-22},"p6":{"x":-6,"y":-16},"p7":{"x":6,"y":-16},"p8":{"x":-2,"y":26},"p9":{"x":2,"y":26},"p10":{"x":2,"y":22},"p11":{"x":6,"y":16},"p12":{"x":-2,"y":22},"p13":{"x":-6,"y":16}},"lines":[["p2","p3"],["p3","p4"],["p2","p5"],["p5","p6"],["p4","p7"],["p8","p9"],["p9","p10"],["p10","p11"],["p8","p12"],["p12","p13"],["p13","p6"],["p7","p11"]],"arcs":[],"ports":["p0","p1"]}'),
                    ('sym_fcb61482-dda3-4dfb-adab-18dfc0eeed5a', '{"points":{"port0":{"x":-12,"y":0},"port1":{"x":12,"y":0},"p0":{"x":0,"y":-10},"p1":{"x":0,"y":10},"p2":{"x":-6,"y":-8},"p3":{"x":8,"y":-6},"p4":{"x":8,"y":6},"p5":{"x":-6,"y":8},"p6":{"x":-10,"y":0},"p7":{"x":10,"y":0}},"lines":[["p2","p3"],["p4","p5"],["port0","p6"],["port1","p7"]],"arcs":[{"a":"p0","b":"p1","bulge":1},{"a":"p1","b":"p0","bulge":1}],"ports":["port0","port1"],"texts":[{"x":0,"y":0,"text":"VP","size":10}]}'),
                    ('sym_fcb8f595-35bd-4645-830c-e827a3402aeb', '{"points":{"center":{"x":0,"y":0},"lTop":{"x":-8,"y":-6},"lMid":{"x":-8,"y":0},"lBot":{"x":-8,"y":6},"lPort":{"x":-14,"y":0},"rTop":{"x":8,"y":6},"rMid":{"x":8,"y":0},"rBot":{"x":8,"y":-6},"rPort":{"x":14,"y":0},"bTop":{"x":-6,"y":8},"bMid":{"x":0,"y":8},"bBot":{"x":6,"y":8},"bPort":{"x":0,"y":14},"stemTop":{"x":0,"y":-12},"boxBL":{"x":-8,"y":-12},"boxBR":{"x":8,"y":-12},"boxTR":{"x":8,"y":-24},"boxTL":{"x":-8,"y":-24}},"lines":[["lTop","lMid"],["lMid","lBot"],["lBot","center"],["center","lTop"],["lMid","lPort"],["rTop","rMid"],["rMid","rBot"],["rBot","center"],["center","rTop"],["rMid","rPort"],["bTop","bMid"],["bMid","bBot"],["bBot","center"],["center","bTop"],["bMid","bPort"],["center","stemTop"],["boxBL","boxBR"],["boxBR","boxTR"],["boxTR","boxTL"],["boxTL","boxBL"]],"arcs":[],"ports":["lPort","rPort","bPort"],"texts":[{"x":0,"y":-18,"text":"M","size":10}]}');

                INSERT INTO attribute_definitions (id, category_id, key, label, type, unit, options, required, sort_order) VALUES
                    ('gc_valve_auto_2way__cv', 'gc_valve_auto_2way', 'cv', 'Cv (Flow Coefficient)', 'number', NULL, NULL, 0, 0),
                    ('gc_valve_auto_2way__pressure_rating', 'gc_valve_auto_2way', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 1),
                    ('gc_valve_auto_2way__port_size', 'gc_valve_auto_2way', 'port_size', 'Port Size', 'text', NULL, NULL, 0, 2),
                    ('gc_valve_auto_2way__body_material', 'gc_valve_auto_2way', 'body_material', 'Body Material', 'text', NULL, NULL, 0, 3),
                    ('gc_valve_auto_2way__seat_material', 'gc_valve_auto_2way', 'seat_material', 'Seat/Seal Material', 'text', NULL, NULL, 0, 4),
                    ('gc_valve_auto_2way__connection_type', 'gc_valve_auto_2way', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 5),
                    ('gc_valve_auto_2way__actuation_voltage', 'gc_valve_auto_2way', 'actuation_voltage', 'Actuation Voltage/Supply', 'text', NULL, NULL, 0, 6),
                    ('gc_valve_auto_2way__fail_position', 'gc_valve_auto_2way', 'fail_position', 'Fail Position', 'select', NULL, '["FC","FO","FL","N/A"]', 0, 7),
                    ('gc_valve_auto_3way__cv', 'gc_valve_auto_3way', 'cv', 'Cv (Flow Coefficient)', 'number', NULL, NULL, 0, 0),
                    ('gc_valve_auto_3way__pressure_rating', 'gc_valve_auto_3way', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 1),
                    ('gc_valve_auto_3way__port_size', 'gc_valve_auto_3way', 'port_size', 'Port Size', 'text', NULL, NULL, 0, 2),
                    ('gc_valve_auto_3way__body_material', 'gc_valve_auto_3way', 'body_material', 'Body Material', 'text', NULL, NULL, 0, 3),
                    ('gc_valve_auto_3way__seat_material', 'gc_valve_auto_3way', 'seat_material', 'Seat/Seal Material', 'text', NULL, NULL, 0, 4),
                    ('gc_valve_auto_3way__connection_type', 'gc_valve_auto_3way', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 5),
                    ('gc_valve_auto_3way__actuation_voltage', 'gc_valve_auto_3way', 'actuation_voltage', 'Actuation Voltage/Supply', 'text', NULL, NULL, 0, 6),
                    ('gc_valve_auto_3way__fail_position', 'gc_valve_auto_3way', 'fail_position', 'Fail Position', 'select', NULL, '["FC","FO","FL","N/A"]', 0, 7),
                    ('gc_valve_check__cv', 'gc_valve_check', 'cv', 'Cv (Flow Coefficient)', 'number', NULL, NULL, 0, 0),
                    ('gc_valve_check__pressure_rating', 'gc_valve_check', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 1),
                    ('gc_valve_check__port_size', 'gc_valve_check', 'port_size', 'Port Size', 'text', NULL, NULL, 0, 2),
                    ('gc_valve_check__body_material', 'gc_valve_check', 'body_material', 'Body Material', 'text', NULL, NULL, 0, 3),
                    ('gc_valve_check__seat_material', 'gc_valve_check', 'seat_material', 'Seat/Seal Material', 'text', NULL, NULL, 0, 4),
                    ('gc_valve_check__connection_type', 'gc_valve_check', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 5),
                    ('gc_valve_check__actuation_voltage', 'gc_valve_check', 'actuation_voltage', 'Actuation Voltage/Supply', 'text', NULL, NULL, 0, 6),
                    ('gc_valve_check__fail_position', 'gc_valve_check', 'fail_position', 'Fail Position', 'select', NULL, '["FC","FO","FL","N/A"]', 0, 7),
                    ('gc_valve_manual_2way__cv', 'gc_valve_manual_2way', 'cv', 'Cv (Flow Coefficient)', 'number', NULL, NULL, 0, 0),
                    ('gc_valve_manual_2way__pressure_rating', 'gc_valve_manual_2way', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 1),
                    ('gc_valve_manual_2way__port_size', 'gc_valve_manual_2way', 'port_size', 'Port Size', 'text', NULL, NULL, 0, 2),
                    ('gc_valve_manual_2way__body_material', 'gc_valve_manual_2way', 'body_material', 'Body Material', 'text', NULL, NULL, 0, 3),
                    ('gc_valve_manual_2way__seat_material', 'gc_valve_manual_2way', 'seat_material', 'Seat/Seal Material', 'text', NULL, NULL, 0, 4),
                    ('gc_valve_manual_2way__connection_type', 'gc_valve_manual_2way', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 5),
                    ('gc_valve_manual_2way__actuation_voltage', 'gc_valve_manual_2way', 'actuation_voltage', 'Actuation Voltage/Supply', 'text', NULL, NULL, 0, 6),
                    ('gc_valve_manual_2way__fail_position', 'gc_valve_manual_2way', 'fail_position', 'Fail Position', 'select', NULL, '["FC","FO","FL","N/A"]', 0, 7),
                    ('gc_valve_manual_3way__cv', 'gc_valve_manual_3way', 'cv', 'Cv (Flow Coefficient)', 'number', NULL, NULL, 0, 0),
                    ('gc_valve_manual_3way__pressure_rating', 'gc_valve_manual_3way', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 1),
                    ('gc_valve_manual_3way__port_size', 'gc_valve_manual_3way', 'port_size', 'Port Size', 'text', NULL, NULL, 0, 2),
                    ('gc_valve_manual_3way__body_material', 'gc_valve_manual_3way', 'body_material', 'Body Material', 'text', NULL, NULL, 0, 3),
                    ('gc_valve_manual_3way__seat_material', 'gc_valve_manual_3way', 'seat_material', 'Seat/Seal Material', 'text', NULL, NULL, 0, 4),
                    ('gc_valve_manual_3way__connection_type', 'gc_valve_manual_3way', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 5),
                    ('gc_valve_manual_3way__actuation_voltage', 'gc_valve_manual_3way', 'actuation_voltage', 'Actuation Voltage/Supply', 'text', NULL, NULL, 0, 6),
                    ('gc_valve_manual_3way__fail_position', 'gc_valve_manual_3way', 'fail_position', 'Fail Position', 'select', NULL, '["FC","FO","FL","N/A"]', 0, 7),
                    ('gc_valve_needle__cv', 'gc_valve_needle', 'cv', 'Cv (Flow Coefficient)', 'number', NULL, NULL, 0, 0),
                    ('gc_valve_needle__pressure_rating', 'gc_valve_needle', 'pressure_rating', 'Pressure Rating', 'text', NULL, NULL, 0, 1),
                    ('gc_valve_needle__port_size', 'gc_valve_needle', 'port_size', 'Port Size', 'text', NULL, NULL, 0, 2),
                    ('gc_valve_needle__body_material', 'gc_valve_needle', 'body_material', 'Body Material', 'text', NULL, NULL, 0, 3),
                    ('gc_valve_needle__seat_material', 'gc_valve_needle', 'seat_material', 'Seat/Seal Material', 'text', NULL, NULL, 0, 4),
                    ('gc_valve_needle__connection_type', 'gc_valve_needle', 'connection_type', 'Connection Type', 'select', NULL, '["Threaded","Flanged","Welded","Compression","Tri-Clamp"]', 0, 5),
                    ('gc_valve_needle__actuation_voltage', 'gc_valve_needle', 'actuation_voltage', 'Actuation Voltage/Supply', 'text', NULL, NULL, 0, 6),
                    ('gc_valve_needle__fail_position', 'gc_valve_needle', 'fail_position', 'Fail Position', 'select', NULL, '["FC","FO","FL","N/A"]', 0, 7);
            "#,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(UnsavedChanges::default())
        .invoke_handler(tauri::generate_handler![set_unsaved_changes, quit_app])
        // Closing the window is only one of the ways out of the app — the Dock's Quit item
        // and anything else that terminates the process arrive as ExitRequested further
        // down instead, without this ever firing. Both are guarded, or an unsaved drawing
        // would survive one route out and not the other.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if has_unsaved(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.app_handle().emit(CLOSE_REQUESTED_EVENT, ());
                }
            }
        })
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:library.db", library_migrations())
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // macOS-only: without *some* native window menu present, macOS never routes
            // Cmd+C/V/X/Z/A (and friends) to the webview at all — a long-standing,
            // widely-reported Tauri/WKWebView limitation (see e.g. tauri-apps/tauri
            // issues #2397, #2819, #12458). Windows/Linux webview engines don't have
            // this limitation, so skip adding a menu bar there that nobody asked for.
            //
            // These are deliberately *custom* items, not the predefined `.copy()`/
            // `.paste()`/etc. roles. A predefined role hands the accelerator straight to
            // AppKit's native NSResponder chain (`copy:`/`paste:`/...), which is a no-op
            // for anything that isn't native DOM text selection — exactly the case for
            // the schematic canvas and symbol editor, which keep their own in-memory
            // clipboard/undo stacks. Because a menu item's key equivalent is consumed by
            // AppKit *before* it would ever become a `keydown` in the webview, a
            // predefined role also permanently starves any JS keydown handler for that
            // same shortcut — which is what silently broke canvas copy/paste the first
            // time this menu was added. So instead each item here just re-emits an
            // `app-menu` event to the frontend (see src/platform/menuBridge.ts), which
            // decides what to do based on what's actually focused: a real text field
            // still gets standard editing behavior, anything else routes to the app's
            // own copy/paste/undo/redo.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
                use tauri::Emitter;

                let undo = MenuItemBuilder::with_id("menu-undo", "Undo").accelerator("CmdOrCtrl+Z").build(app)?;
                let redo = MenuItemBuilder::with_id("menu-redo", "Redo").accelerator("CmdOrCtrl+Shift+Z").build(app)?;
                let cut = MenuItemBuilder::with_id("menu-cut", "Cut").accelerator("CmdOrCtrl+X").build(app)?;
                let copy = MenuItemBuilder::with_id("menu-copy", "Copy").accelerator("CmdOrCtrl+C").build(app)?;
                let paste = MenuItemBuilder::with_id("menu-paste", "Paste").accelerator("CmdOrCtrl+V").build(app)?;
                let select_all = MenuItemBuilder::with_id("menu-select-all", "Select All").accelerator("CmdOrCtrl+A").build(app)?;

                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .item(&undo)
                    .item(&redo)
                    .separator()
                    .item(&cut)
                    .item(&copy)
                    .item(&paste)
                    .item(&select_all)
                    .build()?;
                let menu = MenuBuilder::new(app).item(&edit_menu).build()?;
                app.set_menu(menu)?;

                app.on_menu_event(move |app_handle, event| {
                    let action = match event.id().as_ref() {
                        "menu-undo" => "undo",
                        "menu-redo" => "redo",
                        "menu-cut" => "cut",
                        "menu-copy" => "copy",
                        "menu-paste" => "paste",
                        "menu-select-all" => "selectAll",
                        _ => return,
                    };
                    let _ = app_handle.emit("app-menu", action);
                });
            }
            Ok(())
        })
        // `build` + `run(closure)` rather than plain `run(context)`: RunEvent::ExitRequested
        // is only reachable from the run loop's callback, and it's the one that catches a
        // Dock/menu Quit — a window's CloseRequested never fires for those.
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if has_unsaved(app_handle) {
                    api.prevent_exit();
                    let _ = app_handle.emit(CLOSE_REQUESTED_EVENT, ());
                }
            }
        });
}
