import { invoke, isTauri, nativeDialog } from './js/bridge.js';
import { fileIcon, formatDate, formatSize, isPreviewable, isZip } from './js/format.js';
import { makeTab, restoreTabs, saveTabs } from './js/tab-state.js';

const $ = id => document.getElementById(id);
const el = {
  container: $('filesContainer'), breadcrumb: $('breadcrumb'), address: $('addressInput'),
  loading: $('loading'), error: $('errorState'), errorMsg: $('errorMsg'), retry: $('btnRetry'),
  empty: $('emptyState'), emptyMessage: $('emptyMessage'), statusItems: $('statusItems'),
  statusSelected: $('statusSelected'), statusPath: $('statusPath'), search: $('searchInput'),
  searchClear: $('searchClear'), searchScope: $('btnSearchScope'), places: $('placesList'),
  volumes: $('volumesList'), favorites: $('favoritesList'), tabs: $('tabsList'),
  ctxMenu: $('contextMenu'), modalOverlay: $('modalOverlay'), modalTitle: $('modalTitle'),
  modalDescription: $('modalDescription'), modalInput: $('modalInput'), modalConfirm: $('modalConfirm'),
  modalCancel: $('modalCancel'), propsOverlay: $('propsOverlay'), propsIcon: $('propsIcon'),
  propsName: $('propsName'), propsType: $('propsType'), propsGrid: $('propsGrid'),
  propsClose: $('propsClose'), previewOverlay: $('previewOverlay'), previewTitle: $('previewTitle'),
  previewContent: $('previewContent'), previewClose: $('previewClose'), toast: $('toast'),
};

const state = {
  tabs: [], activeTabId: null, entries: [], filtered: [],
  showHidden: false, viewMode: localStorage.getItem('filesea.view') || 'list',
  sortBy: 'name', sortAsc: true, clipboard: null, favorites: [], places: [], volumes: [],
  modalAction: null, modalTarget: null, modalParent: null, ctxTarget: null,
  searchTimer: null, searchRequest: 0, toastTimer: null, addressEditing: false,
};

const activeTab = () => state.tabs.find(tab => tab.id === state.activeTabId) || state.tabs[0];
const currentPath = () => activeTab()?.path || '';
const selectedEntries = () => state.filtered.filter(entry => activeTab()?.selected.has(entry.path));
const errorText = err => typeof err === 'string' ? err : (err?.message || String(err));

function showLoading(loading) { el.loading.hidden = !loading; }
function showError(message) {
  el.error.hidden = false;
  el.errorMsg.textContent = message || 'Ocurrió un error.';
}
function clearError() { el.error.hidden = true; }
function toast(message, duration = 2600) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.hidden = false;
  state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, duration);
}

function persistSession() { saveTabs(state.tabs, state.activeTabId); }
function tabTitle(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.at(-1) || 'Inicio';
}

async function navigate(path, { push = true, preserveSearch = false } = {}) {
  if (!path) return;
  const tab = activeTab();
  if (!tab) return;
  showLoading(true);
  clearError();
  el.empty.hidden = true;
  try {
    const result = await invoke('list_directory', { path, showHidden: state.showHidden });
    const previousPath = tab.path;
    tab.path = result.path;
    tab.title = tabTitle(result.path);
    state.entries = result.entries;
    tab.selected.clear();
    if (push && result.path !== previousPath) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(result.path);
      tab.historyIndex = tab.history.length - 1;
    } else if (tab.historyIndex < 0) {
      tab.history = [result.path];
      tab.historyIndex = 0;
    }
    if (!preserveSearch && previousPath !== result.path) {
      tab.searchQuery = '';
      tab.searchResults = null;
      el.search.value = '';
    }
    const rerunSearch = preserveSearch && tab.recursiveSearch && Boolean(tab.searchQuery.trim());
    if (rerunSearch) tab.searchResults = null;
    renderAll();
    persistSession();
    if (rerunSearch) searchRecursively();
    return true;
  } catch (err) {
    showError(errorText(err));
    el.container.replaceChildren();
    el.statusPath.textContent = path;
    return false;
  } finally {
    showLoading(false);
  }
}

function goBack() {
  const tab = activeTab();
  if (tab && tab.historyIndex > 0) {
    tab.historyIndex--;
    navigate(tab.history[tab.historyIndex], { push: false });
    persistSession();
  }
}
function goForward() {
  const tab = activeTab();
  if (tab && tab.historyIndex < tab.history.length - 1) {
    tab.historyIndex++;
    navigate(tab.history[tab.historyIndex], { push: false });
    persistSession();
  }
}
function goUp() {
  const path = currentPath();
  if (!path || path === '/') return;
  const parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
  navigate(parent);
}

function renderAll() {
  const tab = activeTab();
  if (!tab) return;
  el.search.value = tab.searchQuery || '';
  el.searchScope.classList.toggle('active', tab.recursiveSearch);
  el.searchScope.setAttribute('aria-pressed', String(tab.recursiveSearch));
  renderTabs();
  renderBreadcrumb(tab.path);
  renderFiles();
  updateToolbarButtons();
  updateSidebarActive(tab.path);
  updateFavoriteButton();
  updateStatus();
  el.statusPath.textContent = tab.path;
}

