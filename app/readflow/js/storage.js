/* ==========================================================================
 * storage.js — localStorage persistence for ReadFlow: debounced autosave,
 * named projects, and JSON import/export.
 *
 * Talks to the app only through the window.RF contract:
 *   RF.getProjectJSON()      -> plain serializable object
 *   RF.loadProjectJSON(obj)  -> replaces state + refreshes the UI
 * and listens for the 'rf:change' CustomEvent on document.
 * ========================================================================== */
'use strict';

const RFStore = (() => {
  const AUTOSAVE_KEY = 'readflow.autosave';
  const INDEX_KEY = 'readflow.projects.index';
  const FILE_PREFIX = 'readflow.project.';

  function safeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function listProjects() {
    const idx = safeGet(INDEX_KEY);
    return Array.isArray(idx) ? idx : [];
  }
  function saveIndex(idx) { return safeSet(INDEX_KEY, idx); }

  function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* Saving under an existing name overwrites it — that's what "Save" means to
   * someone who typed the same name twice. */
  function saveProject(name, data, id) {
    name = (name || '').trim() || 'Untitled';
    const idx = listProjects();
    const existing = idx.find((f) => (id ? f.id === id : f.name === name));
    const meta = {
      id: (existing && existing.id) || id || newId(),
      name,
      updatedAt: Date.now(),
    };
    if (!safeSet(FILE_PREFIX + meta.id, data)) return null;
    const rest = idx.filter((f) => f.id !== meta.id);
    rest.unshift(meta);
    if (!saveIndex(rest)) { safeRemove(FILE_PREFIX + meta.id); return null; }
    return meta;
  }

  function loadProject(id) { return safeGet(FILE_PREFIX + id); }

  function deleteProject(id) {
    safeRemove(FILE_PREFIX + id);
    saveIndex(listProjects().filter((f) => f.id !== id));
  }

  function autosave(data) { return safeSet(AUTOSAVE_KEY, data); }
  function loadAutosave() { return safeGet(AUTOSAVE_KEY); }
  function clearAutosave() { safeRemove(AUTOSAVE_KEY); }

  return {
    listProjects, saveProject, loadProject, deleteProject,
    autosave, loadAutosave, clearAutosave,
  };
})();

window.RFStore = RFStore;

/* ================= wiring ================= */

(function () {
  const AUTOSAVE_MS = 800;

  function $(id) { return document.getElementById(id); }

  let saveTimer = null;
  let quotaWarned = false;
  let suspend = false; // don't autosave the state we're in the middle of loading

  function ready() {
    return !!(window.RF && typeof RF.getProjectJSON === 'function');
  }

  function note(msg) {
    const el = $('project-status');
    if (el) {
      el.textContent = msg || '';
    } else if (msg) {
      console.log('[readflow] ' + msg);
    }
  }

  function doAutosave() {
    if (!ready() || suspend) return;
    let data;
    try { data = RF.getProjectJSON(); } catch (e) { return; }
    if (!RFStore.autosave(data)) {
      if (!quotaWarned) {
        quotaWarned = true;
        note('Browser storage is full — autosave is off. Export your project as JSON to keep it.');
      }
    } else {
      quotaWarned = false;
    }
  }

  document.addEventListener('rf:change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doAutosave, AUTOSAVE_MS);
  });

  /* ---------------- named projects panel ---------------- */

  function currentName() {
    const el = $('project-name');
    return (el && el.value ? el.value : '').trim();
  }

  function renderList() {
    const list = $('project-list');
    if (!list) return;
    const files = RFStore.listProjects();
    list.innerHTML = '';
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-note';
      empty.textContent = 'No saved projects yet.';
      list.appendChild(empty);
      return;
    }
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'project-row';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'project-open';
      open.innerHTML = '<b></b><small></small>';
      open.querySelector('b').textContent = f.name || 'Untitled';
      open.querySelector('small').textContent = new Date(f.updatedAt).toLocaleString();
      open.addEventListener('click', () => {
        const data = RFStore.loadProject(f.id);
        if (!data) { alert('That project could not be read.'); return; }
        applyProject(data, f.name);
        note('Loaded "' + (f.name || 'Untitled') + '".');
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'project-delete';
      del.title = 'Delete';
      del.textContent = '🗑';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete "' + (f.name || 'Untitled') + '"?')) return;
        RFStore.deleteProject(f.id);
        renderList();
      });

      row.append(open, del);
      list.appendChild(row);
    }
  }

  function applyProject(data, name) {
    if (!ready() || typeof RF.loadProjectJSON !== 'function') return;
    suspend = true;
    try {
      RF.loadProjectJSON(data);
    } finally {
      suspend = false;
    }
    const el = $('project-name');
    if (el && name) el.value = name;
    clearTimeout(saveTimer);
    doAutosave();
  }

  function bindSave() {
    const btn = $('project-save');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!ready()) return;
      const name = currentName() || 'Untitled';
      let data;
      try { data = RF.getProjectJSON(); } catch (err) { return; }
      const meta = RFStore.saveProject(name, data);
      if (!meta) {
        alert('Could not save — browser storage is full. Delete a saved project, or export this one as JSON.');
        return;
      }
      renderList();
      note('Saved "' + meta.name + '".');
    });
  }

  function bindExport() {
    const btn = $('project-export-json');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!ready()) return;
      let data;
      try { data = RF.getProjectJSON(); } catch (err) { return; }
      const name = currentName() || 'readflow';
      const payload = { app: 'readflow', name, savedAt: Date.now(), data };
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name.replace(/[^\w\-]+/g, '_') + '.readflow.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }

  function bindImport() {
    const btn = $('project-import-json');
    if (!btn) return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'application/json,.json';
    picker.style.display = 'none';
    document.body.appendChild(picker);

    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      picker.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => alert('Could not read that file.');
      reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); } catch (err) { parsed = null; }
        if (!parsed || typeof parsed !== 'object') {
          alert('That does not look like a ReadFlow project file.');
          return;
        }
        const data = (parsed.data && typeof parsed.data === 'object') ? parsed.data : parsed;
        const name = parsed.name || file.name.replace(/\.readflow\.json$|\.json$/i, '');
        try {
          applyProject(data, name);
        } catch (err) {
          console.error('[readflow] import failed', err);
          alert('That file could not be loaded as a ReadFlow project.');
          return;
        }
        note('Imported "' + name + '".');
      };
      reader.readAsText(file);
    });

    btn.addEventListener('click', (e) => { e.preventDefault(); picker.click(); });
  }

  /* ---------------- boot ---------------- */

  document.addEventListener('DOMContentLoaded', () => {
    bindSave();
    bindExport();
    bindImport();
    renderList();

    if (!ready() || typeof RF.loadProjectJSON !== 'function') return;
    const auto = RFStore.loadAutosave();
    if (auto && typeof auto === 'object') {
      try {
        suspend = true;
        RF.loadProjectJSON(auto);
      } catch (err) {
        console.error('[readflow] could not restore autosave', err);
        RFStore.clearAutosave();
      } finally {
        suspend = false;
      }
    }
  });
})();
