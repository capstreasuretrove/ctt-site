/* ==========================================================================
   Captain's Treasure Trove — site logic
   Reads live data straight from the public Google Sheets (gviz JSON), no
   backend required. Two sheets: Inventory (Pops + Autographs) and Calendar
   (Vending + Send-In shows).
   ========================================================================== */

// ---------------------------------------------------------------- CONFIG --
var INV_SHEET_ID = '1zSd87OlxqrWOzEjPd6TAm4MYn57fhrccdmd4xYwvtXA';
var TAB_POPS     = 'Inventory';
var TAB_AUTOS    = 'Autographs';

var CAL_SHEET_ID = '1mb8i23IzL-6dYh3Qz3roJaz5_0pLtiw7cFGCVLzqyPU';
var TAB_VENDING  = 'Vending';
var TAB_SENDIN   = 'Send-In';

var NEW_DAYS = 30; // items added within this many days get a "New" badge

// ----------------------------------------------------------------- STATE --
var allPops = [], allAutos = [], allVending = [], allSendIn = [];
var _lastPopsFiltered = [], _lastAutosFiltered = [];

// ----------------------------------------------------------------- UTILS --
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function hide(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; }
function showErr(id, msg) { var el = document.getElementById(id); if (el) { el.style.display = 'block'; el.textContent = msg; } }
function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function unique(arr, field) {
  var seen = {}, out = [];
  arr.forEach(function (o) { var v = o[field]; if (v && !seen[v]) { seen[v] = true; out.push(v); } });
  out.sort();
  return out;
}
function populateSelect(id, values) {
  var sel = document.getElementById(id);
  if (!sel) return;
  var first = sel.options[0];
  sel.innerHTML = '';
  sel.appendChild(first);
  values.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
}
function ensureUrl(u) {
  if (!u) return '#';
  if (!/^https?:\/\//i.test(u)) return 'https://' + u;
  return u;
}
function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateRange(start, end) {
  if (!start) return '';
  if (!end || end.getTime() === start.getTime()) return fmtDate(start);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return start.toLocaleDateString('en-US', { month: 'short' }) + ' ' + start.getDate() + '–' + end.getDate() + ', ' + start.getFullYear();
  }
  return fmtDate(start) + ' – ' + fmtDate(end);
}
function isNew(added, today) {
  if (!added) return false;
  var diffDays = (today - added) / 86400000;
  return diffDays >= 0 && diffDays <= NEW_DAYS;
}

// ------------------------------------------------------- GVIZ CELL HELPERS --
function rawCell(r, i) { return (r && r.c && r.c[i]) ? r.c[i] : null; }
function cell(r, i) { var c = rawCell(r, i); return c ? c.v : null; }
function cellFmt(r, i) { var c = rawCell(r, i); if (!c) return null; return (c.f !== undefined && c.f !== null) ? c.f : c.v; }
function cellStr(r, i) { var v = cell(r, i); return (v === null || v === undefined) ? '' : String(v).trim(); }
function cellNum(r, i) { var v = cell(r, i); var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function cellBool(r, i) { var v = cell(r, i); return v === true || (typeof v === 'string' && v.toLowerCase().trim() === 'true'); }
function parseSheetDate(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  if (!s) return null;
  var m = s.match(/^Date\((\d+),(\d+),(\d+)\)/);
  if (m) { var d = new Date(+m[1], +m[2], +m[3]); return isNaN(d.getTime()) ? null : d; }
  var m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) { var d2 = new Date(+m2[1], +m2[2] - 1, +m2[3]); return isNaN(d2.getTime()) ? null : d2; }
  var d3 = new Date(s.replace(/-/g, '/'));
  if (!isNaN(d3.getTime())) return d3;
  return null;
}
function cellDate(r, i) {
  return parseSheetDate(cell(r, i)) || parseSheetDate(cellFmt(r, i));
}
function driveUrl(v) {
  if (!v) return '';
  v = String(v).trim();
  if (!v) return '';
  var id = null;
  var m = v.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) id = m[1];
  if (!id) { var m2 = v.match(/[?&]id=([a-zA-Z0-9_-]{10,})/); if (m2) id = m2[1]; }
  if (!id && /^[a-zA-Z0-9_-]{10,}$/.test(v)) id = v;
  if (id) return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w800';
  return v;
}
function isJunkName(name) {
  if (!name) return true;
  var n = name.toLowerCase();
  if (n.indexOf('e.g.') !== -1) return true;
  if (n === 'event name' || n === 'send-in shows' || n === 'vending shows') return true;
  return false;
}