function renderBreadcrumb(path) {
  el.breadcrumb.replaceChildren();
  if (state.addressEditing) {
    el.breadcrumb.classList.add('editing');
    el.address.hidden = false;
    el.address.value = path;
    el.breadcrumb.appendChild(el.address);
    return;
  }
  el.breadcrumb.classList.remove('editing');
  el.address.hidden = true;
  const segments = path === '/' ? [] : path.split('/').filter(Boolean);
  const root = document.createElement('button');
  root.className = `bc-btn${segments.length ? '' : ' current'}`;
  root.textContent = '/';
  root.title = '/';
  root.addEventListener('click', () => navigate('/'));
  el.breadcrumb.append(root);
  let current = '';
  for (let i = 0; i < segments.length; i++) {
    current += `/${segments[i]}`;
    const segmentPath = current;
    const wrap = document.createElement('span');
    wrap.className = 'bc-part';
    const button = document.createElement('button');
    const last = i === segments.length - 1;
    button.className = `bc-btn${last ? ' current' : ''}`;
    button.textContent = segments[i];
    button.title = segmentPath;
    button.disabled = last;
    if (!last) button.addEventListener('click', () => navigate(segmentPath));
    wrap.appendChild(button);
    el.breadcrumb.appendChild(wrap);
    if (!last) {
      const separator = document.createElement('span');
      separator.className = 'bc-sep';
      separator.textContent = '/';
      el.breadcrumb.appendChild(separator);
    }
  }
  el.breadcrumb.scrollLeft = el.breadcrumb.scrollWidth;
}

function renderTabs() {
  el.tabs.replaceChildren();
  state.tabs.forEach(tab => {
    const item = document.createElement('div');
    item.className = `tab${tab.id === state.activeTabId ? ' active' : ''}`;
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(tab.id === state.activeTabId));
    item.title = tab.path || 'Nueva pestaña';
    const label = document.createElement('button');
    label.className = 'tab-label';
    label.textContent = tab.title || 'Nueva pestaña';
    label.addEventListener('click', () => switchTab(tab.id));
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Cerrar pestaña';
    close.setAttribute('aria-label', `Cerrar pestaña ${tab.title}`);
    close.addEventListener('click', event => { event.stopPropagation(); closeTab(tab.id); });
    item.append(label, close);
    el.tabs.appendChild(item);
  });
}

function createTab(path = currentPath()) {
  if (state.tabs.length >= 12) { toast('Puedes tener hasta 12 pestañas abiertas.'); return; }
  const tab = makeTab(path, path ? tabTitle(path) : 'Nueva pestaña');
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  persistSession();
  if (path) navigate(path, { push: false });
  else {
    const home = state.places.find(place => place.icon === 'home')?.path;
    navigate(home || '/', { push: false });
  }
}
function switchTab(id) {
  if (id === state.activeTabId) return;
  state.activeTabId = id;
  const tab = activeTab();
  if (tab?.path) navigate(tab.path, { push: false, preserveSearch: true });
  renderAll();
  persistSession();
}
function closeTab(id) {
  if (state.tabs.length === 1) { createTab(currentPath()); closeTab(id); return; }
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index < 0) return;
  state.tabs.splice(index, 1);
  if (id === state.activeTabId) {
    state.activeTabId = state.tabs[Math.max(0, index - 1)].id;
    const tab = activeTab();
    if (tab?.path) navigate(tab.path, { push: false, preserveSearch: true });
  }
  renderAll();
  persistSession();
}

function applyFilter() {
  const tab = activeTab();
  if (!tab) return;
  const query = (tab.searchQuery || '').trim().toLocaleLowerCase();
  let entries = tab.searchResults ?? state.entries;
  if (!tab.searchResults && query) entries = entries.filter(entry => entry.name.toLocaleLowerCase().includes(query));
  entries = [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let cmp = 0;
    if (state.sortBy === 'name') cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    if (state.sortBy === 'size') cmp = a.size - b.size;
    if (state.sortBy === 'modified') cmp = a.modified - b.modified;
    if (state.sortBy === 'type') cmp = a.extension.localeCompare(b.extension, undefined, { sensitivity: 'base' });
    return state.sortAsc ? cmp : -cmp;
  });
  const visiblePaths = new Set(entries.map(entry => entry.path));
  for (const path of tab.selected) if (!visiblePaths.has(path)) tab.selected.delete(path);
  state.filtered = entries;
  renderFiles();
  updateStatus();
}

function sortArrow(column) {
  return state.sortBy === column ? (state.sortAsc ? ' ↑' : ' ↓') : '';
}
function setSort(column) {
  if (state.sortBy === column) state.sortAsc = !state.sortAsc;
  else { state.sortBy = column; state.sortAsc = true; }
  applyFilter();
}

function renderFiles() {
  const tab = activeTab();
  const container = el.container;
  container.replaceChildren();
  container.className = `files-container ${state.viewMode}-view`;
  container.classList.toggle('search-results-view', Boolean(tab?.searchResults));
  const items = state.filtered;
  const query = tab?.searchQuery?.trim();
  el.empty.hidden = items.length > 0 || Boolean(el.error.hidden === false);
  el.emptyMessage.textContent = query
    ? (tab?.searchResults ? 'No se encontraron coincidencias en las subcarpetas' : 'No hay coincidencias en esta carpeta')
    : 'Esta carpeta está vacía';
  if (!items.length) return;

  if (state.viewMode === 'list') {
    const header = document.createElement('div');
    header.className = 'list-header';
    header.innerHTML = `<button data-sort="name">Nombre${sortArrow('name')}</button><button data-sort="size">Tamaño${sortArrow('size')}</button><button data-sort="modified">Modificado${sortArrow('modified')}</button><button data-sort="type">Tipo${sortArrow('type')}</button>`;
    header.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => setSort(button.dataset.sort)));
    container.appendChild(header);
  }
  items.forEach(entry => container.appendChild(createFileItem(entry)));
}

