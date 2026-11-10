use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: u64,
    pub created: u64,
    pub extension: String,
    pub hidden: bool,
    pub readable: bool,
    pub writable: bool,
    pub permissions: String,
}

#[derive(Debug, Serialize)]
pub struct DirContents {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub parent: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Place {
    pub name: String,
    pub path: String,
    pub icon: String,
    pub kind: String,
}

#[derive(Debug, Serialize)]
pub struct Preview {
    pub kind: String,
    pub content: String,
    pub mime_type: String,
    pub truncated: bool,
}
