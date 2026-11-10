use crate::models::{DirContents, FileEntry, Preview};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn timestamp(value: std::io::Result<SystemTime>) -> u64 {
    value
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn entry_from_path(path: &Path) -> Option<FileEntry> {
    let link_meta = fs::symlink_metadata(path).ok()?;
    let is_symlink = link_meta.file_type().is_symlink();
    let meta = if is_symlink {
        fs::metadata(path).unwrap_or_else(|_| link_meta.clone())
    } else {
        link_meta.clone()
    };
    let is_dir = meta.is_dir();
    let name = path.file_name()?.to_string_lossy().into_owned();
    let extension = if is_dir {
        String::new()
    } else {
        path.extension()
            .map(|ext| ext.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    };
    #[cfg(unix)]
    let (readable, writable, permissions) = {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode() & 0o7777;
        (
            mode & 0o444 != 0,
            mode & 0o222 != 0,
            format!("{:04o}", mode),
        )
    };
    #[cfg(not(unix))]
    let (readable, writable, permissions) = {
        let readonly = meta.permissions().readonly();
        (
            true,
            !readonly,
            if readonly {
                "solo lectura"
            } else {
                "lectura/escritura"
            }
            .to_string(),
        )
    };
    Some(FileEntry {
        name,
        path: display_path(path),
        is_dir,
        is_symlink,
        size: if is_dir { 0 } else { meta.len() },
        modified: timestamp(meta.modified()),
        created: timestamp(meta.created()),
        extension,
        hidden: path.file_name()?.to_string_lossy().starts_with('.'),
        readable,
        writable,
        permissions,
    })
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name == "." || name == ".." {
        return Err("El nombre no puede estar vacío ni ser '.' o '..'.".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("Usa un nombre simple, sin separadores de ruta.".into());
    }
    Ok(())
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!(
            "No es una carpeta accesible: {}",
            display_path(path)
        ));
    }
    Ok(())
}

fn unique_destination(dest_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .ok_or_else(|| "La ruta de origen no tiene nombre.".to_string())?;
    let first = dest_dir.join(name);
    if !first.exists() && fs::symlink_metadata(&first).is_err() {
        return Ok(first);
    }
    let stem = source.file_stem().unwrap_or(name).to_string_lossy();
    let extension = source
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..=9999 {
        let suffix = if index == 1 {
            " (copia)".to_string()
        } else {
            format!(" (copia {index})")
        };
        let candidate = dest_dir.join(format!("{stem}{suffix}{extension}"));
        if !candidate.exists() && fs::symlink_metadata(&candidate).is_err() {
            return Ok(candidate);
        }
    }
    Err("No se encontró un nombre libre para la copia.".into())
}

fn ensure_not_inside_source(src: &Path, dest_dir: &Path) -> Result<(), String> {
    let src_real =
        fs::canonicalize(src).map_err(|e| format!("No se pudo resolver el origen: {e}"))?;
    let dest_real =
        fs::canonicalize(dest_dir).map_err(|e| format!("No se pudo resolver el destino: {e}"))?;
    if dest_real.starts_with(&src_real) {
        return Err("No se puede copiar o mover una carpeta dentro de sí misma.".into());
    }
    Ok(())
}

fn copy_node(src: &Path, dest: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(src)
        .map_err(|e| format!("No se pudo leer {}: {e}", display_path(src)))?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(src).map_err(|e| format!("No se pudo leer el enlace: {e}"))?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, dest)
            .map_err(|e| format!("No se pudo copiar el enlace: {e}"))?;
        #[cfg(not(unix))]
        return Err("La copia de enlaces simbólicos no está disponible en este sistema.".into());
    } else if meta.is_dir() {
        fs::create_dir(dest)
            .map_err(|e| format!("No se pudo crear {}: {e}", display_path(dest)))?;
        for child in fs::read_dir(src).map_err(|e| format!("No se pudo leer la carpeta: {e}"))? {
            let child = child.map_err(|e| e.to_string())?;
            copy_node(&child.path(), &dest.join(child.file_name()))?;
        }
        let _ = fs::set_permissions(dest, meta.permissions());
    } else {
        fs::copy(src, dest).map_err(|e| format!("No se pudo copiar {}: {e}", display_path(src)))?;
    }
    Ok(())
}