// -------------------------------------------------------------- GVIZ FETCH --
function fetchTab(sheetId, tab, cb) {
  var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(tab);
  fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (text) {
    var m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
    if (!m) throw new Error('Unexpected response format');
    var json = JSON.parse(m[1]);
    if (json.status === 'error') {
      var msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Sheet error';
      throw new Error(msg);
    }
    var rows = (json.table && json.table.rows) || [];
    cb(null, rows);
  }).catch(function (err) { cb(err); });
}

// ------------------------------------------------------------- DATA LOADERS --
function loadPops(cb) {
  fetchTab(INV_SHEET_ID, TAB_POPS, function (err, rows) {
    if (err) { cb(err); return; }
    allPops = rows.map(function (r) {
      return {
        name: cellStr(r, 0),
        number: cellStr(r, 1),
        line: cellStr(r, 2),
        license: cellStr(r, 3),
        qty: cellNum(r, 4),
        owner: cellStr(r, 5),
        added: cellDate(r, 6),
        ebay: cellBool(r, 7),
        size: cellStr(r, 8),
        chase: cellStr(r, 9),
        pieces: cellNum(r, 10),
        featured: cellBool(r, 11),
        id: cellStr(r, 12)
      };
    }).filter(function (p) { return p.name && p.qty > 0; });
    allPops.forEach(function (p, i) { p._idx = i; });
    cb(null);
  });
}
function loadAutos(cb) {
  fetchTab(INV_SHEET_ID, TAB_AUTOS, function (err, rows) {
    if (err) { cb(err); return; }
    allAutos = rows.map(function (r) {
      var photos = [
        driveUrl(cellStr(r, 9)), driveUrl(cellStr(r, 10)), driveUrl(cellStr(r, 11)),
        driveUrl(cellStr(r, 12)), driveUrl(cellStr(r, 13))
      ].filter(Boolean);
      return {
        number: cellStr(r, 0),
        name: cellStr(r, 1),
        line: cellStr(r, 2),
        license: cellStr(r, 3),
        signedBy: cellStr(r, 4),
        auth: cellStr(r, 5),
        qty: cellNum(r, 6),
        added: cellDate(r, 8),
        photos: photos,
        featured: cellBool(r, 14)
      };
    }).filter(function (a) { return a.name && a.qty > 0; });
    allAutos.forEach(function (a, i) { a._idx = i; });
    cb(null);
  });
}
function loadVending(cb) {
  fetchTab(CAL_SHEET_ID, TAB_VENDING, function (err, rows) {
    if (err) { cb(err); return; }
    allVending = rows.map(function (r) {
      var name = cellStr(r, 0);
      if (isJunkName(name)) return null;
      return {
        name: name,
        start: cellDate(r, 1),
        end: cellDate(r, 2),
        location: cellStr(r, 3),
        notes: cellStr(r, 4),
        link: cellStr(r, 5)
      };
    }).filter(Boolean).filter(function (v) { return v.start; });
    cb(null);
  });
}
function loadSendIn(cb) {
  fetchTab(CAL_SHEET_ID, TAB_SENDIN, function (err, rows) {
    if (err) { cb(err); return; }
    allSendIn = rows.map(function (r) {
      var name = cellStr(r, 0);
      if (isJunkName(name)) return null;
      var attending = cellDate(r, 1);
      var deadline = cellDate(r, 2);
      if (!attending && !deadline) return null;
      return {
        name: name,
        attending: attending,
        deadline: deadline,
        notes: cellStr(r, 3),
        link: cellStr(r, 4)
      };
    }).filter(Boolean);
    cb(null);
  });
}