function createFileItem(entry) {
  const item = document.createElement('div');
  const selected = activeTab().selected.has(entry.path);
  item.className = `file-item${selected ? ' selected' : ''}${entry.is_symlink ? ' symlink' : ''}`;
  item.dataset.path = entry.path;
  item.dataset.isDir = String(entry.is_dir);
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
  item.setAttribute('aria-label', `${entry.name}${entry.is_dir ? ', carpeta' : ''}`);
  item.tabIndex = -1;
  item.draggable = true;
  const nameCell = document.createElement('div');
  nameCell.className = 'file-name-cell';
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = fileIcon(entry);
  const name = document.createElement('span');
  name.className = `file-name${entry.hidden ? ' hidden-file' : ''}`;
  name.textContent = entry.name;
  name.title = entry.name;
  nameCell.append(icon, name);
  item.appendChild(nameCell);
  const size = document.createElement('span');
  size.className = 'file-size'; size.textContent = entry.is_dir ? '—' : formatSize(entry.size);
  const date = document.createElement('span');
  date.className = 'file-date'; date.textContent = formatDate(entry.modified);
  const type = document.createElement('span');
  type.className = 'file-type'; type.textContent = entry.is_dir ? 'Carpeta' : (entry.extension ? entry.extension.toUpperCase() : 'Archivo');
  item.append(size, date, type);
  item.addEventListener('click', event => handleItemClick(event, entry));
  item.addEventListener('dblclick', () => handleItemDblClick(entry));
  item.addEventListener('contextmenu', event => { event.preventDefault(); openContextMenu(event, entry); });
  item.addEventListener('dragstart', event => {
    const paths = activeTab().selected.has(entry.path) ? [...activeTab().selected] : [entry.path];
    event.dataTransfer.setData('application/x-filesea-paths', JSON.stringify(paths));
    event.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => item.classList.remove('dragging'));
  item.addEventListener('dragover', event => {
    if (entry.is_dir) { event.preventDefault(); item.classList.add('drop-target'); }
  });
  item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
  item.addEventListener('drop', event => {
    item.classList.remove('drop-target');
    if (entry.is_dir) { event.preventDefault(); dropInternal(event, entry.path); }
  });
  return item;
}

function handleItemClick(event, entry) {
  const tab = activeTab();
  const paths = state.filtered.map(item => item.path);
  if (event.metaKey || event.ctrlKey) {
    tab.selected.has(entry.path) ? tab.selected.delete(entry.path) : tab.selected.add(entry.path);
  } else if (event.shiftKey && tab.selected.size) {
    const last = [...tab.selected].at(-1);
    const a = paths.indexOf(last), b = paths.indexOf(entry.path);
    if (a >= 0 && b >= 0) {
      tab.selected.clear();
      for (let index = Math.min(a, b); index <= Math.max(a, b); index++) tab.selected.add(paths[index]);
    }
  } else {
    tab.selected.clear();
    tab.selected.add(entry.path);
  }
  el.container.focus({ preventScroll: true });
  refreshSelection();
  updateStatus();
}
function handleItemDblClick(entry) {
  if (entry.is_dir) navigate(entry.path);
  else openFile(entry.path);
}
function refreshSelection() {
  const tab = activeTab();
  el.container.querySelectorAll('.file-item').forEach(item => {
    const selected = tab.selected.has(item.dataset.path);
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-selected', String(selected));
  });
}

async function openFile(path) {
  try { await invoke('plugin:shell|open', { path }); }
  catch (err) { toast(`No se pudo abrir el archivo: ${errorText(err)}`, 4200); }
}

function updateToolbarButtons() {
  const tab = activeTab();
  $('btnBack').disabled = !tab || tab.historyIndex <= 0;
  $('btnForward').disabled = !tab || tab.historyIndex >= tab.history.length - 1;
  $('btnUp').disabled = !tab || tab.path === '/';
}
function updateStatus() {
  const tab = activeTab();
  const items = state.filtered;
  const dirs = items.filter(entry => entry.is_dir).length;
  el.statusItems.textContent = `${items.length} ${tab?.searchResults ? 'resultados' : 'elementos'} (${dirs} carpetas, ${items.length - dirs} archivos)`;
  const selected = selectedEntries();
  const size = selected.reduce((sum, entry) => sum + (entry.is_dir ? 0 : entry.size), 0);
  el.statusSelected.textContent = selected.length ? `${selected.length} seleccionado${selected.length === 1 ? '' : 's'} · ${formatSize(size)}` : '';
}

function renderBreadcrumbActive(path) {
  const prefix = `${path.replace(/\/+$/, '')}/`;
  document.querySelectorAll('.sidebar-link').forEach(button => {
    const location = button.dataset.path;
    button.classList.toggle('active', location === path || (location !== '/' && prefix.startsWith(`${location.replace(/\/+$/, '')}/`)));
  });
}
function updateSidebarActive(path) { renderBreadcrumbActive(path); }

function makeSidebarRow(place, { removable = false } = {}) {
  const li = document.createElement('li');
  li.className = 'sidebar-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sidebar-link';
  button.dataset.path = place.path;
  button.title = place.path;
  const icon = document.createElement('span');
  icon.className = 'sidebar-icon';
  icon.textContent = ({ home:'⌂', desktop:'▣', documents:'▤', downloads:'↓', pictures:'▧', music:'♫', videos:'▷', drive:'▰' })[place.icon] || '📁';
  const label = document.createElement('span');
  label.className = 'sidebar-label'; label.textContent = place.name;
  button.append(icon, label);
  button.addEventListener('click', () => navigate(place.path));
  li.appendChild(button);
  if (removable) {
    const remove = document.createElement('button');
    remove.className = 'favorite-remove'; remove.type = 'button'; remove.textContent = '×';
    remove.title = `Quitar ${place.name} de Favoritos`;
    remove.addEventListener('click', event => { event.stopPropagation(); removeFavorite(place.path); });
    li.appendChild(remove);
  }
  return li;
}
async function loadPlaces() {
  try {
    state.places = await invoke('get_places');
    el.places.replaceChildren(...state.places.map(place => makeSidebarRow(place)));
  } catch (err) { toast(`No se pudieron cargar los lugares: ${errorText(err)}`, 4200); }
}
async function loadVolumes() {
  try {
    state.volumes = await invoke('get_volumes');
    el.volumes.replaceChildren(...state.volumes.map(place => makeSidebarRow(place)));
  } catch (err) { el.volumes.replaceChildren(); }
}
async function loadFavorites() {
  try {
    state.favorites = await invoke('get_favorites');
    renderFavorites();
  } catch (err) { toast(`No se pudieron cargar los favoritos: ${errorText(err)}`, 4200); }
}
function renderFavorites() {
  if (!state.favorites.length) {
    const empty = document.createElement('li');
    empty.className = 'sidebar-empty'; empty.textContent = 'Usa ☆ para guardar carpetas';
    el.favorites.replaceChildren(empty);
    return;
  }
  const favorites = state.favorites.map(path => ({ path, name: tabTitle(path), icon: 'folder', kind: 'favorite' }));
  el.favorites.replaceChildren(...favorites.map(place => makeSidebarRow(place, { removable: true })));
  updateSidebarActive(currentPath());
}
function isFavorite(path) { return state.favorites.includes(path); }
function updateFavoriteButton() { $('btnFavorite').classList.toggle('active', isFavorite(currentPath())); }
async function addFavorite(path = currentPath()) {
  if (!path) return;
  if (!state.favorites.includes(path)) state.favorites.push(path);
  try {
    await invoke('set_favorites', { paths: state.favorites });
    renderFavorites(); updateFavoriteButton();
    toast('Añadido a Favoritos');
  } catch (err) { toast(`No se pudo guardar el favorito: ${errorText(err)}`, 4200); }
}
async function removeFavorite(path) {
  state.favorites = state.favorites.filter(item => item !== path);
  try {
    await invoke('set_favorites', { paths: state.favorites });
    renderFavorites(); updateFavoriteButton();
  } catch (err) { toast(`No se pudo quitar el favorito: ${errorText(err)}`, 4200); }
}
async function toggleFavorite(path = currentPath()) {
  if (isFavorite(path)) await removeFavorite(path);
  else await addFavorite(path);
}

function getContextTargets(target = state.ctxTarget) {
  const selected = selectedEntries();
  if (target && activeTab().selected.has(target.path)) return selected;
  return target ? [target] : selected;
}
function openContextMenu(event, entry = null) {
  state.ctxTarget = entry;
  if (entry && !activeTab().selected.has(entry.path)) {
    activeTab().selected.clear();
    activeTab().selected.add(entry.path);
    refreshSelection(); updateStatus();
  }
  const targets = getContextTargets(entry);
  const target = targets[0] || entry;
  el.ctxMenu.querySelector('[data-action="preview"]').hidden = !target || !isPreviewable(target);
  el.ctxMenu.querySelector('[data-action="reveal"]').hidden = !target;
  el.ctxMenu.querySelector('[data-action="open-terminal"]').hidden = Boolean(target && !target.is_dir);
  el.ctxMenu.querySelector('[data-action="favorite"]').hidden = !target?.is_dir;
  el.ctxMenu.querySelector('[data-action="favorite"]').textContent = target && isFavorite(target.path) ? 'Quitar de Favoritos' : 'Añadir a Favoritos';
  el.ctxMenu.querySelector('[data-action="compress"]').hidden = !targets.length;
  el.ctxMenu.querySelector('[data-action="extract"]').hidden = !targets.some(isZip);
  el.ctxMenu.querySelectorAll('[data-action="open"], [data-action="copy"], [data-action="cut"], [data-action="duplicate"], [data-action="rename"], [data-action="trash"], [data-action="properties"]').forEach(item => item.classList.toggle('disabled', !targets.length));
  $('ctxPaste').classList.toggle('disabled', !state.clipboard);
  el.ctxMenu.hidden = false;
  const width = el.ctxMenu.offsetWidth, height = el.ctxMenu.offsetHeight;
  el.ctxMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
  el.ctxMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
}
function closeContextMenu() { el.ctxMenu.hidden = true; state.ctxTarget = null; }

async function pasteClipboard(destination = currentPath()) {
  if (!state.clipboard?.paths?.length) return;
  let success = 0;
  const errors = [];
  for (const src of state.clipboard.paths) {
    if (src === destination || destination.startsWith(`${src.replace(/\/+$/, '')}/`)) {
      errors.push(`${tabTitle(src)} no se puede pegar dentro de sí mismo`);
      continue;
    }
    try {
      if (state.clipboard.action === 'cut') await invoke('move_entry', { src, destDir: destination });
      else await invoke('copy_entry', { src, destDir: destination });
      success++;
    } catch (err) { errors.push(`${tabTitle(src)}: ${errorText(err)}`); }
  }
  if (state.clipboard.action === 'cut' && success) state.clipboard = null;
  if (errors.length) toast(`Se completaron ${success}; ${errors.join(' · ')}`, 6000);
  else toast(success === 1 ? 'Elemento pegado' : `${success} elementos pegados`);
  await navigate(currentPath(), { push: false, preserveSearch: true });
}
async function trashEntries(entries) {
  if (!entries.length) return;
  const names = entries.map(entry => entry.name).join('\n');
  if (!window.confirm(`¿Mover a la papelera?\n\n${names}`)) return;
  let success = 0;
  const errors = [];
  for (const entry of entries) {
    try { await invoke('trash_entry', { path: entry.path }); success++; }
    catch (err) { errors.push(`${entry.name}: ${errorText(err)}`); }
  }
  activeTab().selected.clear();
  await navigate(currentPath(), { push: false, preserveSearch: true });
  if (errors.length) toast(`Se movieron ${success}; errores: ${errors.join(' · ')}`, 6000);
  else toast(success === 1 ? 'Elemento movido a la papelera' : `${success} elementos movidos a la papelera`);
}

function openModal(action, target = null, parent = currentPath()) {
  state.modalAction = action;
  state.modalTarget = target;
  state.modalParent = parent;
  const labels = {
    rename: ['Renombrar', target?.name || '', 'Escribe el nuevo nombre.'],
    'new-folder': ['Nueva carpeta', 'Nueva carpeta', 'Crea una carpeta en la ubicación actual.'],
    archive: ['Crear archivo ZIP', target ? `${target.name}.zip` : 'archivo.zip', 'Elige el nombre del archivo ZIP.'],
  };
  const [title, value, description] = labels[action] || ['Filesea', '', ''];
  el.modalTitle.textContent = title;
  el.modalDescription.textContent = description;
  el.modalInput.value = value;
  el.modalOverlay.hidden = false;
  requestAnimationFrame(() => { el.modalInput.focus(); el.modalInput.select(); });
}
function closeModal() { el.modalOverlay.hidden = true; state.modalAction = null; state.modalTarget = null; }
async function confirmModal() {
  const value = el.modalInput.value.trim();
  if (!value) return;
  const action = state.modalAction;
  const parent = state.modalParent;
  try {
    if (action === 'rename' && state.modalTarget) {
      await invoke('rename_entry', { path: state.modalTarget.path, newName: value });
    } else if (action === 'new-folder') {
      await invoke('create_folder', { path: state.modalParent || currentPath(), name: value });
    } else if (action === 'archive' && state.modalTarget) {
      const name = value.toLowerCase().endsWith('.zip') ? value : `${value}.zip`;
      const destination = `${state.modalParent || currentPath()}/${name}`.replaceAll('//', '/');
      await invoke('create_archive', { sources: [state.modalTarget.path], destination });
      toast('Archivo ZIP creado');
    }
    activeTab().selected.clear();
    closeModal();
    if (action === 'new-folder' && parent !== currentPath()) toast('Carpeta creada');
    else await navigate(currentPath(), { push: false, preserveSearch: true });
  } catch (err) { toast(errorText(err), 5000); }
}

async function showProperties(entry) {
  el.propsIcon.textContent = fileIcon(entry);
  el.propsName.textContent = entry.name;
  el.propsType.textContent = entry.is_dir ? (entry.is_symlink ? 'Enlace a carpeta' : 'Carpeta') : (entry.extension ? `Archivo .${entry.extension}` : 'Archivo');
  const fields = [
    ['Ubicación', entry.path], ['Tamaño', entry.is_dir ? 'Calculando…' : formatSize(entry.size)],
    ['Modificado', formatDate(entry.modified)], ['Creado', formatDate(entry.created)],
    ['Extensión', entry.extension || '—'], ['Oculto', entry.hidden ? 'Sí' : 'No'],
    ['Enlace simbólico', entry.is_symlink ? 'Sí' : 'No'], ['Permisos', entry.permissions || '—'],
    ['Lectura', entry.readable ? 'Sí' : 'No'], ['Escritura', entry.writable ? 'Sí' : 'No'],
  ];
  const renderFields = () => {
    el.propsGrid.replaceChildren(...fields.map(([label, value]) => {
      const wrapper = document.createElement('div'); wrapper.className = 'props-field';
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = String(value);
      wrapper.append(dt, dd); return wrapper;
    }));
  };
  renderFields(); el.propsOverlay.hidden = false;
  if (entry.is_dir) {
    try { fields[1][1] = formatSize(await invoke('calculate_size', { path: entry.path })); renderFields(); }
    catch (_) { fields[1][1] = 'No disponible'; renderFields(); }
  }
}

async function showPreview(entry) {
  el.previewTitle.textContent = entry.name;
  el.previewContent.replaceChildren();
  const loading = document.createElement('div'); loading.className = 'preview-loading'; loading.textContent = 'Preparando vista previa…';
  el.previewContent.appendChild(loading);
  el.previewOverlay.hidden = false;
  try {
    const preview = await invoke('read_preview', { path: entry.path });
    el.previewContent.replaceChildren();
    if (preview.kind === 'image') {
      const image = document.createElement('img');
      image.src = `data:${preview.mime_type};base64,${preview.content}`;
      image.alt = entry.name;
      el.previewContent.appendChild(image);
    } else if (preview.kind === 'pdf') {
      const frame = document.createElement('iframe');
      frame.src = `data:application/pdf;base64,${preview.content}`;
      frame.title = entry.name;
      el.previewContent.appendChild(frame);
    } else {
      const text = document.createElement('pre'); text.textContent = preview.content;
      el.previewContent.appendChild(text);
      if (preview.truncated) {
        const note = document.createElement('p'); note.className = 'preview-note'; note.textContent = 'Vista previa parcial: el archivo supera 512 KB.';
        el.previewContent.appendChild(note);
      }
    }
  } catch (err) {
    const message = document.createElement('p'); message.className = 'preview-error'; message.textContent = errorText(err);
    el.previewContent.replaceChildren(message);
  }
}
function closePreview() { el.previewOverlay.hidden = true; el.previewContent.replaceChildren(); }

async function compressEntries(entries) {
  if (!entries.length) return;
  const defaultPath = entries.length === 1 ? `${entries[0].path}.zip` : `${currentPath()}/Selección.zip`.replaceAll('//', '/');
  let destination = defaultPath;
  const dialog = nativeDialog();
  if (typeof dialog?.save === 'function') {
    try {
      destination = await dialog.save({ defaultPath, filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }] });
      if (!destination) return;
    } catch (err) { toast(`No se pudo abrir el diálogo de guardado: ${errorText(err)}`, 5000); return; }
  }
  try {
    await invoke('create_archive', { sources: entries.map(entry => entry.path), destination });
    await navigate(currentPath(), { push: false, preserveSearch: true });
    toast(entries.length === 1 ? 'ZIP creado' : `${entries.length} elementos comprimidos en un ZIP`);
  } catch (err) { toast(`No se pudo crear el ZIP: ${errorText(err)}`, 5000); }
}
async function extractEntries(entries) {
  let count = 0;
  for (const entry of entries.filter(isZip)) {
    try {
      const result = await invoke('extract_archive', { source: entry.path, destinationDir: currentPath() });
      count++;
      toast(result, 3200);
    } catch (err) { toast(`No se pudo extraer ${entry.name}: ${errorText(err)}`, 5000); }
  }
  if (count) await navigate(currentPath(), { push: false, preserveSearch: true });
}

