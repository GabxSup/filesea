#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod archives;
mod filesystem;
mod models;
mod platform;
mod preferences;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            filesystem::list_directory,
            filesystem::create_folder,
            filesystem::rename_entry,
            filesystem::trash_entry,
            filesystem::copy_entry,
            filesystem::move_entry,
            filesystem::duplicate_entry,
            filesystem::get_entry_info,
            filesystem::calculate_size,
            filesystem::search_recursive,
            filesystem::read_preview,
            platform::get_home_dir,
            platform::get_places,
            platform::get_volumes,
            platform::open_terminal,
            platform::reveal_in_file_manager,
            preferences::get_favorites,
            preferences::set_favorites,
            archives::create_archive,
            archives::extract_archive,
        ])
        .run(tauri::generate_context!())
        .expect("Error al iniciar Filesea");
}