// Send-in lifecycle: 'open' (before deadline) -> 'closed' (deadline passed,
// show hasn't happened yet) -> 'past' (show has happened, drops off the list)
function sendInState(item, today) {
  if (item.attending && item.attending < today) return 'past';
  if (item.deadline && item.deadline < today) return 'closed';
  return 'open';
}

// ------------------------------------------------------------------ CARDS --
function chaseBadge(c) { return c ? '<span class="badge badge-chase">' + esc(c) + '</span>' : ''; }
function sizeBadge(s) { return s ? '<span class="badge badge-size">' + esc(s) + '</span>' : ''; }
function newBadge(added, today) { return isNew(added, today) ? '<span class="badge badge-new">New</span>' : ''; }
function featBadge(f) { return f ? '<span class="badge badge-featured">★ Featured</span>' : ''; }

function wnCard(item, isAuto) {
  return '<div class="wn-card' + (isAuto ? ' autograph' : '') + '" onclick="openDetail(\'' + (isAuto ? 'auto' : 'pop') + '\',' + item._idx + ')">'
    + '<div class="wn-num">' + (item.number ? '#' + esc(item.number) : '') + (isAuto ? ' · Signed' : '') + '</div>'
    + '<div class="wn-name">' + esc(item.name) + '</div>'
    + '<div class="wn-line">' + esc(item.line || '') + '</div>'
    + '</div>';
}

