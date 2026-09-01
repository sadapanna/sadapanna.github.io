// ChartFlow storage.js
// Persistence layer: autosave, named projects (localStorage), and JSON export/import.
// Vanilla JS, no modules, no libraries, no network.

window.ChartFlow = window.ChartFlow || { charts: {} };

(function () {
  'use strict';

  var AUTOSAVE_KEY = 'chartflow:autosave';
  var PROJECTS_KEY = 'chartflow:projects';

  // ---- low-level helpers (all localStorage access guarded) ----

  function readJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readProjectsMap() {
    var map = readJSON(PROJECTS_KEY);
    if (!map || typeof map !== 'object') return {};
    return map;
  }

  function sanitizeFilename(name) {
    var base = (name && String(name).trim()) || 'chart';
    return base.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'chart';
  }

  // ---- autosave ----

  function autosave(state) {
    return writeJSON(AUTOSAVE_KEY, state);
  }

  function loadAutosave() {
    try {
      var raw = window.localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // ---- named projects ----

  function listProjects() {
    try {
      var map = readProjectsMap();
      var list = [];
      for (var id in map) {
        if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
        var p = map[id];
        if (!p) continue;
        list.push({ id: p.id || id, name: p.name, updatedAt: p.updatedAt });
      }
      list.sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
      return list;
    } catch (e) {
      return [];
    }
  }

  function saveProject(name, state) {
    try {
      var map = readProjectsMap();
      var id = null;

      // Saving with an existing name overwrites that project.
      for (var existingId in map) {
        if (!Object.prototype.hasOwnProperty.call(map, existingId)) continue;
        if (map[existingId] && map[existingId].name === name) {
          id = existingId;
          break;
        }
      }

      if (!id) id = 'p_' + Date.now().toString();

      var updatedAt = Date.now();
      map[id] = { id: id, name: name, updatedAt: updatedAt, state: state };

      var ok = writeJSON(PROJECTS_KEY, map);
      if (!ok) return null;
      return id;
    } catch (e) {
      return null;
    }
  }

  function loadProject(id) {
    try {
      var map = readProjectsMap();
      var p = map[id];
      if (!p) return null;
      return p.state || null;
    } catch (e) {
      return null;
    }
  }

  function deleteProject(id) {
    try {
      var map = readProjectsMap();
      if (!Object.prototype.hasOwnProperty.call(map, id)) return false;
      delete map[id];
      return writeJSON(PROJECTS_KEY, map);
    } catch (e) {
      return false;
    }
  }

  // ---- export / import ----

  function exportJSON(state) {
    try {
      var payload = { app: 'chartflow', version: 1, state: state };
      var text = JSON.stringify(payload, null, 2);
      var blob = new Blob([text], { type: 'application/json' });
      var filename = sanitizeFilename(state && state.title) + '.chartflow.json';

      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function importJSON(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('Not a ChartFlow project file'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('Not a ChartFlow project file'));
      };
      reader.onload = function () {
        var parsed;
        try {
          parsed = JSON.parse(reader.result);
        } catch (e) {
          reject(new Error('Not a ChartFlow project file'));
          return;
        }
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !parsed.state ||
          typeof parsed.state !== 'object' ||
          typeof parsed.state.type !== 'string' ||
          typeof parsed.state.version === 'undefined'
        ) {
          reject(new Error('Not a ChartFlow project file'));
          return;
        }
        resolve(parsed.state);
      };
      reader.readAsText(file);
    });
  }

  window.ChartFlow.storage = {
    autosave: autosave,
    loadAutosave: loadAutosave,
    listProjects: listProjects,
    saveProject: saveProject,
    loadProject: loadProject,
    deleteProject: deleteProject,
    exportJSON: exportJSON,
    importJSON: importJSON
  };
})();
