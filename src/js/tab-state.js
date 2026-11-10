const SESSION_KEY = 'filesea.session.v2';

export function makeTab(path = '', title = 'Nueva pestaña') {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    path,
    title,
    history: path ? [path] : [],
    historyIndex: path ? 0 : -1,
    selected: new Set(),
    searchQuery: '',
    recursiveSearch: false,
    searchResults: null,
  };
}

export function restoreTabs(fallbackPath = '') {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
      const tabs = saved.tabs
        .filter(tab => typeof tab.path === 'string')
        .slice(0, 12)
        .map(tab => {
          const history = Array.isArray(tab.history) ? tab.history.filter(path => typeof path === 'string') : [];
          const path = tab.path || fallbackPath;
          if (!history.includes(path)) history.push(path);
          return {
            ...makeTab(path, tab.title || path.split('/').filter(Boolean).pop() || 'Inicio'),
            history,
            historyIndex: Math.max(0, Math.min(Number(tab.historyIndex) || history.length - 1, history.length - 1)),
          };
        });
      if (tabs.length) return { tabs, activeTabId: tabs[Math.min(Number(saved.activeIndex) || 0, tabs.length - 1)].id };
    }
  } catch (_) { /* Una sesión inválida no impide iniciar. */ }
  const tab = makeTab(fallbackPath);
  return { tabs: [tab], activeTabId: tab.id };
}

export function saveTabs(tabs, activeTabId) {
  try {
    const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeTabId));
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      activeIndex,
      tabs: tabs.map(({ path, title, history, historyIndex }) => ({ path, title, history, historyIndex })),
    }));
  } catch (_) { /* El almacenamiento local puede estar deshabilitado. */ }
}