function renderGrails() {
  var items = [];
  allPops.forEach(function (p) { if (p.featured) items.push({ kind: 'pop', item: p }); });
  allAutos.forEach(function (a) { if (a.featured) items.push({ kind: 'auto', item: a }); });
  var el = document.getElementById('grailsSection');
  if (!items.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  document.getElementById('grailsStrip').innerHTML = items.slice(0, 12).map(function (x) { return wnCard(x.item, x.kind === 'auto'); }).join('');
}
function renderWhatsNew() {
  var today = startOfToday();
  var items = [];
  allPops.forEach(function (p) { if (isNew(p.added, today)) items.push({ kind: 'pop', item: p }); });
  allAutos.forEach(function (a) { if (isNew(a.added, today)) items.push({ kind: 'auto', item: a }); });
  items.sort(function (a, b) { return (b.item.added || 0) - (a.item.added || 0); });
  var el = document.getElementById('whatsNewSection');
  if (!items.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  document.getElementById('whatsNewStrip').innerHTML = items.slice(0, 12).map(function (x) { return wnCard(x.item, x.kind === 'auto'); }).join('');
}

// ------------------------------------------------------------ SHOW ALERT --
function renderShowAlert() {
  var today = startOfToday();
  var candidates = [];
  allVending.forEach(function (v) {
    var ref = v.end || v.start;
    if (ref && ref >= today) candidates.push({ type: 'vending', date: v.start, item: v });
  });
  allSendIn.forEach(function (s) {
    var state = sendInState(s, today);
    if (state !== 'past') {
      // sort by when the show itself happens, not the (possibly already-past) deadline
      var d = s.attending || s.deadline;
      if (d) candidates.push({ type: 'sendin', date: d, item: s, state: state });
    }
  });
  var el = document.getElementById('showAlert');
  if (!candidates.length) { el.style.display = 'none'; return; }
  candidates.sort(function (a, b) { return a.date - b.date; });
  var c = candidates[0];
  var html;
  if (c.type === 'vending') {
    html = '<div class="sa-icon">⚓</div><div class="sa-body"><div class="sa-label">Next Stop</div>'
      + '<div class="sa-title">' + esc(c.item.name) + '</div>'
      + '<div class="sa-meta">' + esc(fmtDateRange(c.item.start, c.item.end)) + (c.item.location ? ' · ' + esc(c.item.location) : '') + '</div></div>';
  } else {
    var label = c.state === 'closed' ? 'Send-Ins Closed' : 'Send-In Opportunity';
    var metaBits = [];
    if (c.item.deadline) metaBits.push('Send in by ' + fmtDate(c.item.deadline));
    if (c.item.attending) metaBits.push('Show: ' + fmtDate(c.item.attending));
    html = '<div class="sa-icon">✏️</div><div class="sa-body"><div class="sa-label">' + label + '</div>'
      + '<div class="sa-title">' + esc(c.item.name) + '</div>'
      + '<div class="sa-meta">' + esc(metaBits.join(' · ')) + '</div></div>';
  }
  el.innerHTML = html;
  el.style.display = 'flex';
}

// -------------------------------------------------------- VENDING / SEND-IN --
function renderShowCards(containerId, items, cardFn, emptyMsg) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) { el.innerHTML = emptyMsg ? '<div class="no-shows-block">' + emptyMsg + '</div>' : ''; return; }
  el.innerHTML = items.map(cardFn).join('');
}
function renderVendingCard(v) {
  return '<div class="show-card"><div><div class="sc-name">' + esc(v.name) + '</div>'
    + '<div class="sc-meta">' + esc(fmtDateRange(v.start, v.end)) + (v.location ? ' · ' + esc(v.location) : '') + (v.notes ? '<br>' + esc(v.notes) : '') + '</div></div>'
    + (v.link ? '<a class="sc-link" href="' + esc(ensureUrl(v.link)) + '" target="_blank" rel="noopener">Details &rarr;</a>' : '')
    + '</div>';
}
function renderVending() {
  var today = startOfToday();
  var upcoming = [], past = [];
  allVending.forEach(function (v) {
    var ref = v.end || v.start;
    if (ref && ref >= today) upcoming.push(v); else past.push(v);
  });
  upcoming.sort(function (a, b) { return a.start - b.start; });
  past.sort(function (a, b) { return b.start - a.start; });
  hide('loadVending');
  renderShowCards('vendingShows', upcoming, renderVendingCard, 'No upcoming vending shows scheduled.');
  renderShowCards('vendingPast', past, renderVendingCard, '');
  document.getElementById('vendingPastToggle').style.display = past.length ? 'flex' : 'none';
}
function renderSendInCard(showBadge) {
  return function (s) {
    var badgeHtml = '';
    if (showBadge) {
      badgeHtml = s._state === 'closed'
        ? '<span class="sc-badge closed">Send-Ins Closed!</span>'
        : '<span class="sc-badge open">Accepting Send-Ins</span>';
    }
    var meta = [];
    if (s.deadline) meta.push('Send in by: ' + fmtDate(s.deadline));
    if (s.attending) meta.push('Show: ' + fmtDate(s.attending));
    return '<div class="show-card"><div><div class="sc-name">' + esc(s.name) + '</div>'
      + '<div class="sc-meta">' + esc(meta.join(' · ')) + (s.notes ? '<br>' + esc(s.notes) : '') + '</div></div>'
      + '<div style="display:flex;align-items:center;gap:8px;">' + badgeHtml + (s.link ? '<a class="sc-link" href="' + esc(ensureUrl(s.link)) + '" target="_blank" rel="noopener">Details &rarr;</a>' : '') + '</div>'
      + '</div>';
  };
}
function renderSendIn() {
  var today = startOfToday();
  var upcoming = [], past = [];
  allSendIn.forEach(function (s) {
    var state = sendInState(s, today);
    if (state === 'past') { past.push(s); }
    else { s._state = state; upcoming.push(s); }
  });
  upcoming.sort(function (a, b) { return (a.attending || a.deadline) - (b.attending || b.deadline); });
  past.sort(function (a, b) { return (b.attending || b.deadline) - (a.attending || a.deadline); });

  hide('loadSendinHome'); hide('loadSendinFull');
  renderShowCards('sendInShows', upcoming, renderSendInCard(true), 'No upcoming send-in opportunities scheduled.');
  renderShowCards('sendInShows2', upcoming, renderSendInCard(true), 'No upcoming send-in opportunities scheduled.');
  renderShowCards('sendInPast', past, renderSendInCard(false), '');
  renderShowCards('sendInPast2', past, renderSendInCard(false), '');
  document.getElementById('sendInPastToggle').style.display = past.length ? 'flex' : 'none';
  document.getElementById('sendInPastToggle2').style.display = past.length ? 'flex' : 'none';
}

