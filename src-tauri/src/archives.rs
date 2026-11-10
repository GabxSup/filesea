use std::fs::{self, File};
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

fn add_to_zip(
    writer: &mut ZipWriter<File>,
    root: &Path,
    current: &Path,
    archive_root: &str,
    output: &Path,
) -> Result<(), String> {
    if current == output {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(current).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
    if metadata.is_dir() {
        let entries =
            fs::read_dir(current).map_err(|e| format!("No se pudo leer la carpeta: {e}"))?;
        let mut children = Vec::new();
        for entry in entries {
            children.push(entry.map_err(|e| e.to_string())?);
        }
        if children.is_empty() {
            let relative = current.strip_prefix(root).map_err(|e| e.to_string())?;
            let mut name = PathBuf::from(archive_root);
            name.push(relative);
            let name = format!(
                "{}/",
                name.to_string_lossy()
                    .replace('\\', "/")
                    .trim_end_matches('/')
            );
            writer
                .add_directory(name, options)
                .map_err(|e| e.to_string())?;
        } else {
            for entry in children {
                add_to_zip(writer, root, &entry.path(), archive_root, output)?;
            }
        }
        return Ok(());
    }
    let relative = current.strip_prefix(root).map_err(|e| e.to_string())?;
    let mut name = PathBuf::from(archive_root);
    name.push(relative);
    let name = name.to_string_lossy().replace('\\', "/");
    writer
        .start_file(name, options)
        .map_err(|e| e.to_string())?;
    let mut file = File::open(current).map_err(|e| e.to_string())?;
    std::io::copy(&mut file, writer).map_err(|e| e.to_string())?;
    Ok(())
}

fn add_source_to_zip(
    writer: &mut ZipWriter<File>,
    source: &Path,
    output: &Path,
) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(source).map_err(|e| format!("No se pudo abrir el origen: {e}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "No se puede comprimir directamente el enlace simbólico {}.",
            source.to_string_lossy()
        ));
    }
    let archive_root = source
        .file_name()
        .ok_or_else(|| "La ruta de origen no tiene nombre.".to_string())?
        .to_string_lossy()
        .into_owned();
    if metadata.is_dir() {
        add_to_zip(writer, source, source, &archive_root, output)
    } else {
        let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file(archive_root, options)
            .map_err(|e| e.to_string())?;
        let mut input = File::open(source).map_err(|e| e.to_string())?;
        std::io::copy(&mut input, writer).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub fn create_archive(sources: Vec<String>, destination: String) -> Result<String, String> {
    if sources.is_empty() {
        return Err("Selecciona al menos un elemento para comprimir.".into());
    }
    let destination = PathBuf::from(destination);
    let parent = destination
        .parent()
        .ok_or_else(|| "La ruta de destino no es válida.".to_string())?;
    if !parent.is_dir() {
        return Err("La carpeta de destino no existe.".into());
    }
    if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
        return Err("Ya existe un archivo con ese nombre.".into());
    }
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let archive_result: Result<(), String> = (|| {
        let output =
            File::create(&destination).map_err(|e| format!("No se pudo crear el ZIP: {e}"))?;
        let mut writer = ZipWriter::new(output);
        for source in &sources {
            add_source_to_zip(&mut writer, source, &destination)?;
        }
        writer.finish().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = archive_result {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn extract_archive(source: String, destination_dir: String) -> Result<String, String> {
    let source = PathBuf::from(source);
    let destination_dir = PathBuf::from(destination_dir);
    if !destination_dir.is_dir() {
        return Err("La carpeta de destino no existe.".into());
    }
    let destination_root = fs::canonicalize(&destination_dir).map_err(|e| e.to_string())?;
    let file = File::open(&source).map_err(|e| format!("No se pudo abrir el ZIP: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("El archivo ZIP no es válido: {e}"))?;
    if archive.len() > 100_000 {
        return Err("El ZIP contiene demasiados elementos (límite: 100.000).".into());
    }
    const MAX_UNPACKED_BYTES: u64 = 20 * 1024 * 1024 * 1024;
    let mut unpacked_bytes = 0u64;
    let mut extracted = 0usize;
    for index in 0..archive.len() {
        let mut item = archive.by_index(index).map_err(|e| e.to_string())?;
        unpacked_bytes = unpacked_bytes.saturating_add(item.size());
        if unpacked_bytes > MAX_UNPACKED_BYTES {
            return Err("La extracción supera el límite de 20 GB por operación.".into());
        }
        let enclosed = item
            .enclosed_name()
            .ok_or_else(|| "El ZIP contiene una ruta inválida y no se extrajo.".to_string())?
            .to_path_buf();
        let output = destination_dir.join(enclosed);
        if item.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|e| format!("No se pudo crear una carpeta: {e}"))?;
            let real_output = fs::canonicalize(&output).map_err(|e| e.to_string())?;
            if !real_output.starts_with(&destination_root) {
                return Err("El ZIP apunta fuera de la carpeta de destino.".into());
            }
        } else {
            let parent = output
                .parent()
                .ok_or_else(|| "Ruta de extracción inválida.".to_string())?;
            fs::create_dir_all(parent).map_err(|e| format!("No se pudo crear una carpeta: {e}"))?;
            let real_parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
            if !real_parent.starts_with(&destination_root) {
                return Err("El ZIP apunta fuera de la carpeta de destino.".into());
            }
            if output.exists() || fs::symlink_metadata(&output).is_ok() {
                return Err(format!(
                    "La extracción se detuvo para no sobrescribir: {}",
                    output.to_string_lossy()
                ));
            }
            let mut out = File::create(&output)
                .map_err(|e| format!("No se pudo escribir el archivo: {e}"))?;
            std::io::copy(&mut item, &mut out)
                .map_err(|e| format!("Error al extraer el archivo: {e}"))?;
        }
        extracted += 1;
    }
    Ok(format!(
        "Se extrajeron {extracted} elementos en {}",
        destination_dir.to_string_lossy()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("filesea-zip-test-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn zip_round_trip_preserves_folder_contents() {
        let root = test_dir();
        let source = root.join("sample");
        let extracted = root.join("out");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&extracted).unwrap();
        fs::write(source.join("hello.txt"), "hello from Filesea").unwrap();
        let archive = root.join("sample.zip");

        create_archive(
            vec![source.to_string_lossy().into_owned()],
            archive.to_string_lossy().into_owned(),
        )
        .unwrap();
        extract_archive(
            archive.to_string_lossy().into_owned(),
            extracted.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(extracted.join("sample/hello.txt")).unwrap(),
            "hello from Filesea"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn one_archive_can_include_multiple_selected_files() {
        let root = test_dir();
        let first = root.join("first.txt");
        let second = root.join("second.txt");
        fs::write(&first, "one").unwrap();
        fs::write(&second, "two").unwrap();
        let archive = root.join("selection.zip");
        create_archive(
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            archive.to_string_lossy().into_owned(),
        )
        .unwrap();
        let zip = ZipArchive::new(File::open(archive).unwrap()).unwrap();
        assert_eq!(zip.len(), 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extraction_rejects_parent_traversal_entries() {
        let root = test_dir();
        let extracted = root.join("out");
        fs::create_dir_all(&extracted).unwrap();
        let archive_path = root.join("malicious.zip");
        {
            let file = File::create(&archive_path).unwrap();
            let mut writer = ZipWriter::new(file);
            writer
                .start_file("../escape.txt", FileOptions::default())
                .unwrap();
            writer.write_all(b"unsafe").unwrap();
            writer.finish().unwrap();
        }
        assert!(extract_archive(
            archive_path.to_string_lossy().into_owned(),
            extracted.to_string_lossy().into_owned()
        )
        .is_err());
        assert!(!root.join("escape.txt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn extraction_refuses_to_follow_existing_symlinks() {
        let root = test_dir();
        let extracted = root.join("out");
        let outside = root.join("outside");
        fs::create_dir_all(&extracted).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, extracted.join("link")).unwrap();
        let archive_path = root.join("symlink.zip");
        {
            let file = File::create(&archive_path).unwrap();
            let mut writer = ZipWriter::new(file);
            writer
                .start_file("link/escape.txt", FileOptions::default())
                .unwrap();
            writer.write_all(b"unsafe").unwrap();
            writer.finish().unwrap();
        }
        assert!(extract_archive(
            archive_path.to_string_lossy().into_owned(),
            extracted.to_string_lossy().into_owned()
        )
        .is_err());
        assert!(!outside.join("escape.txt").exists());
        let _ = fs::remove_dir_all(root);
    }
}