async function runContextAction(action, target, targets) {
  switch (action) {
    case 'open':
      if (target?.is_dir) await navigate(target.path);
      else if (target) await openFile(target.path);
      break;
    case 'preview': if (target && isPreviewable(target)) await showPreview(target); break;
    case 'reveal': if (target) try { await invoke('reveal_in_file_manager', { path: target.path }); } catch (err) { toast(errorText(err), 4500); } break;
    case 'open-terminal': {
      const directory = target?.is_dir ? target.path : currentPath();
      try { await invoke('open_terminal', { path: directory }); } catch (err) { toast(errorText(err), 5000); }
      break;
    }
    case 'copy': state.clipboard = { paths: targets.map(item => item.path), action: 'copy' }; toast(`${targets.length} elemento(s) copiado(s)`); break;
    case 'cut': state.clipboard = { paths: targets.map(item => item.path), action: 'cut' }; toast(`${targets.length} elemento(s) listo(s) para mover`); break;
    case 'paste': await pasteClipboard(target?.is_dir ? target.path : currentPath()); break;
    case 'duplicate':
      for (const item of targets) try { await invoke('duplicate_entry', { path: item.path }); } catch (err) { toast(errorText(err), 4500); }
      await navigate(currentPath(), { push: false, preserveSearch: true });
      break;
    case 'rename': if (target) openModal('rename', target); break;
    case 'favorite': if (target?.is_dir) await toggleFavorite(target.path); break;
    case 'compress': if (targets.length) await compressEntries(targets); break;
    case 'extract': await extractEntries(targets); break;
    case 'trash': await trashEntries(targets); break;
    case 'new-folder': openModal('new-folder', null, target?.is_dir ? target.path : currentPath()); break;
    case 'properties': if (target) await showProperties(target); break;
  }
}