// ------------------------------------------------------------------ SORT --
function sortArr(arr, mode) {
  var parts = mode.split('-');
  var field = parts[0], dir = parts[1];
  var copy = arr.slice();
  copy.sort(function (a, b) {
    var av = (a[field] || '').toString().toLowerCase();
    var bv = (b[field] || '').toString().toLowerCase();
    if (av < bv) return dir === 'za' ? 1 : -1;
    if (av > bv) return dir === 'za' ? -1 : 1;
    return 0;
  });
  return copy;
}

// -------------------------------------------------------------- POPS PANE --
function filterPops() {
  var s = document.getElementById('invSearch').value.toLowerCase();
  var line = document.getElementById('invLine').value;
  var license = document.getElementById('invLicense').value;
  var badge = document.getElementById('invBadge').value;
  var newOnly = document.getElementById('invNewOnly').checked;
  var today = startOfToday();
  var f = allPops.filter(function (p) {
    if (s) {
      var hay = (p.name + ' ' + p.number + ' ' + p.line).toLowerCase();
      if (hay.indexOf(s) === -1) return false;
    }
    if (line && p.line !== line) return false;
    if (license && p.license !== license) return false;
    if (badge === 'chase' && !p.chase) return false;
    if (badge === 'size' && !p.size) return false;
    if (newOnly && !isNew(p.added, today)) return false;
    return true;
  });
  f = sortArr(f, document.getElementById('invSort').value);
  _lastPopsFiltered = f;
  document.getElementById('invCount').textContent = f.length + ' item' + (f.length !== 1 ? 's' : '') + ' found';
  renderInvGrid(f);
  renderInvList(f);
  document.getElementById('sTotal').textContent = f.length;
  document.getElementById('sUnits').textContent = f.reduce(function (sum, p) { return sum + p.qty; }, 0);
  document.getElementById('sLines').textContent = unique(f, 'line').length;
  updateFilterChips();
}
function renderInvGrid(pops) {
  var g = document.getElementById('invGrid');
  var today = startOfToday();
  if (!pops.length) { g.innerHTML = '<div class="empty">No treasure matches your search. Try adjusting yer filters!</div>'; return; }
  g.innerHTML = pops.map(function (p, i) {
    return '<div class="pcard" style="animation-delay:' + Math.min(i * 0.03, 0.35) + 's" onclick="openDetail(\'pop\',' + p._idx + ')">'
      + '<div class="pcard-hd"><span class="pcard-num">' + (p.number ? '#' + esc(p.number) : '—') + '</span></div>'
      + '<div class="pname">' + esc(p.name) + chaseBadge(p.chase) + sizeBadge(p.size) + newBadge(p.added, today) + featBadge(p.featured) + '</div>'
      + '<div class="pline">' + esc(p.line || '') + (p.line && p.license ? ' — ' : '') + (p.license ? esc(p.license) : (p.line ? '' : 'Uncategorized')) + '</div>'
      + '<div class="pfoot"><span class="avail"><span class="dot dot-g"></span>Available</span><span class="qty">Qty: ' + p.qty + '</span></div>'
      + '</div>';
  }).join('');
}
function renderInvList(pops) {
  var b = document.getElementById('invListBody'), e = document.getElementById('invListEmpty');
  if (!pops.length) { b.innerHTML = ''; e.style.display = 'block'; return; }
  e.style.display = 'none';
  var today = startOfToday();
  b.innerHTML = pops.map(function (p) {
    return '<tr onclick="openDetail(\'pop\',' + p._idx + ')">'
      + '<td>' + (p.number ? '#' + esc(p.number) : '—') + '</td>'
      + '<td><b>' + esc(p.name) + '</b>' + chaseBadge(p.chase) + newBadge(p.added, today) + '</td>'
      + '<td>' + esc(p.line || '—') + '</td>'
      + '<td>' + esc(p.license || '—') + '</td>'
      + '<td>' + p.qty + '</td>'
      + '</tr>';
  }).join('');
}