fn remove_node(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn list_directory(path: String, show_hidden: bool) -> Result<DirContents, String> {
    let dir = PathBuf::from(&path);
    ensure_directory(&dir)?;
    let mut entries = Vec::new();
    for item in fs::read_dir(&dir).map_err(|e| format!("No se pudo abrir {}: {e}", path))? {
        let item = item.map_err(|e| e.to_string())?;
        if let Some(entry) = entry_from_path(&item.path()) {
            if show_hidden || !entry.hidden {
                entries.push(entry);
            }
        }
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    let parent = dir.parent().map(display_path);
    Ok(DirContents {
        path: display_path(&dir),
        entries,
        parent,
    })
}

#[tauri::command]
pub fn create_folder(path: String, name: String) -> Result<String, String> {
    validate_name(&name)?;
    let parent = PathBuf::from(&path);
    ensure_directory(&parent)?;
    let new_path = parent.join(name);
    fs::create_dir(&new_path).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    Ok(display_path(&new_path))
}

#[tauri::command]
pub fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    validate_name(&new_name)?;
    let old = PathBuf::from(&path);
    if fs::symlink_metadata(&old).is_err() {
        return Err(format!("El elemento ya no existe: {path}"));
    }
    let parent = old
        .parent()
        .ok_or_else(|| "No se puede renombrar esta ruta.".to_string())?;
    let new = parent.join(new_name);
    if old == new {
        return Ok(display_path(&old));
    }
    if new.exists() || fs::symlink_metadata(&new).is_ok() {
        return Err("Ya existe un archivo o carpeta con ese nombre.".into());
    }
    fs::rename(&old, &new).map_err(|e| format!("No se pudo renombrar: {e}"))?;
    Ok(display_path(&new))
}

#[tauri::command]
pub fn trash_entry(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if fs::symlink_metadata(&path).is_err() {
        return Err("El elemento ya no existe.".into());
    }
    trash::delete(&path).map_err(|e| format!("No se pudo mover a la papelera: {e}"))
}

#[tauri::command]
pub fn copy_entry(src: String, dest_dir: String) -> Result<String, String> {
    let source = PathBuf::from(&src);
    let dest_dir = PathBuf::from(&dest_dir);
    if fs::symlink_metadata(&source).is_err() {
        return Err(format!("El origen ya no existe: {src}"));
    }
    ensure_directory(&dest_dir)?;
    let meta = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        ensure_not_inside_source(&source, &dest_dir)?;
    }
    let dest = unique_destination(&dest_dir, &source)?;
    if let Err(error) = copy_node(&source, &dest) {
        let _ = remove_node(&dest);
        return Err(error);
    }
    Ok(display_path(&dest))
}

#[tauri::command]
pub fn move_entry(src: String, dest_dir: String) -> Result<String, String> {
    let source = PathBuf::from(&src);
    let dest_dir = PathBuf::from(&dest_dir);
    if fs::symlink_metadata(&source).is_err() {
        return Err(format!("El origen ya no existe: {src}"));
    }
    ensure_directory(&dest_dir)?;
    let meta = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        ensure_not_inside_source(&source, &dest_dir)?;
    }
    let dest = unique_destination(&dest_dir, &source)?;
    if source
        .parent()
        .map(fs::canonicalize)
        .transpose()
        .ok()
        .flatten()
        == fs::canonicalize(&dest_dir).ok()
    {
        return Ok(display_path(&source));
    }
    match fs::rename(&source, &dest) {
        Ok(()) => Ok(display_path(&dest)),
        Err(error) if error.raw_os_error() == Some(18) => {
            if let Err(copy_error) = copy_node(&source, &dest) {
                let _ = remove_node(&dest);
                return Err(copy_error);
            }
            remove_node(&source)?;
            Ok(display_path(&dest))
        }
        Err(error) => Err(format!("No se pudo mover el elemento: {error}")),
    }
}

#[tauri::command]
pub fn duplicate_entry(path: String) -> Result<String, String> {
    let source = PathBuf::from(path);
    let parent = source
        .parent()
        .ok_or_else(|| "La ruta no tiene carpeta contenedora.".to_string())?;
    copy_entry(display_path(&source), display_path(parent))
}

#[tauri::command]
pub fn get_entry_info(path: String) -> Result<FileEntry, String> {
    entry_from_path(&PathBuf::from(&path)).ok_or_else(|| format!("No se pudo leer: {path}"))
}