async function searchRecursively() {
  const tab = activeTab();
  const query = (tab?.searchQuery || '').trim();
  const request = ++state.searchRequest;
  if (!tab || !tab.recursiveSearch || !query) {
    if (tab) tab.searchResults = null;
    applyFilter();
    return;
  }
  try {
    const results = await invoke('search_recursive', { root: tab.path, query, showHidden: state.showHidden, maxResults: 3000 });
    if (request !== state.searchRequest || tab !== activeTab()) return;
    tab.searchResults = results;
    applyFilter();
  } catch (err) {
    if (request === state.searchRequest) { tab.searchResults = null; applyFilter(); toast(`La búsqueda recursiva falló: ${errorText(err)}`, 5000); }
  }
}
function updateSearch() {
  const tab = activeTab();
  if (!tab) return;
  state.searchRequest++;
  tab.searchQuery = el.search.value;
  tab.selected.clear();
  tab.searchResults = tab.recursiveSearch && tab.searchQuery.trim() ? [] : null;
  clearTimeout(state.searchTimer);
  applyFilter();
  if (tab.recursiveSearch && tab.searchQuery.trim()) state.searchTimer = setTimeout(searchRecursively, 320);
}

async function dropInternal(event, destination) {
  let paths = [];
  try { paths = JSON.parse(event.dataTransfer.getData('application/x-filesea-paths') || '[]'); } catch (_) { return; }
  let moved = 0;
  for (const src of paths) {
    if (src === destination || destination.startsWith(`${src.replace(/\/+$/, '')}/`)) continue;
    try { await invoke('move_entry', { src, destDir: destination }); moved++; }
    catch (err) { toast(`No se pudo mover ${tabTitle(src)}: ${errorText(err)}`, 5000); }
  }
  if (moved) { toast(`${moved} elemento(s) movido(s)`); await navigate(currentPath(), { push: false, preserveSearch: true }); }
}
function setupNativeDrop() {
  try {
    const webview = window.__TAURI__?.webview?.getCurrentWebview?.();
    if (typeof webview?.onDragDropEvent !== 'function') return;
    webview.onDragDropEvent(async event => {
      const payload = event.payload || {};
      if (payload.type !== 'drop' || !Array.isArray(payload.paths) || !payload.paths.length) return;
      const target = document.elementFromPoint(payload.position?.x || 0, payload.position?.y || 0)?.closest('.file-item');
      const destination = target?.dataset.isDir === 'true' ? target.dataset.path : currentPath();
      let copied = 0;
      for (const src of payload.paths) {
        try { await invoke('copy_entry', { src, destDir: destination }); copied++; }
        catch (err) { toast(`No se pudo importar ${tabTitle(src)}: ${errorText(err)}`, 5000); }
      }
      if (copied) { toast(`${copied} elemento(s) copiado(s)`); await navigate(currentPath(), { push: false, preserveSearch: true }); }
    });
  } catch (_) { /* El arrastre nativo puede no estar disponible en algunas compilaciones. */ }
}