// --------------------------------------------------------- AUTOGRAPHS PANE --
function filterAutos() {
  var s = document.getElementById('autoSearch').value.toLowerCase();
  var line = document.getElementById('autoLine').value;
  var license = document.getElementById('autoLicense').value;
  var f = allAutos.filter(function (a) {
    if (s) {
      var hay = (a.name + ' ' + a.number + ' ' + a.line + ' ' + a.signedBy).toLowerCase();
      if (hay.indexOf(s) === -1) return false;
    }
    if (line && a.line !== line) return false;
    if (license && a.license !== license) return false;
    return true;
  });
  f = sortArr(f, document.getElementById('autoSort').value);
  _lastAutosFiltered = f;
  document.getElementById('autoRcount').textContent = f.length + ' item' + (f.length !== 1 ? 's' : '') + ' found';
  renderAutoGrid(f);
  renderAutoList(f);
  document.getElementById('aTotal').textContent = f.length;
  document.getElementById('aAvail').textContent = f.reduce(function (sum, a) { return sum + (a.qty > 0 ? 1 : 0); }, 0);
  document.getElementById('aSigners').textContent = unique(f, 'signedBy').length;
}
function renderAutoGrid(autos) {
  var g = document.getElementById('autoGrid');
  var today = startOfToday();
  if (!autos.length) { g.innerHTML = '<div class="empty">No autographs match.</div>'; return; }
  g.innerHTML = autos.map(function (a, i) {
    var photo = a.photos && a.photos[0];
    return '<div class="acard" style="animation-delay:' + Math.min(i * 0.03, 0.35) + 's" onclick="openDetail(\'auto\',' + a._idx + ')">'
      + '<div class="acard-photo">' + (photo ? '<img src="' + esc(photo) + '" alt="' + esc(a.name) + '" loading="lazy">' : '<span class="no-photo">No photo yet</span>') + '</div>'
      + '<div class="acard-hd"><span class="acard-num">' + (a.number ? '#' + esc(a.number) : '—') + '</span></div>'
      + '<div class="aname">' + esc(a.name) + newBadge(a.added, today) + featBadge(a.featured) + '</div>'
      + '<div class="signer">✍ ' + esc(a.signedBy || 'Signer TBD') + '</div>'
      + '<div class="aline">' + esc(a.line || '') + '</div>'
      + '<div class="afoot"><span class="avail"><span class="dot dot-g"></span>Available</span><span class="qty">Qty: ' + a.qty + '</span></div>'
      + '</div>';
  }).join('');
}
function renderAutoList(autos) {
  var b = document.getElementById('autoListBody'), e = document.getElementById('autoListEmpty');
  if (!autos.length) { b.innerHTML = ''; e.style.display = 'block'; return; }
  e.style.display = 'none';
  b.innerHTML = autos.map(function (a) {
    return '<tr onclick="openDetail(\'auto\',' + a._idx + ')">'
      + '<td>' + (a.number ? '#' + esc(a.number) : '—') + '</td>'
      + '<td><b>' + esc(a.name) + '</b></td>'
      + '<td>' + esc(a.line || '—') + '</td>'
      + '<td>' + esc(a.signedBy || '—') + '</td>'
      + '<td>' + a.qty + '</td>'
      + '</tr>';
  }).join('');
}

// ---------------------------------------------------------- FILTER CHIPS --
function updateFilterChips() {
  var chips = [];
  var line = document.getElementById('invLine').value;
  var license = document.getElementById('invLicense').value;
  var badge = document.getElementById('invBadge').value;
  var newOnly = document.getElementById('invNewOnly').checked;
  if (line) chips.push({ label: 'Line: ' + line, clear: function () { document.getElementById('invLine').value = ''; } });
  if (license) chips.push({ label: 'License: ' + license, clear: function () { document.getElementById('invLicense').value = ''; } });
  if (badge) chips.push({ label: badge === 'chase' ? 'Chases Only' : 'Non-Standard Size', clear: function () { document.getElementById('invBadge').value = ''; } });
  if (newOnly) chips.push({ label: 'New arrivals only', clear: function () { document.getElementById('invNewOnly').checked = false; } });
  var wrap = document.getElementById('invFilterChips');
  wrap.innerHTML = '';
  chips.forEach(function (c) {
    var span = document.createElement('span');
    span.className = 'filter-chip';
    span.innerHTML = esc(c.label) + ' <button type="button">&times;</button>';
    span.querySelector('button').addEventListener('click', function () { c.clear(); filterPops(); });
    wrap.appendChild(span);
  });
  var countEl = document.getElementById('invFilterCount');
  countEl.textContent = chips.length ? ' (' + chips.length + ')' : '';
  document.getElementById('invFilterBtn').classList.toggle('on', chips.length > 0);
}

