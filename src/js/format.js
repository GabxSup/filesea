export function formatSize(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return '—';
  const value = Number(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value, unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return unit === 0 ? `${value} B` : `${size.toFixed(1)} ${units[unit]}`;
}

export function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ICONS = {
  image: '🖼️', video: '🎬', audio: '🎵', code: '⌘', archive: '🗜️',
  pdf: '📕', document: '📝', spreadsheet: '📊', app: '🖥️', generic: '📄',
};

export function fileIcon(entry) {
  if (entry.is_dir) return entry.is_symlink ? '🔗' : '📁';
  if (entry.is_symlink) return '🔗';
  const ext = (entry.extension || '').toLowerCase();
  if (['png','jpg','jpeg','gif','webp','svg','bmp','tif','tiff','heic'].includes(ext)) return ICONS.image;
  if (['mp4','mkv','avi','mov','webm','m4v'].includes(ext)) return ICONS.video;
  if (['mp3','flac','wav','ogg','aac','m4a'].includes(ext)) return ICONS.audio;
  if (['js','ts','jsx','tsx','py','rs','go','c','cpp','h','java','rb','sh','bash','zsh'].includes(ext)) return ICONS.code;
  if (['zip','tar','gz','xz','rar','7z'].includes(ext)) return ICONS.archive;
  if (ext === 'pdf') return ICONS.pdf;
  if (['doc','docx','md','txt','odt','rtf'].includes(ext)) return ICONS.document;
  if (['xls','xlsx','csv','ods'].includes(ext)) return ICONS.spreadsheet;
  if (['app','dmg','pkg','deb','rpm','exe'].includes(ext)) return ICONS.app;
  return ICONS.generic;
}

export function isZip(entry) { return !entry.is_dir && (entry.extension || '').toLowerCase() === 'zip'; }

export function isPreviewable(entry) {
  if (entry.is_dir || entry.is_symlink) return false;
  const ext = (entry.extension || '').toLowerCase();
  return ['png','jpg','jpeg','gif','webp','svg','bmp','pdf','txt','md','rs','js','ts','json','toml','yaml','yml','css','html','xml','sh','py','csv'].includes(ext);
}