function toggleAddressEditor() {
  state.addressEditing = true;
  renderBreadcrumb(currentPath());
  el.address.focus(); el.address.select();
}
function finishAddressEditor(commit) {
  const path = el.address.value.trim();
  state.addressEditing = false;
  renderBreadcrumb(currentPath());
  if (commit && path) navigate(path);
}

function setupEvents() {
  $('btnBack').addEventListener('click', goBack);
  $('btnForward').addEventListener('click', goForward);
  $('btnUp').addEventListener('click', goUp);
  $('btnRefresh').addEventListener('click', () => navigate(currentPath(), { push: false, preserveSearch: true }));
  $('btnRetry').addEventListener('click', () => navigate(currentPath(), { push: false, preserveSearch: true }));
  $('btnNewFolder').addEventListener('click', () => openModal('new-folder'));
  $('btnFavorite').addEventListener('click', () => toggleFavorite());
  $('btnAddFavorite').addEventListener('click', () => addFavorite());
  $('btnNewTab').addEventListener('click', () => createTab());
  $('btnHidden').addEventListener('click', () => {
    state.showHidden = !state.showHidden;
    $('btnHidden').classList.toggle('active', state.showHidden);
    $('btnHidden').setAttribute('aria-pressed', String(state.showHidden));
    navigate(currentPath(), { push: false, preserveSearch: true });
  });
  $('btnSearchScope').addEventListener('click', () => {
    const tab = activeTab(); tab.recursiveSearch = !tab.recursiveSearch;
    el.searchScope.classList.toggle('active', tab.recursiveSearch);
    el.searchScope.setAttribute('aria-pressed', String(tab.recursiveSearch));
    updateSearch();
  });
  document.querySelectorAll('.view-btn').forEach(button => button.addEventListener('click', () => {
    state.viewMode = button.dataset.view;
    localStorage.setItem('filesea.view', state.viewMode);
    document.querySelectorAll('.view-btn').forEach(item => item.classList.toggle('active', item === button));
    renderFiles();
  }));
  el.search.addEventListener('input', updateSearch);
  el.searchClear.addEventListener('click', () => { el.search.value = ''; updateSearch(); el.search.focus(); });
  el.address.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); finishAddressEditor(true); }
    if (event.key === 'Escape') { event.preventDefault(); finishAddressEditor(false); }
  });
  el.address.addEventListener('blur', () => { if (state.addressEditing) finishAddressEditor(false); });
  el.modalConfirm.addEventListener('click', confirmModal);
  el.modalCancel.addEventListener('click', closeModal);
  el.modalInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') confirmModal();
    if (event.key === 'Escape') closeModal();
  });
  el.propsClose.addEventListener('click', () => { el.propsOverlay.hidden = true; });
  el.propsOverlay.addEventListener('click', event => { if (event.target === el.propsOverlay) el.propsOverlay.hidden = true; });
  el.previewClose.addEventListener('click', closePreview);
  el.previewOverlay.addEventListener('click', event => { if (event.target === el.previewOverlay) closePreview(); });
  el.ctxMenu.addEventListener('click', async event => {
    const item = event.target.closest('.ctx-item');
    if (!item || item.classList.contains('disabled')) return;
    const target = state.ctxTarget;
    const targets = getContextTargets(target);
    closeContextMenu();
    const actionTarget = ['paste', 'new-folder', 'open-terminal'].includes(item.dataset.action)
      ? target : (target || targets[0] || null);
    await runContextAction(item.dataset.action, actionTarget, targets);
  });
  document.addEventListener('click', event => {
    if (!el.ctxMenu.contains(event.target)) closeContextMenu();
    if ($('mainPanel').contains(event.target) && !event.target.closest('.file-item')) {
      activeTab()?.selected.clear(); refreshSelection(); updateStatus();
    }
  });
  $('mainPanel').addEventListener('contextmenu', event => {
    if (!event.target.closest('.file-item')) {
      event.preventDefault(); openContextMenu(event, null);
    }
  });
  el.container.addEventListener('dragover', event => {
    if (event.dataTransfer?.types?.includes('application/x-filesea-paths')) event.preventDefault();
  });
  el.container.addEventListener('drop', event => {
    if (event.target === el.container || event.target === $('mainPanel')) {
      event.preventDefault(); dropInternal(event, currentPath());
    }
  });
  el.favorites.addEventListener('dragover', event => {
    if (event.dataTransfer?.types?.includes('application/x-filesea-paths')) event.preventDefault();
  });
  el.favorites.addEventListener('drop', async event => {
    event.preventDefault();
    let paths = [];
    try { paths = JSON.parse(event.dataTransfer.getData('application/x-filesea-paths') || '[]'); } catch (_) { return; }
    let added = 0;
    for (const path of paths) {
      try {
        const entry = await invoke('get_entry_info', { path });
        if (entry.is_dir && !isFavorite(path)) { state.favorites.push(path); added++; }
      } catch (_) { /* Se ignoran los elementos que ya no existen. */ }
    }
    if (added) {
      try { await invoke('set_favorites', { paths: state.favorites }); renderFavorites(); toast('Carpeta(s) añadida(s) a Favoritos'); }
      catch (err) { toast(errorText(err), 4500); }
    }
  });
  document.addEventListener('keydown', async event => {
    const mod = event.metaKey || event.ctrlKey;
    const editing = event.target.matches('input, textarea, [contenteditable="true"]');
    if (event.key === 'Escape') {
      closeContextMenu(); closeModal(); closePreview();
      if (!el.propsOverlay.hidden) el.propsOverlay.hidden = true;
      return;
    }
    if (!editing && event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); goBack(); return; }
    if (!editing && event.altKey && event.key === 'ArrowRight') { event.preventDefault(); goForward(); return; }
    if (!editing && event.altKey && event.key === 'ArrowUp') { event.preventDefault(); goUp(); return; }
    if (mod && event.key.toLowerCase() === 'l') { event.preventDefault(); toggleAddressEditor(); return; }
    if (mod && event.key.toLowerCase() === 't') { event.preventDefault(); createTab(); return; }
    if (mod && event.key.toLowerCase() === 'w' && state.tabs.length > 1) { event.preventDefault(); closeTab(state.activeTabId); return; }
    if (editing) return;
    if (event.key === 'F5') { event.preventDefault(); navigate(currentPath(), { push: false, preserveSearch: true }); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (state.filtered.length) {
        event.preventDefault();
        const lastSelected = [...activeTab().selected].at(-1);
        const current = lastSelected ? state.filtered.findIndex(entry => entry.path === lastSelected) : -1;
        const next = current < 0 ? 0 : Math.max(0, Math.min(state.filtered.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
        const entry = state.filtered[next];
        if (!event.shiftKey) activeTab().selected.clear();
        activeTab().selected.add(entry.path);
        refreshSelection(); updateStatus();
        el.container.focus({ preventScroll: true });
        [...el.container.querySelectorAll('.file-item')].find(item => item.dataset.path === entry.path)?.scrollIntoView({ block: 'nearest' });
      }
    }
    if (mod && event.key === '1') $('viewList').click();
    if (mod && event.key === '2') $('viewGrid').click();
    if (mod && event.key.toLowerCase() === 'h') $('btnHidden').click();
    if (mod && event.key.toLowerCase() === 'c' && activeTab().selected.size) {
      event.preventDefault(); state.clipboard = { paths: [...activeTab().selected], action: 'copy' }; toast('Copiado');
    }
    if (mod && event.key.toLowerCase() === 'x' && activeTab().selected.size) {
      event.preventDefault(); state.clipboard = { paths: [...activeTab().selected], action: 'cut' }; toast('Listo para mover');
    }
    if (mod && event.key.toLowerCase() === 'v' && state.clipboard) { event.preventDefault(); await pasteClipboard(); }
    if ((event.key === 'Delete' || event.key === 'Backspace' && mod) && activeTab().selected.size) {
      event.preventDefault(); await trashEntries(selectedEntries());
    }
    if (event.key === 'F2' && activeTab().selected.size === 1) {
      const entry = selectedEntries()[0]; if (entry) openModal('rename', entry);
    }
    if (event.key === ' ' && activeTab().selected.size === 1) {
      const entry = selectedEntries()[0]; if (entry && isPreviewable(entry)) { event.preventDefault(); await showPreview(entry); }
    }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault(); state.filtered.forEach(entry => activeTab().selected.add(entry.path)); refreshSelection(); updateStatus();
    }
    if (event.key === 'Enter' && activeTab().selected.size === 1) {
      const entry = selectedEntries()[0]; if (entry) handleItemDblClick(entry);
    }
  });
}

async function init() {
  setupEvents();
  try {
    for (let attempt = 0; attempt < 30 && !isTauri(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const home = await invoke('get_home_dir');
    const restored = restoreTabs(home);
    state.tabs = restored.tabs;
    state.activeTabId = restored.activeTabId;
    if (!state.tabs.length) { const tab = makeTab(home, 'Inicio'); state.tabs = [tab]; state.activeTabId = tab.id; }
    document.querySelectorAll('.view-btn').forEach(button => button.classList.toggle('active', button.dataset.view === state.viewMode));
    await Promise.all([loadPlaces(), loadVolumes(), loadFavorites()]);
    const tab = activeTab();
    const opened = await navigate(tab.path || home, { push: false });
    if (!opened && tab.path !== home) {
      toast('La última ubicación ya no está disponible; abrí tu carpeta personal.');
      await navigate(home, { push: false });
    }
    setupNativeDrop();
  } catch (err) {
    showError(`No se pudo iniciar Filesea: ${errorText(err)}`);
  }
}

init();