// ------------------------------------------------------------ DETAIL MODAL --
function openDetail(kind, idx) {
  var item = kind === 'pop' ? allPops[idx] : allAutos[idx];
  if (!item) return;
  document.getElementById('dNum').textContent = item.number ? '#' + item.number : '';
  document.getElementById('dName').textContent = item.name;

  var badges = kind === 'pop'
    ? chaseBadge(item.chase) + sizeBadge(item.size) + featBadge(item.featured)
    : featBadge(item.featured);
  document.getElementById('dBadges').innerHTML = badges;

  var meta = [];
  meta.push('<div><b>Line:</b> ' + esc(item.line || '—') + '</div>');
  if (item.license) meta.push('<div><b>License:</b> ' + esc(item.license) + '</div>');
  if (kind === 'auto') {
    if (item.signedBy) meta.push('<div><b>Signed by:</b> ' + esc(item.signedBy) + '</div>');
    if (item.auth) meta.push('<div><b>Authentication:</b> ' + esc(item.auth) + '</div>');
  }
  if (kind === 'pop' && item.pieces) meta.push('<div><b>Piece count:</b> ' + item.pieces + '</div>');
  document.getElementById('dMeta').innerHTML = meta.join('');
  document.getElementById('dQty').textContent = 'Qty: ' + item.qty;

  var photosEl = document.getElementById('dPhotos');
  if (kind === 'auto' && item.photos && item.photos.length) {
    photosEl.style.display = 'grid';
    photosEl.innerHTML = item.photos.map(function (url) {
      return '<img src="' + esc(url) + '" alt="' + esc(item.name) + '" onclick="event.stopPropagation();openLightbox(\'' + esc(url).replace(/'/g, "\\'") + '\',\'' + esc(item.name).replace(/'/g, "\\'") + '\')">';
    }).join('');
  } else {
    photosEl.style.display = 'none';
    photosEl.innerHTML = '';
  }
  document.getElementById('detailModal').classList.add('show');
}
function closeDetail() { document.getElementById('detailModal').classList.remove('show'); }
function openLightbox(url, cap) {
  document.getElementById('lboxImg').src = url;
  document.getElementById('lboxCap').textContent = cap || '';
  document.getElementById('lbox').classList.add('show');
}
function closeLightbox() { document.getElementById('lbox').classList.remove('show'); }

// ------------------------------------------------------------ PAGE / NAV --
function switchPage(tab) {
  document.querySelectorAll('.page-tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === tab); });
  document.getElementById('secHome').classList.toggle('on', tab === 'home');
  document.getElementById('secInv').classList.toggle('on', tab === 'inv');
  document.getElementById('secSendins').classList.toggle('on', tab === 'sendins');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function goToSendins() { switchPage('sendins'); }
function switchInvMode(mode) {
  document.getElementById('itPops').classList.toggle('on', mode === 'pops');
  document.getElementById('itAutos').classList.toggle('on', mode === 'autos');
  document.getElementById('paneInv').classList.toggle('on', mode === 'pops');
  document.getElementById('paneAuto').classList.toggle('on', mode === 'autos');
}
function setInvView(prefix, v) {
  document.getElementById(prefix + 'BtnGrid').classList.toggle('on', v === 'grid');
  document.getElementById(prefix + 'BtnList').classList.toggle('on', v === 'list');
  var gridId = prefix === 'inv' ? 'invGrid' : 'autoGrid';
  var listId = prefix === 'inv' ? 'invList' : 'autoList';
  document.getElementById(gridId).classList.toggle('hide', v !== 'grid');
  document.getElementById(listId).classList.toggle('show', v === 'list');
}
function togglePast(kind) {
  var map = {
    vending: ['vendingPast', 'vendingPastToggle'],
    sendIn: ['sendInPast', 'sendInPastToggle'],
    sendIn2: ['sendInPast2', 'sendInPastToggle2']
  };
  var ids = map[kind];
  if (!ids) return;
  document.getElementById(ids[0]).classList.toggle('show');
  document.getElementById(ids[1]).classList.toggle('open');
}

// ------------------------------------------------------------------ INIT --
function bindUI() {
  document.querySelectorAll('.page-tab').forEach(function (btn) {
    btn.addEventListener('click', function () { switchPage(btn.dataset.tab); });
  });

  document.getElementById('itPops').addEventListener('click', function () { switchInvMode('pops'); });
  document.getElementById('itAutos').addEventListener('click', function () { switchInvMode('autos'); });

  document.getElementById('invSearch').addEventListener('input', filterPops);
  document.getElementById('invLine').addEventListener('change', filterPops);
  document.getElementById('invLicense').addEventListener('change', filterPops);
  document.getElementById('invBadge').addEventListener('change', filterPops);
  document.getElementById('invNewOnly').addEventListener('change', filterPops);
  document.getElementById('invSort').addEventListener('change', filterPops);
  document.getElementById('invFilterBtn').addEventListener('click', function () {
    document.getElementById('invFilterPanel').classList.toggle('show');
  });
  document.getElementById('invBtnGrid').addEventListener('click', function () { setInvView('inv', 'grid'); });
  document.getElementById('invBtnList').addEventListener('click', function () { setInvView('inv', 'list'); });

  document.getElementById('autoSearch').addEventListener('input', filterAutos);
  document.getElementById('autoLine').addEventListener('change', filterAutos);
  document.getElementById('autoLicense').addEventListener('change', filterAutos);
  document.getElementById('autoSort').addEventListener('change', filterAutos);
  document.getElementById('autoBtnGrid').addEventListener('click', function () { setInvView('auto', 'grid'); });
  document.getElementById('autoBtnList').addEventListener('click', function () { setInvView('auto', 'list'); });

  document.getElementById('termsToggle').addEventListener('click', function () {
    document.getElementById('termsList').classList.toggle('show');
    this.classList.toggle('open');
  });

  document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', function (e) { if (e.target === this) closeDetail(); });
  document.getElementById('lboxClose').addEventListener('click', closeLightbox);
  document.getElementById('lbox').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (document.getElementById('lbox').classList.contains('show')) closeLightbox();
    else if (document.getElementById('detailModal').classList.contains('show')) closeDetail();
  });

  document.getElementById('scrollTopBtn').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  window.addEventListener('scroll', function () {
    document.getElementById('scrollTopBtn').classList.toggle('show', window.scrollY > 400);
  });

  // expose functions referenced from dynamically-generated inline HTML
  window.openDetail = openDetail;
  window.openLightbox = openLightbox;
  window.togglePast = togglePast;
  window.goToSendins = goToSendins;
}

function loadAll() {
  loadPops(function (err) {
    hide('loadInv');
    if (err) { showErr('errInv', 'Could not load inventory right now. Please check back soon.'); }
    else {
      populateSelect('invLine', unique(allPops, 'line'));
      populateSelect('invLicense', unique(allPops, 'license'));
      filterPops();
    }
    renderGrails();
    renderWhatsNew();
  });
  loadAutos(function (err) {
    hide('loadAuto');
    if (err) { showErr('errAuto', 'Could not load autographs right now. Please check back soon.'); }
    else {
      populateSelect('autoLine', unique(allAutos, 'line'));
      populateSelect('autoLicense', unique(allAutos, 'license'));
      filterAutos();
    }
    renderGrails();
    renderWhatsNew();
  });
  loadVending(function (err) {
    if (!err) { renderVending(); renderShowAlert(); }
    else { hide('loadVending'); }
  });
  loadSendIn(function (err) {
    hide('loadSendinHome'); hide('loadSendinFull');
    if (!err) { renderSendIn(); renderShowAlert(); }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  bindUI();
  loadAll();
});
