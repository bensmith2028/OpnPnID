// File I/O (open/save dialogs, reading/writing project files) is handled entirely on the
// frontend via the fs and dialog plugins below — no custom commands are needed for that.
// The component library lives in its own SQLite database (separate from project files),
// managed via tauri-plugin-sql migrations below; the frontend talks to it directly
// through the plugin's JS API (src/library/db.ts) rather than hand-rolled Rust commands,
// consistent with how fs/dialog are already used as plugins rather than custom commands.
use tauri_plugin_sql::{Migration, MigrationKind};

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
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
