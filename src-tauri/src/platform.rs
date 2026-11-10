use crate::models::Place;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn add_place(places: &mut Vec<Place>, name: &str, path: Option<PathBuf>, icon: &str, kind: &str) {
    if let Some(path) = path.filter(|p| p.is_dir()) {
        let path = path.to_string_lossy().into_owned();
        if !places.iter().any(|place| place.path == path) {
            places.push(Place {
                name: name.into(),
                path,
                icon: icon.into(),
                kind: kind.into(),
            });
        }
    }
}

#[tauri::command]
pub fn get_home_dir() -> String {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub fn get_places() -> Vec<Place> {
    let mut places = Vec::new();
    let home = dirs::home_dir();
    add_place(&mut places, "Inicio", home.clone(), "home", "place");
    add_place(
        &mut places,
        "Escritorio",
        dirs::desktop_dir(),
        "desktop",
        "place",
    );
    add_place(
        &mut places,
        "Documentos",
        dirs::document_dir(),
        "documents",
        "place",
    );
    add_place(
        &mut places,
        "Descargas",
        dirs::download_dir(),
        "downloads",
        "place",
    );
    add_place(
        &mut places,
        "Imágenes",
        dirs::picture_dir(),
        "pictures",
        "place",
    );
    add_place(&mut places, "Música", dirs::audio_dir(), "music", "place");
    add_place(&mut places, "Vídeos", dirs::video_dir(), "videos", "place");
    #[cfg(target_os = "macos")]
    add_place(
        &mut places,
        "Películas",
        home.map(|path| path.join("Movies")),
        "videos",
        "place",
    );
    #[cfg(target_os = "linux")]
    add_place(
        &mut places,
        "Vídeos",
        home.map(|path| path.join("Videos")),
        "videos",
        "place",
    );
    add_place(
        &mut places,
        "Sistema de archivos",
        Some(PathBuf::from("/")),
        "drive",
        "place",
    );
    places
}

fn decode_mount_field(value: &str) -> String {
    value
        .replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\134", "\\")
}

#[tauri::command]
pub fn get_volumes() -> Vec<Place> {
    let mut mounts: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        mounts.push(PathBuf::from("/"));
        if let Ok(entries) = fs::read_dir("/Volumes") {
            mounts.extend(entries.flatten().map(|entry| entry.path()));
        }
    }
    #[cfg(target_os = "linux")]
    {
        mounts.push(PathBuf::from("/"));
        const PSEUDO: &[&str] = &[
            "proc",
            "sysfs",
            "devtmpfs",
            "devpts",
            "tmpfs",
            "cgroup",
            "cgroup2",
            "securityfs",
            "debugfs",
            "pstore",
            "tracefs",
            "fusectl",
            "mqueue",
            "hugetlbfs",
            "configfs",
            "binfmt_misc",
            "nsfs",
            "autofs",
            "overlay",
        ];
        if let Ok(contents) = fs::read_to_string("/proc/self/mounts") {
            for line in contents.lines() {
                let fields: Vec<&str> = line.split_whitespace().collect();
                if fields.len() >= 3 && !PSEUDO.contains(&fields[2]) {
                    mounts.push(PathBuf::from(decode_mount_field(fields[1])));
                }
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    mounts.push(PathBuf::from("/"));

    mounts.sort();
    mounts.dedup();
    let mut places = Vec::new();
    for path in mounts {
        if !path.is_dir() {
            continue;
        }
        let name = if path == Path::new("/") {
            "Sistema de archivos".to_string()
        } else {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned())
        };
        let path = path.to_string_lossy().into_owned();
        if !places.iter().any(|place: &Place| place.path == path) {
            places.push(Place {
                name,
                path,
                icon: "drive".into(),
                kind: "volume".into(),
            });
        }
    }
    places
}

#[cfg(target_os = "macos")]
fn run_command(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err("Selecciona una carpeta para abrir la terminal.".into());
    }
    let path = path.to_string_lossy().into_owned();
    #[cfg(target_os = "macos")]
    {
        return run_command("open", &["-a", "Terminal", &path]);
    }
    #[cfg(target_os = "linux")]
    {
        let candidates: &[(&str, &[&str])] = &[
            ("gnome-terminal", &["--working-directory", &path]),
            ("konsole", &["--workdir", &path]),
            ("xfce4-terminal", &["--working-directory", &path]),
            ("kitty", &["--directory", &path]),
            ("alacritty", &["--working-directory", &path]),
            ("x-terminal-emulator", &["--working-directory", &path]),
        ];
        let mut last_error = String::new();
        for (program, args) in candidates {
            match Command::new(program).args(*args).spawn() {
                Ok(_) => return Ok(()),
                Err(error) => last_error = error.to_string(),
            }
        }
        return Err(format!("No se encontró una terminal compatible. Instala GNOME Terminal, Konsole, XFCE Terminal, Kitty o Alacritty. {last_error}"));
    }
    #[allow(unreachable_code)]
    Err("Abrir una terminal no está disponible en este sistema.".into())
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err("El elemento ya no existe.".into());
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("open")
            .args(["-R", &target.to_string_lossy()])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("No se pudo mostrar en Finder: {e}"));
    }
    #[cfg(target_os = "linux")]
    {
        let folder = if target.is_dir() {
            target
        } else {
            target.parent().unwrap_or(Path::new("/")).to_path_buf()
        };
        return Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("No se pudo abrir el gestor de archivos: {e}"));
    }
    #[allow(unreachable_code)]
    Err("No está disponible en este sistema.".into())
}
