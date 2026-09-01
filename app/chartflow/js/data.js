/* ChartFlow — js/data.js
 * Editable spreadsheet-style data editor + CSV import.
 * Attaches ChartFlow.data. No dependencies, no network.
 *
 * Data shapes (see contract):
 *   rows   -> { labels:[], series:[{name, values:[]}] }
 *   wide   -> { items:[], periods:[], values:[[]] }
 *   single -> { value, label, prefix, suffix, target }
 */
(function () {
  'use strict';

  window.ChartFlow = window.ChartFlow || { charts: {} };
  var ChartFlow = window.ChartFlow;

  // ---------------------------------------------------------------- helpers

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /** Lenient number parse: "$1,234.5", "(45)", "12k", "3.2M", "78%" */
  function parseNum(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : 0;
    if (raw == null) return 0;
    var s = String(raw).trim();
    if (!s) return 0;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[\s,_' ]/g, '');
    var mult = 1;
    var m = s.match(/([kKmMbB])\s*%?$/);
    if (m && /\d/.test(s)) {
      var c = m[1].toLowerCase();
      mult = c === 'k' ? 1e3 : c === 'm' ? 1e6 : 1e9;
      s = s.slice(0, m.index);
    }
    s = s.replace(/[^0-9.\-+eE]/g, '');
    if (s.indexOf('-') > 0) s = s.replace(/-/g, '');
    var v = parseFloat(s);
    if (!isFinite(v)) return 0;
    v = v * mult;
    return neg ? -v : v;
  }

  function isBlankRow(arr) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] != null && String(arr[i]).trim() !== '') return false;
    }
    return true;
  }

  function shapeOf(type) {
    var c = ChartFlow.charts && ChartFlow.charts[type];
    return (c && c.dataShape) || 'rows';
  }

  function deepCopy(o) {
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; }
  }

  // ------------------------------------------------------------ defaults

  function defaultData(shape) {
    if (shape === 'wide') {
      return {
        items: ['Alpha', 'Beta', 'Gamma'],
        periods: ['2023', '2024', '2025'],
        values: [[10, 20, 30], [15, 18, 26], [5, 14, 33]]
      };
    }
    if (shape === 'single') {
      return { value: 12500, label: 'Subscribers', prefix: '', suffix: '', target: 100 };
    }
    return {
      labels: ['Jan', 'Feb', 'Mar', 'Apr'],
      series: [{ name: 'Views', values: [1200, 1800, 1500, 2400] }]
    };
  }

  /** Coerce anything into a valid object of the requested shape. */
  function normalize(data, shape) {
    var d = data || {};
    var i, j;
    if (shape === 'single') {
      return {
        value: parseNum(d.value != null ? d.value : 0),
        label: d.label != null ? String(d.label) : '',
        prefix: d.prefix != null ? String(d.prefix) : '',
        suffix: d.suffix != null ? String(d.suffix) : '',
        target: d.target != null ? parseNum(d.target) : 100
      };
    }
    if (shape === 'wide') {
      var items = Array.isArray(d.items) ? d.items.map(String) : [];
      var periods = Array.isArray(d.periods) ? d.periods.map(String) : [];
      var vals = Array.isArray(d.values) ? d.values : [];
      if (!items.length) return defaultData('wide');
      if (!periods.length) periods = ['1'];
      var out = [];
      for (i = 0; i < items.length; i++) {
        var rowv = Array.isArray(vals[i]) ? vals[i] : [];
        var r = [];
        for (j = 0; j < periods.length; j++) r.push(parseNum(rowv[j]));
        out.push(r);
      }
      return { items: items, periods: periods, values: out };
    }
    // rows
    var labels = Array.isArray(d.labels) ? d.labels.map(String) : [];
    var series = Array.isArray(d.series) ? d.series : [];
    if (!labels.length && !series.length) return defaultData('rows');
    if (!labels.length) {
      var n = 0;
      for (i = 0; i < series.length; i++) {
        if (series[i] && Array.isArray(series[i].values)) n = Math.max(n, series[i].values.length);
      }
      for (i = 0; i < n; i++) labels.push(String(i + 1));
    }
    if (!series.length) series = [{ name: 'Series 1', values: [] }];
    var s2 = [];
    for (i = 0; i < series.length; i++) {
      var sv = (series[i] && Array.isArray(series[i].values)) ? series[i].values : [];
      var v2 = [];
      for (j = 0; j < labels.length; j++) v2.push(parseNum(sv[j]));
      s2.push({ name: (series[i] && series[i].name != null) ? String(series[i].name) : 'Series ' + (i + 1), values: v2 });
    }
    return { labels: labels, series: s2 };
  }

  // ------------------------------------------------------------ validation

  function validate(data, shape) {
    var errors = [];
    var d = data || {};
    if (shape === 'single') {
      if (!isFinite(parseNum(d.value))) errors.push('Value must be a number.');
    } else if (shape === 'wide') {
      if (!d.items || !d.items.length) errors.push('Add at least one item.');
      if (!d.periods || !d.periods.length) errors.push('Add at least one time period.');
    } else {
      if (!d.labels || !d.labels.length) errors.push('Add at least one row.');
      if (!d.series || !d.series.length) errors.push('Add at least one series.');
    }
    return errors.length ? { ok: false, errors: errors } : { ok: true };
  }

  // ------------------------------------------------------------------ CSV

  /** Tiny hand-rolled CSV parser → {headers:[], rows:[[]]} */
  function parseCSV(text) {
    var out = [];
    var row = [];
    var field = '';
    var inQ = false;
    var s = String(text == null ? '' : text);
    var i = 0;
    var pushField = function () { row.push(field); field = ''; };
    var pushRow = function () { pushField(); out.push(row); row = []; };
    while (i < s.length) {
      var ch = s.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === ',') { pushField(); i++; continue; }
      if (ch === '\r') {
        if (s.charAt(i + 1) === '\n') i++;
        pushRow(); i++; continue;
      }
      if (ch === '\n') { pushRow(); i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) pushRow();

    // drop trailing all-blank rows
    while (out.length && isBlankRow(out[out.length - 1])) out.pop();
    if (!out.length) return { headers: [], rows: [] };

    var headers = out.shift().map(function (h) { return String(h).trim(); });
    var rows = out.filter(function (r) { return !isBlankRow(r); });
    // pad ragged rows
    var width = headers.length;
    rows.forEach(function (r) { width = Math.max(width, r.length); });
    while (headers.length < width) headers.push('Column ' + (headers.length + 1));
    rows = rows.map(function (r) {
      var c = r.slice(0, width);
      while (c.length < width) c.push('');
      return c;
    });
    return { headers: headers, rows: rows };
  }

  function fromCSV(text, type) {
    var shape = shapeOf(type);
    var p = parseCSV(text);
    if (!p.rows.length) return normalize(null, shape);
    var i, j;

    if (shape === 'single') {
      var r0 = p.rows[0];
      // If the sheet looks like label,value use that; if it looks like a
      // single header+value column, fall back to header as label.
      var label = String(r0[0] != null ? r0[0] : '').trim();
      var value = r0.length > 1 ? parseNum(r0[1]) : parseNum(r0[0]);
      if (r0.length <= 1) label = p.headers[0] || label;
      return normalize({ value: value, label: label, prefix: '', suffix: '', target: 100 }, 'single');
    }

    if (shape === 'wide') {
      var items = [], values = [];
      for (i = 0; i < p.rows.length; i++) {
        items.push(String(p.rows[i][0]));
        var rv = [];
        for (j = 1; j < p.headers.length; j++) rv.push(parseNum(p.rows[i][j]));
        values.push(rv);
      }
      return normalize({ items: items, periods: p.headers.slice(1), values: values }, 'wide');
    }

    var labels = [], series = [];
    for (i = 0; i < p.rows.length; i++) labels.push(String(p.rows[i][0]));
    for (j = 1; j < p.headers.length; j++) {
      var vv = [];
      for (i = 0; i < p.rows.length; i++) vv.push(parseNum(p.rows[i][j]));
      series.push({ name: p.headers[j] || 'Series ' + j, values: vv });
    }
    if (!series.length) series = [{ name: 'Series 1', values: labels.map(function () { return 0; }) }];
    return normalize({ labels: labels, series: series }, 'rows');
  }

  // --------------------------------------------------------------- module

  var M = {
    _container: null,
    _opts: null,
    _type: null,
    _shape: 'rows',
    _data: null,
    _cache: {}   // shape -> last data used for that shape
  };

  function currentType() {
    var t = null;
    if (M._opts && typeof M._opts.getType === 'function') {
      try { t = M._opts.getType(); } catch (e) { t = null; }
    }
    return t || M._type || 'bar';
  }

  function emit() {
    M._cache[M._shape] = deepCopy(M._data);
    if (M._opts && typeof M._opts.onChange === 'function') {
      try { M._opts.onChange(deepCopy(M._data)); } catch (e) { /* host error */ }
    }
  }

  function sampleFor(type) {
    var c = ChartFlow.charts && ChartFlow.charts[type];
    if (c && Array.isArray(c.sampleDatasets) && c.sampleDatasets.length && c.sampleDatasets[0].data) {
      return deepCopy(c.sampleDatasets[0].data);
    }
    return null;
  }

  /** Sync internal type/shape; preserve data when the shape is unchanged. */
  function syncType(force) {
    var type = currentType();
    var shape = shapeOf(type);
    if (!force && type === M._type && shape === M._shape && M._data) return false;
    var prevShape = M._shape;
    M._type = type;
    if (M._data && shape === prevShape) {
      M._shape = shape;
      M._data = normalize(M._data, shape);
      return true;
    }
    M._shape = shape;
    var next = M._cache[shape] || sampleFor(type) || defaultData(shape);
    M._data = normalize(next, shape);
    M._cache[shape] = deepCopy(M._data);
    return true;
  }

  // ------------------------------------------------------------- DOM build

  function cellInput(value, cls, numeric) {
    var inp = el('input', 'cf-cell' + (cls ? ' ' + cls : ''));
    inp.type = 'text';
    inp.value = value == null ? '' : String(value);
    if (numeric) {
      inp.classList.add('cf-num');
      inp.setAttribute('inputmode', 'decimal');
    }
    inp.setAttribute('autocomplete', 'off');
    inp.spellcheck = false;
    return inp;
  }

  function iconBtn(cls, glyph, title) {
    var b = el('button', 'cf-btn ' + cls, glyph);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  }

  /** Grid keyboard nav across inputs carrying data-r / data-c. */
  function gridKeyHandler(table, onEnterLast) {
    table.addEventListener('keydown', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'INPUT' || t.dataset.r == null) return;
      var dr = 0, dc = 0;
      if (e.key === 'Enter') { dr = e.shiftKey ? -1 : 1; }
      else if (e.key === 'ArrowDown') { dr = 1; }
      else if (e.key === 'ArrowUp') { dr = -1; }
      else return;
      e.preventDefault();
      var r = parseInt(t.dataset.r, 10) + dr;
      var c = t.dataset.c;
      var next = table.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]');
      if (next) { next.focus(); next.select(); }
      else if (dr > 0 && typeof onEnterLast === 'function') onEnterLast(c);
    });
  }

  function focusCell(table, r, c) {
    var n = table.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]');
    if (n) { n.focus(); n.select(); }
  }

  // ---- rows -----------------------------------------------------------

  function buildRows(host) {
    var d = M._data;
    var wrap = el('div', 'cf-table-wrap');
    var table = el('table', 'cf-table');
    var thead = el('thead');
    var htr = el('tr');

    var thLabel = el('th', 'cf-th cf-th-label');
    thLabel.appendChild(el('span', 'cf-th-text', 'Label'));
    htr.appendChild(thLabel);

    d.series.forEach(function (s, si) {
      var th = el('th', 'cf-th');
      var name = cellInput(s.name, 'cf-series-name');
      name.addEventListener('input', function () {
        d.series[si].name = name.value;
        emit();
      });
      th.appendChild(name);
      if (d.series.length > 1) {
        var del = iconBtn('cf-btn-del cf-del-col', '×', 'Remove series');
        del.addEventListener('click', function () {
          d.series.splice(si, 1);
          emit(); rebuild();
        });
        th.appendChild(del);
      }
      htr.appendChild(th);
    });

    var thAdd = el('th', 'cf-th cf-th-actions');
    var addCol = iconBtn('cf-btn-add cf-add-col', '+', 'Add series');
    addCol.addEventListener('click', function () {
      d.series.push({
        name: 'Series ' + (d.series.length + 1),
        values: d.labels.map(function () { return 0; })
      });
      emit(); rebuild();
      focusCell(table, 0, d.series.length - 1);
    });
    thAdd.appendChild(addCol);
    htr.appendChild(thAdd);
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el('tbody');
    d.labels.forEach(function (lab, ri) {
      var tr = el('tr', 'cf-tr');
      var tdL = el('td', 'cf-td cf-td-label');
      var li = cellInput(lab, 'cf-label-cell');
      li.dataset.r = ri; li.dataset.c = 'label';
      li.addEventListener('input', function () { d.labels[ri] = li.value; emit(); });
      tdL.appendChild(li);
      tr.appendChild(tdL);

      d.series.forEach(function (s, si) {
        var td = el('td', 'cf-td');
        var vi = cellInput(s.values[ri], null, true);
        vi.dataset.r = ri; vi.dataset.c = si;
        vi.addEventListener('input', function () { d.series[si].values[ri] = parseNum(vi.value); emit(); });
        vi.addEventListener('blur', function () {
          var n = parseNum(vi.value);
          d.series[si].values[ri] = n;
          vi.value = String(n);
        });
        td.appendChild(vi);
        tr.appendChild(td);
      });

      var tdA = el('td', 'cf-td cf-td-actions');
      if (d.labels.length > 1) {
        var del = iconBtn('cf-btn-del cf-del-row', '×', 'Delete row');
        del.addEventListener('click', function () {
          d.labels.splice(ri, 1);
          d.series.forEach(function (s) { s.values.splice(ri, 1); });
          emit(); rebuild();
        });
        tdA.appendChild(del);
      }
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);

    function addRow(focusCol) {
      d.labels.push('Row ' + (d.labels.length + 1));
      d.series.forEach(function (s) { s.values.push(0); });
      emit(); rebuild();
      focusCell(host.querySelector('.cf-table'), d.labels.length - 1, focusCol != null ? focusCol : 'label');
    }
    gridKeyHandler(table, addRow);

    var bar = el('div', 'cf-actions');
    var bRow = el('button', 'cf-btn cf-btn-ghost cf-add-row', '+ Row');
    bRow.type = 'button';
    bRow.addEventListener('click', function () { addRow('label'); });
    bar.appendChild(bRow);
    var bSer = el('button', 'cf-btn cf-btn-ghost cf-add-series', '+ Series');
    bSer.type = 'button';
    bSer.addEventListener('click', function () { addCol.click(); });
    bar.appendChild(bSer);
    host.appendChild(bar);
  }

  // ---- wide (race) ----------------------------------------------------

  function buildWide(host) {
    var d = M._data;
    var wrap = el('div', 'cf-table-wrap');
    var table = el('table', 'cf-table');
    var thead = el('thead');
    var htr = el('tr');

    var thItem = el('th', 'cf-th cf-th-label');
    thItem.appendChild(el('span', 'cf-th-text', 'Item'));
    htr.appendChild(thItem);

    d.periods.forEach(function (p, pi) {
      var th = el('th', 'cf-th');
      var pn = cellInput(p, 'cf-period-name');
      pn.addEventListener('input', function () { d.periods[pi] = pn.value; emit(); });
      th.appendChild(pn);
      if (d.periods.length > 1) {
        var del = iconBtn('cf-btn-del cf-del-col', '×', 'Remove period');
        del.addEventListener('click', function () {
          d.periods.splice(pi, 1);
          d.values.forEach(function (r) { r.splice(pi, 1); });
          emit(); rebuild();
        });
        th.appendChild(del);
      }
      htr.appendChild(th);
    });

    var thAdd = el('th', 'cf-th cf-th-actions');
    var addCol = iconBtn('cf-btn-add cf-add-col', '+', 'Add time period');
    addCol.addEventListener('click', function () {
      var last = d.periods[d.periods.length - 1];
      var n = parseFloat(last);
      d.periods.push(isFinite(n) && String(n) === String(last).trim() ? String(n + 1) : 'Period ' + (d.periods.length + 1));
      d.values.forEach(function (r) { r.push(0); });
      emit(); rebuild();
      focusCell(host.querySelector('.cf-table'), 0, d.periods.length - 1);
    });
    thAdd.appendChild(addCol);
    htr.appendChild(thAdd);
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el('tbody');
    d.items.forEach(function (item, ri) {
      var tr = el('tr', 'cf-tr');
      var tdL = el('td', 'cf-td cf-td-label');
      var ii = cellInput(item, 'cf-label-cell');
      ii.dataset.r = ri; ii.dataset.c = 'label';
      ii.addEventListener('input', function () { d.items[ri] = ii.value; emit(); });
      tdL.appendChild(ii);
      tr.appendChild(tdL);

      d.periods.forEach(function (p, pi) {
        var td = el('td', 'cf-td');
        var vi = cellInput(d.values[ri][pi], null, true);
        vi.dataset.r = ri; vi.dataset.c = pi;
        vi.addEventListener('input', function () { d.values[ri][pi] = parseNum(vi.value); emit(); });
        vi.addEventListener('blur', function () {
          var n = parseNum(vi.value);
          d.values[ri][pi] = n;
          vi.value = String(n);
        });
        td.appendChild(vi);
        tr.appendChild(td);
      });

      var tdA = el('td', 'cf-td cf-td-actions');
      if (d.items.length > 1) {
        var del = iconBtn('cf-btn-del cf-del-row', '×', 'Delete item');
        del.addEventListener('click', function () {
          d.items.splice(ri, 1);
          d.values.splice(ri, 1);
          emit(); rebuild();
        });
        tdA.appendChild(del);
      }
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);

    function addItem(focusCol) {
      d.items.push('Item ' + (d.items.length + 1));
      d.values.push(d.periods.map(function () { return 0; }));
      emit(); rebuild();
      focusCell(host.querySelector('.cf-table'), d.items.length - 1, focusCol != null ? focusCol : 'label');
    }
    gridKeyHandler(table, addItem);

    var bar = el('div', 'cf-actions');
    var bRow = el('button', 'cf-btn cf-btn-ghost cf-add-row', '+ Item');
    bRow.type = 'button';
    bRow.addEventListener('click', function () { addItem('label'); });
    bar.appendChild(bRow);
    var bCol = el('button', 'cf-btn cf-btn-ghost cf-add-series', '+ Period');
    bCol.type = 'button';
    bCol.addEventListener('click', function () { addCol.click(); });
    bar.appendChild(bCol);
    host.appendChild(bar);
  }

  // ---- single ---------------------------------------------------------

  function buildSingle(host) {
    var d = M._data;
    var form = el('div', 'cf-form');

    function field(labelText, key, numeric, hint) {
      var row = el('label', 'cf-field');
      row.appendChild(el('span', 'cf-field-label', labelText));
      var inp = cellInput(d[key], 'cf-field-input', numeric);
      inp.addEventListener('input', function () {
        d[key] = numeric ? parseNum(inp.value) : inp.value;
        emit();
      });
      if (numeric) {
        inp.addEventListener('blur', function () {
          d[key] = parseNum(inp.value);
          inp.value = String(d[key]);
        });
      }
      row.appendChild(inp);
      if (hint) row.appendChild(el('span', 'cf-field-hint', hint));
      return row;
    }

    form.appendChild(field('Value', 'value', true));
    form.appendChild(field('Label', 'label', false));
    form.appendChild(field('Prefix', 'prefix', false, 'e.g. $'));
    form.appendChild(field('Suffix', 'suffix', false, 'e.g. subs, %'));
    form.appendChild(field('Target %', 'target', true, 'progress ring fill target'));
    host.appendChild(form);
  }

  // ---- CSV import affordance -----------------------------------------

  function buildImport(host) {
    var det = el('details', 'cf-import');
    var sum = el('summary', 'cf-import-summary', 'Import CSV');
    det.appendChild(sum);

    var body = el('div', 'cf-import-body');

    var ta = el('textarea', 'cf-csv-text');
    ta.id = 'cf-csv-text';
    ta.rows = 5;
    ta.placeholder = 'Paste CSV here, e.g.\nMonth,Views,Subs\nJan,1200,40\nFeb,1800,65';
    ta.spellcheck = false;
    body.appendChild(ta);

    var row = el('div', 'cf-import-actions');

    var btn = el('button', 'cf-btn cf-btn-primary', 'Import pasted CSV');
    btn.type = 'button';
    btn.id = 'cf-csv-import';
    body.appendChild(row);
    row.appendChild(btn);

    var fileLabel = el('label', 'cf-btn cf-btn-ghost cf-file-label', 'Upload .csv');
    var file = el('input', 'cf-csv-file');
    file.type = 'file';
    file.id = 'cf-csv-file';
    file.accept = '.csv,text/csv,text/plain';
    fileLabel.appendChild(file);
    row.appendChild(fileLabel);

    var status = el('span', 'cf-import-status');
    status.id = 'cf-csv-status';
    row.appendChild(status);

    function doImport(text) {
      var type = currentType();
      var p = parseCSV(text);
      if (!p.rows.length) {
        status.textContent = 'No rows found in that CSV.';
        status.className = 'cf-import-status cf-error';
        return;
      }
      var next = fromCSV(text, type);
      var v = validate(next, shapeOf(type));
      if (!v.ok) {
        status.textContent = v.errors.join(' ');
        status.className = 'cf-import-status cf-error';
        return;
      }
      M._data = next;
      status.textContent = 'Imported ' + p.rows.length + ' row' + (p.rows.length === 1 ? '' : 's') + '.';
      status.className = 'cf-import-status cf-ok';
      emit();
      rebuild();
    }

    btn.addEventListener('click', function () { doImport(ta.value); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { doImport(String(fr.result || '')); };
      fr.onerror = function () {
        status.textContent = 'Could not read that file.';
        status.className = 'cf-import-status cf-error';
      };
      fr.readAsText(f);
      file.value = '';
    });

    det.appendChild(body);
    host.appendChild(det);
  }

  // --------------------------------------------------------------- render

  function rebuild() {
    var host = M._container;
    if (!host) return;
    // preserve the open state of the CSV panel across rebuilds
    var prev = host.querySelector('.cf-import');
    var wasOpen = prev ? prev.open : false;

    clear(host);
    host.classList.add('cf-data');
    host.setAttribute('data-shape', M._shape);

    var editor = el('div', 'cf-editor');
    if (M._shape === 'single') buildSingle(editor);
    else if (M._shape === 'wide') buildWide(editor);
    else buildRows(editor);
    host.appendChild(editor);

    buildImport(host);
    var det = host.querySelector('.cf-import');
    if (det && wasOpen) det.open = true;

    var v = validate(M._data, M._shape);
    if (!v.ok) {
      var warn = el('div', 'cf-warn', v.errors.join(' '));
      host.appendChild(warn);
    }
  }

  // ------------------------------------------------------------ public API

  ChartFlow.data = {
    parseCSV: parseCSV,
    fromCSV: fromCSV,
    parseNumber: parseNum,
    validate: function (data, type) { return validate(data, shapeOf(type || currentType())); },
    shapeOf: shapeOf,
    defaultData: defaultData,

    mount: function (containerEl, opts) {
      M._container = containerEl;
      M._opts = opts || {};
      syncType(true);
      rebuild();
      return this;
    },

    /** Re-read the current type and redraw. Safe to call any time app.js
     *  changes state.type. Returns the (possibly swapped) data. */
    refresh: function () {
      var changed = syncType(false);
      rebuild();
      if (changed) emit();
      return deepCopy(M._data);
    },

    /** Explicit type switch; preserves data across compatible shapes,
     *  otherwise falls back to the last data used for that shape, then the
     *  chart's first sample, then a built-in default. */
    setType: function (type) {
      M._opts = M._opts || {};
      var prevGet = M._opts.getType;
      M._type = type || M._type;
      var shape = shapeOf(M._type);
      if (M._data && shape === M._shape) {
        M._data = normalize(M._data, shape);
      } else {
        M._shape = shape;
        M._data = normalize(M._cache[shape] || sampleFor(M._type) || defaultData(shape), shape);
      }
      M._shape = shape;
      M._cache[shape] = deepCopy(M._data);
      if (prevGet) M._opts.getType = prevGet;
      rebuild();
      emit();
      return deepCopy(M._data);
    },

    setData: function (data) {
      var shape = shapeOf(currentType());
      M._shape = shape;
      M._type = currentType();
      M._data = normalize(data, shape);
      M._cache[shape] = deepCopy(M._data);
      rebuild();
      return deepCopy(M._data);
    },

    getData: function () {
      if (!M._data) { syncType(true); }
      return deepCopy(M._data);
    },

    loadSample: function (type, idx) {
      type = type || currentType();
      var c = ChartFlow.charts && ChartFlow.charts[type];
      var list = (c && Array.isArray(c.sampleDatasets)) ? c.sampleDatasets : [];
      var i = idx || 0;
      var ds = list[i] || list[0] || null;
      var shape = shapeOf(type);
      M._type = type;
      M._shape = shape;
      M._data = normalize(ds && ds.data ? deepCopy(ds.data) : defaultData(shape), shape);
      M._cache[shape] = deepCopy(M._data);
      rebuild();
      emit();
      // hand back the whole sample so app.js can also apply .title
      return ds ? { name: ds.name, title: ds.title, data: deepCopy(M._data) } : { data: deepCopy(M._data) };
    },

    /** Number of samples registered for a type (0 if none). */
    sampleCount: function (type) {
      var c = ChartFlow.charts && ChartFlow.charts[type || currentType()];
      return (c && Array.isArray(c.sampleDatasets)) ? c.sampleDatasets.length : 0;
    }
  };
})();
