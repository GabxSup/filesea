export async function invoke(command, args = {}) {
  const fn = window.__TAURI__?.core?.invoke
    ?? window.__TAURI__?.tauri?.invoke
    ?? window.__TAURI__?.invoke;
  if (!fn) throw new Error('La conexión con Filesea no está disponible.');
  return fn(command, args);
}

export function isTauri() {
  return Boolean(window.__TAURI__?.core?.invoke || window.__TAURI__?.tauri?.invoke || window.__TAURI__?.invoke);
}

export function nativeDialog() {
  return window.__TAURI__?.dialog ?? null;
}