fn directory_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.file_type().is_symlink() {
        return meta.len();
    }
    if !meta.is_dir() {
        return meta.len();
    }
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

#[tauri::command]
pub fn calculate_size(path: String) -> Result<u64, String> {
    let path = PathBuf::from(path);
    if fs::symlink_metadata(&path).is_err() {
        return Err("El elemento ya no existe.".into());
    }
    Ok(directory_size(&path))
}

fn search_in(
    path: &Path,
    query: &str,
    show_hidden: bool,
    depth: usize,
    max: usize,
    results: &mut Vec<FileEntry>,
) {
    if depth > 64 || results.len() >= max {
        return;
    }
    let Ok(items) = fs::read_dir(path) else {
        return;
    };
    for item in items.flatten() {
        if results.len() >= max {
            break;
        }
        let child = item.path();
        let Some(entry) = entry_from_path(&child) else {
            continue;
        };
        if (show_hidden || !entry.hidden) && entry.name.to_lowercase().contains(query) {
            results.push(entry.clone());
        }
        if entry.is_dir && !entry.is_symlink {
            search_in(&child, query, show_hidden, depth + 1, max, results);
        }
    }
}

#[tauri::command]
pub fn search_recursive(
    root: String,
    query: String,
    show_hidden: bool,
    max_results: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(root);
    ensure_directory(&root)?;
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let max = max_results.unwrap_or(2000).clamp(1, 10_000);
    let mut results = Vec::new();
    search_in(&root, &query, show_hidden, 0, max, &mut results);
    Ok(results)
}

fn mime_type(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "txt" | "md" | "rs" | "js" | "ts" | "json" | "toml" | "yaml" | "yml" | "css" | "html"
        | "xml" | "sh" | "py" | "csv" => "text/plain",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub fn read_preview(path: String) -> Result<Preview, String> {
    const TEXT_LIMIT: usize = 512 * 1024;
    const MEDIA_LIMIT: u64 = 15 * 1024 * 1024;
    let path = PathBuf::from(path);
    let meta = fs::metadata(&path).map_err(|e| format!("No se pudo abrir la vista previa: {e}"))?;
    if !meta.is_file() {
        return Err("Solo se pueden previsualizar archivos.".into());
    }
    let extension = path
        .extension()
        .map(|v| v.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = mime_type(&extension);
    let kind = if mime.starts_with("image/") {
        "image"
    } else if mime == "application/pdf" {
        "pdf"
    } else if mime.starts_with("text/") {
        "text"
    } else {
        return Err("Este tipo de archivo no tiene vista previa integrada.".into());
    };
    if kind == "text" {
        let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut bytes = vec![0; TEXT_LIMIT + 1];
        let count = file.read(&mut bytes).map_err(|e| e.to_string())?;
        let truncated = count > TEXT_LIMIT;
        bytes.truncate(count.min(TEXT_LIMIT));
        let content = String::from_utf8_lossy(&bytes).into_owned();
        return Ok(Preview {
            kind: kind.into(),
            content,
            mime_type: mime.into(),
            truncated,
        });
    }
    if meta.len() > MEDIA_LIMIT {
        return Err(
            "El archivo es demasiado grande para una vista previa integrada (límite: 15 MB)."
                .into(),
        );
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Preview {
        kind: kind.into(),
        content: BASE64.encode(bytes),
        mime_type: mime.into(),
        truncated: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("filesea-test-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_names_that_escape_the_parent() {
        assert!(validate_name("../outside").is_err());
        assert!(validate_name("folder/name").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("safe folder").is_ok());
    }

    #[test]
    fn copy_uses_a_new_name_instead_of_overwriting() {
        let root = test_dir();
        let source_dir = root.join("source");
        let destination_dir = root.join("destination");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&destination_dir).unwrap();
        fs::write(source_dir.join("notes.txt"), "source data").unwrap();
        fs::write(destination_dir.join("notes.txt"), "existing data").unwrap();

        let copied = copy_entry(
            source_dir.join("notes.txt").to_string_lossy().into_owned(),
            destination_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(destination_dir.join("notes.txt")).unwrap(),
            "existing data"
        );
        assert_eq!(fs::read_to_string(copied).unwrap(), "source data");
        let _ = fs::remove_dir_all(root);
    }
}
