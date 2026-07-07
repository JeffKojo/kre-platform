/****************************************************************************
 * Kadosh Royal Ecclesia — Sheet API (Google Apps Script)
 *
 * This script lives INSIDE your Google Sheet and acts as the backend for the
 * dashboard hosted on Netlify. It reads all the tabs and serves them as JSON,
 * and it writes your edits (status changes, new members, new first timers,
 * attendance marks) straight back into the sheet.
 *
 * HOW TO INSTALL  (one time, ~3 minutes):
 *   1. Open your Google Sheet.
 *   2. Extensions ▸ Apps Script.  Delete anything there and paste THIS file.
 *   3. Click Deploy ▸ New deployment ▸ (gear) Web app.
 *        - Description: KRE API
 *        - Execute as:  Me
 *        - Who has access:  Anyone
 *      Deploy, authorise when prompted, and COPY the Web app URL
 *      (it ends with /exec).
 *   4. Paste that URL into the dashboard's index.html (the GAS_URL line near
 *      the top). Re-deploy the site to Netlify. Done.
 *
 * When you change the sheet structure, just edit ▸ Deploy ▸ Manage deployments
 * ▸ Edit ▸ New version, to publish the update.
 ****************************************************************************/

var YEAR = 2026;
var MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

// Confirmed same-person merges: alias -> canonical
var ALIASES = {
  'Michael Mante Osei Bobie': 'Michael Bobie',
  'Linda Nsiah (Bibiwandy)':  'Linda Addo (Bibiwandy)'
};

/* ============================ HTTP ENTRY POINTS ============================ */
function doGet() {
  var data = buildData(readAllTabs());
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var out = { ok: false, error: 'unknown action' };
  try {
    var body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'status':      out = writeStatus(body.name, body.status); break;
      case 'attendance':  out = writeAttendance(body.name, body.date, body.value); break;
      case 'member':      out = writeMember(body); break;
      case 'firsttimer':  out = writeFirstTimer(body); break;
      case 'editMember':     out = editMember(body); break;
      case 'editFirstTimer': out = editFirstTimer(body); break;
      case 'general':     out = writeGeneral(body.date, body.value); break;
      case 'service':     out = writeService(body.date, body.names); break;
      case 'duration':    out = writeDuration(body.name, body.date, body.value); break;
    }
  } catch (err) { out = { ok: false, error: String(err) }; }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================ SHEET ACCESS ============================ */
// Finds a tab whose name contains any of the given substrings (case-insensitive).
function findSheet(subs) {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName().toLowerCase();
    for (var j = 0; j < subs.length; j++) if (n.indexOf(subs[j]) >= 0) return sheets[i];
  }
  return null;
}
var TAB = {
  status:      function(){ return findSheet(['member status']); },
  attendance:  function(){ return findSheet(['attendance mark']); },
  duration:    function(){ return findSheet(['duration']); },
  firsttimers: function(){ return findSheet(['first timer']); },
  offerings:   function(){ return findSheet(['offering']); },
  general:     function(){ return findSheet(['general']); }
};
function valuesOf(sheet) { return sheet ? sheet.getDataRange().getValues() : []; }

function readAllTabs() {
  return {
    status:      valuesOf(TAB.status()),
    attendance:  valuesOf(TAB.attendance()),
    duration:    valuesOf(TAB.duration()),
    firsttimers: valuesOf(TAB.firsttimers()),
    general:     valuesOf(TAB.general())
  };
}

