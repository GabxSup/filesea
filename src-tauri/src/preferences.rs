use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn favorites_file(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory)
        .map_err(|e| format!("No se pudo crear la configuración: {e}"))?;
    Ok(directory.join("favorites.json"))
}

#[tauri::command]
pub fn get_favorites(app: AppHandle) -> Result<Vec<String>, String> {
    let file = favorites_file(&app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(file).map_err(|e| format!("No se pudieron leer los favoritos: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("La lista de favoritos no es válida: {e}"))
}

#[tauri::command]
pub fn set_favorites(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let file = favorites_file(&app)?;
    let mut unique = Vec::new();
    for path in paths {
        if path.trim().is_empty() || !PathBuf::from(&path).is_absolute() {
            continue;
        }
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    let bytes = serde_json::to_vec_pretty(&unique).map_err(|e| e.to_string())?;
    let temporary = file.with_extension("json.tmp");
    fs::write(&temporary, bytes)
        .map_err(|e| format!("No se pudieron guardar los favoritos: {e}"))?;
    fs::rename(&temporary, &file)
        .map_err(|e| format!("No se pudo actualizar la lista de favoritos: {e}"))
}