/* ============================ HELPERS ============================ */
function norm(v){ return (v === null || v === undefined || v === '') ? null : String(v).replace(/\s+/g,' ').trim() || null; }
function key(s){ return s ? String(s).toLowerCase().replace(/[^a-z]/g,'') : ''; }
function num(v){ if (v === null || v === undefined || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }

function parseDate(v){
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]')
    return YEAR + '-' + pad(v.getMonth()+1) + '-' + pad(v.getDate());
  var s = String(v).trim().toLowerCase();
  var m = s.match(/(\d{1,2}).*?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (!m) return null;
  return YEAR + '-' + pad(MONTHS[m[2]]) + '-' + pad(parseInt(m[1],10));
}
function pad(n){ return (n < 10 ? '0' : '') + n; }

function dateColumns(rows, startCol){
  var header = rows[0] || [], out = [];
  for (var c = startCol; c < header.length; c++){ var iso = parseDate(header[c]); if (iso) out.push({ col:c, iso:iso }); }
  return out;
}
function allSundays(){
  var out = [], d = new Date(Date.UTC(YEAR,0,4));
  while (d.getUTCFullYear() <= YEAR + 2){ out.push(d.toISOString().slice(0,10)); d.setUTCDate(d.getUTCDate()+7); }
  return out;
}

/* ============================ BUILD CONSOLIDATED DATA ============================ */
function buildData(S){
  var statusRows = S.status || [], master = {}, order = [], r, row, name, c;

  for (r = 1; r < statusRows.length; r++){
    row = statusRows[r] || []; name = norm(row[1]); if (!name) continue;
    master[name] = { name:name, phone:norm(row[2]), location:norm(row[3]), status:norm(row[6]), pastor:norm(row[7]) };
    order.push(name);
  }

  var attRows = S.attendance || [], dcA = dateColumns(attRows, 1), attendance = {};
  for (r = 1; r < attRows.length; r++){
    row = attRows[r] || []; name = norm(row[0]); if (!name) continue;
    var recA = {};
    for (c = 0; c < dcA.length; c++){ var vA = num(row[dcA[c].col]); if (vA === 0 || vA === 1) recA[dcA[c].iso] = vA; }
    attendance[name] = recA;
  }

  var durRows = S.duration || [], dcD = dateColumns(durRows, 2), duration = {};
  for (r = 1; r < durRows.length; r++){
    row = durRows[r] || []; name = norm(row[1]); if (!name) continue;
    var recD = {};
    for (c = 0; c < dcD.length; c++){ var vD = num(row[dcD[c].col]); if (vD !== null && vD > 0) recD[dcD[c].iso] = vD; }
    duration[name] = recD;
  }

  var attKeys = {}; Object.keys(attendance).forEach(function(n){ attKeys[key(n)] = n; });
  var durKeys = {}; Object.keys(duration).forEach(function(n){ durKeys[key(n)] = n; });
  var masterKeys = {}; Object.keys(master).forEach(function(n){ masterKeys[key(n)] = true; });

  var allNames = order.slice();
  Object.keys(attendance).forEach(function(n){ if (!master[n] && !masterKeys[key(n)]) allNames.push(n); });
  function find(map, src, nm){ var k = key(nm); return (k in map) ? src[map[k]] : {}; }

  var members = allNames.map(function(nm){
    var base = master[nm] || { name:nm, phone:null, location:null, status:'Unclassified', pastor:null };
    base.attendance = find(attKeys, attendance, nm);
    base.duration   = find(durKeys, duration, nm);
    return base;
  });

  var ftRows = S.firsttimers || [], dcF = dateColumns(ftRows, 3), firsttimers = [];
  for (r = 1; r < ftRows.length; r++){
    row = ftRows[r] || []; name = norm(row[0]); if (!name) continue;
    var weeks = [];
    for (c = 0; c < dcF.length; c++){ if (num(row[dcF[c].col]) === 1) weeks.push(dcF[c].iso); }
    firsttimers.push({ name:name, invited_by:norm(row[1]), contacts:norm(row[2]), weeks:weeks });
  }

  var genRows = S.general || [], dcG = dateColumns(genRows, 0), general = {}, service = {};
  for (c = 0; c < dcG.length; c++){
    var vG = num((genRows[1] || [])[dcG[c].col]); if (vG !== null) general[dcG[c].iso] = Math.round(vG);
    var names = [];
    for (r = 2; r < genRows.length; r++){ var nm2 = norm((genRows[r] || [])[dcG[c].col]); if (nm2) names.push(nm2); }
    if (names.length) service[dcG[c].iso] = names;
  }

  var data = { members:members, firsttimers:firsttimers, general:general, service:service, sundays:allSundays(), data_dates: dcA.map(function(d){ return d.iso; }) };
  applyMerges(data);
  return data;
}

function applyMerges(data){
  var by = {}; data.members.forEach(function(m){ by[m.name] = m; });
  Object.keys(ALIASES).forEach(function(alias){
    var canon = ALIASES[alias], a = by[alias], c = by[canon];
    if (a && c){
      for (var k in a.attendance) if (!(k in c.attendance)) c.attendance[k] = a.attendance[k];
      for (var k2 in a.duration)  if (!(k2 in c.duration))  c.duration[k2]  = a.duration[k2];
      ['phone','location','status','pastor'].forEach(function(f){ if (!c[f] && a[f]) c[f] = a[f]; });
    } else if (a && !c){ a.name = canon; }
  });
  data.members = data.members.filter(function(m){ return !(m.name in ALIASES); });
  data.firsttimers.forEach(function(f){ if (f.name in ALIASES) f.name = ALIASES[f.name]; });
}

/* ============================ WRITE-BACK ============================ */
function matchName(cell, name){ return key(cell) === key(name); }

function writeStatus(name, status){
  var sh = TAB.status(), rows = valuesOf(sh);
  for (var r = 1; r < rows.length; r++){
    if (matchName(rows[r][1], name)){ sh.getRange(r+1, 7).setValue(status); return { ok:true, name:name, status:status }; }
  }
  return { ok:false, error:'member not found' };
}

function writeAttendance(name, iso, value){
  var sh = TAB.attendance(), col = findOrAddDateCol(sh, iso), rows = valuesOf(sh);
  for (var r = 1; r < rows.length; r++){
    if (matchName(rows[r][0], name)){ sh.getRange(r+1, col+1).setValue(value); return { ok:true }; }
  }
  // member not in the attendance tab yet — append a row (name in col A)
  var width = Math.max(((valuesOf(sh)[0]) || []).length, col + 1, 1), arr = [];
  for (var i = 0; i < width; i++) arr.push('');
  arr[0] = name; arr[col] = value;
  sh.appendRow(arr);
  return { ok:true, appended:true };
}

function writeMember(b){
  var sh = TAB.status(), sn = valuesOf(sh).length;
  sh.appendRow([sn, b.name, b.phone || '', b.location || '', '', '', b.status || '', b.pastor || '']);
  // mirror the new person into the member-keyed tabs so they exist everywhere
  ensureRow(TAB.attendance(), 0, b.name, null);   // name in col A
  ensureRow(TAB.duration(),   1, b.name, sn);     // s/n col A, name col B
  ensureRow(TAB.offerings(),  1, b.name, sn);     // s/n col A, name col B
  return { ok:true, name:b.name };
}
function ensureRow(sh, nameCol, name, sn){
  if (!sh) return;
  var rows = valuesOf(sh);
  for (var r = 1; r < rows.length; r++) if (matchName(rows[r][nameCol], name)) return;
  var width = Math.max(((rows[0]) || []).length, nameCol + 1), arr = [];
  for (var i = 0; i < width; i++) arr.push('');
  if (sn != null && nameCol >= 1) arr[0] = sn;
  arr[nameCol] = name;
  sh.appendRow(arr);
}

function writeFirstTimer(b){
  var sh = TAB.firsttimers(), iso = (b.weeks && b.weeks[0]) || b.date, col = findOrAddDateCol(sh, iso);
  var width = Math.max(((valuesOf(sh)[0]) || []).length, col + 1, 4), arr = [];
  for (var i = 0; i < width; i++) arr.push('');
  arr[0] = b.name; arr[1] = b.invited_by || ''; arr[2] = b.contacts || ''; arr[col] = 1;
  sh.appendRow(arr);
  return { ok:true, name:b.name };
}

/* ---- edits ---- */
var MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatHeader(iso){ var p = iso.split('-'); return parseInt(p[2],10) + '-' + MONTH_ABBR[parseInt(p[1],10)-1] + '-' + p[0]; }

function renameInTab(sheet, nameCol, oldName, newName){
  if (!sheet) return;
  var rows = valuesOf(sheet);
  for (var r = 1; r < rows.length; r++){
    if (matchName(rows[r][nameCol], oldName)){ sheet.getRange(r+1, nameCol+1).setValue(newName); return; }
  }
}

function editMember(b){
  var sh = TAB.status(), rows = valuesOf(sh);
  for (var r = 1; r < rows.length; r++){
    if (matchName(rows[r][1], b.original)){
      var rr = r + 1;
      sh.getRange(rr,2).setValue(b.name);
      sh.getRange(rr,3).setValue(b.phone || '');
      sh.getRange(rr,4).setValue(b.location || '');
      sh.getRange(rr,7).setValue(b.status || '');
      sh.getRange(rr,8).setValue(b.pastor || '');
      if (key(b.name) !== key(b.original)){            // keep the other tabs in sync
        renameInTab(TAB.attendance(), 0, b.original, b.name);
        renameInTab(TAB.duration(),   1, b.original, b.name);
        renameInTab(TAB.firsttimers(),0, b.original, b.name);
        renameInTab(TAB.offerings(),  1, b.original, b.name);
      }
      return { ok:true };
    }
  }
  return { ok:false, error:'member not found' };
}

function editFirstTimer(b){
  var sh = TAB.firsttimers(), rows = valuesOf(sh);
  for (var r = 1; r < rows.length; r++){
    if (matchName(rows[r][0], b.original)){
      var rr = r + 1;
      sh.getRange(rr,1).setValue(b.name);
      sh.getRange(rr,2).setValue(b.invited_by || '');
      sh.getRange(rr,3).setValue(b.contacts || '');
      return { ok:true };
    }
  }
  return { ok:false, error:'first timer not found' };
}

/* ---- general headcount + service roll ---- */
function findOrAddDateCol(sh, iso){
  var header = (valuesOf(sh)[0]) || [];
  for (var c = 0; c < header.length; c++) if (parseDate(header[c]) === iso) return c;
  var col = header.length;
  sh.getRange(1, col + 1).setValue(formatHeader(iso));   // create the column header
  return col;
}

function writeGeneral(iso, value){
  var sh = TAB.general(); var col = findOrAddDateCol(sh, iso);
  sh.getRange(2, col + 1).setValue(value == null ? '' : value);
  return { ok:true };
}

function writeService(iso, names){
  var sh = TAB.general(); var col = findOrAddDateCol(sh, iso);
  var lastRow = sh.getLastRow();
  if (lastRow >= 3) sh.getRange(3, col + 1, lastRow - 2, 1).clearContent();
  if (names && names.length){
    var arr = names.map(function(n){ return [n]; });
    sh.getRange(3, col + 1, names.length, 1).setValues(arr);
  }
  return { ok:true, count: names ? names.length : 0 };
}

function writeDuration(name, iso, value){
  var sh = TAB.duration(); var rows = valuesOf(sh); var col = findOrAddDateCol(sh, iso);
  for (var r = 1; r < rows.length; r++){
    if (matchName(rows[r][1], name)){ sh.getRange(r+1, col+1).setValue(value == null ? '' : value); return { ok:true }; }
  }
  // not present yet — append a new row (S/N, name in col B, value in the date col)
  var width = Math.max(((valuesOf(sh)[0]) || []).length, col + 1, 2), arr = [];
  for (var i = 0; i < width; i++) arr.push('');
  arr[1] = name; if (value != null) arr[col] = value;
  sh.appendRow(arr);
  return { ok:true, appended:true };
}
