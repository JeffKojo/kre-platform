/* ============================================================================
 * KRE Church Management — Data Layer
 * ----------------------------------------------------------------------------
 * ONE API, TWO BACKENDS:
 *   • LOCAL     — loads data/seed-data.json (the migrated Excel data), keeps it
 *                 in memory, and persists every edit to localStorage under the
 *                 "kre_db_v1" key. Powers the live prototype with real data.
 *   • FIREBASE  — activated automatically when a valid `window.KRE_FIREBASE_CONFIG`
 *                 is present AND the Firestore compat SDK is loaded. Reads/writes
 *                 go straight to your Firestore, with realtime sync across devices.
 *
 * The UI never knows which backend is live — it calls the same async methods.
 * To go live: create a Firebase project, paste its config into firebase-config.js,
 * run import-to-firestore.html once. See firebase-setup.md.
 *
 * FIRESTORE SHAPE (collections):
 *   pastors/{id}        { name }
 *   members/{id}        { name, phone, location, status, pastorId, source }
 *   attendance/{id}     { memberId, date(YYYY-MM-DD), present(bool), minutes(num|null) }
 *                         id = `${memberId}_${date}` (deterministic → no dupes)
 *   services/{date}     { date, headcount(num|null), guestRoll[](string) }
 *   firstTimers/{id}    { name, invitedBy, contacts, visits[], firstVisit, linkedMemberId }
 * ========================================================================== */

const LS_KEY = 'kre_db_v1';
const STATUSES = ['Growing', 'Active', 'Worker', 'Covenant', 'Pastor', 'Inactive', 'Drifting', 'Unclassified'];
// KRE rules of thumb, in one place so the app and the reports always agree.
const GUEST_STREAK_FOR_MEMBERSHIP = 3;   // consecutive Sundays as a guest -> candidate
const MISSES_FOR_FOLLOWUP = 4;           // consecutive services missed -> needs follow-up
// Normalised name key: how we tell "Ama Serwaa " and "ama serwaa" are one person.
function nameKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
// The church owner — always treated as admin (bootstraps the permission system).
// To hand ownership over, change this here AND in firestore.rules.
const OWNER_EMAIL = 'jeffnathan2@gmail.com';

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function attId(memberId, date) { return memberId + '_' + date; }

/* ---------------------------------------------------------------- LOCAL --- */
class LocalBackend {
  constructor() { this.mode = 'local'; this.state = null; this._subs = []; this.role = 'admin'; this.userEmail = 'demo@local'; }

  async init() {
    // Prefer a saved snapshot (the user's working edits); fall back to the seed.
    let saved = null;
    try { const raw = localStorage.getItem(LS_KEY); if (raw) saved = JSON.parse(raw); } catch (e) {}
    if (saved && saved.members) {
      this.state = saved;
    } else {
      const res = await fetch('data/seed-data.json');
      const seed = await res.json();
      this.state = {
        pastors: seed.pastors || [],
        members: seed.members || [],
        attendance: seed.attendance || [],
        services: seed.services || [],
        firstTimers: seed.firstTimers || [],
        households: seed.households || [],
        notes: seed.notes || [],
        giving: seed.giving || [],
        guestDecisions: seed.guestDecisions || [],
      };
      this._persist();
    }
    // ensure new collections exist on older saved snapshots
    ['households','notes','giving','guestDecisions'].forEach(k => { if (!this.state[k]) this.state[k] = []; });
    return this.snapshot();
  }

  _persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); } catch (e) {}
    this._subs.forEach(cb => { try { cb(this.snapshot()); } catch (e) {} });
  }
  onChange(cb) { this._subs.push(cb); return () => { this._subs = this._subs.filter(x => x !== cb); }; }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  /* members */
  async addMember(m) {
    const rec = { id: uid('m'), name: m.name, phone: m.phone || null, email: m.email || null, location: m.location || null,
      status: m.status || 'Growing', pastorId: m.pastorId || null, householdId: m.householdId || null,
      aliases: m.aliases || [],
      source: m.source || 'added', joinedAt: m.joinedAt || new Date().toISOString().slice(0, 10),
      joinedVia: m.joinedVia || 'manual', guestVisits: m.guestVisits || [], firstSeenAsGuest: m.firstSeenAsGuest || null,
      approvedBy: m.approvedBy || null };
    this.state.members.push(rec); this._persist(); return rec;
  }
  async updateMember(id, patch) {
    const m = this.state.members.find(x => x.id === id); if (!m) return null;
    Object.assign(m, patch); this._persist(); return m;
  }
  async deleteMember(id) {
    this.state.members = this.state.members.filter(x => x.id !== id);
    this.state.attendance = this.state.attendance.filter(a => a.memberId !== id);
    this._persist();
  }

  /* pastors */
  async addPastor(name) {
    const rec = { id: uid('p'), name }; this.state.pastors.push(rec); this._persist(); return rec;
  }
  async updatePastor(id, patch) {
    const p = this.state.pastors.find(x => x.id === id); if (!p) return null;
    Object.assign(p, patch); this._persist(); return p;
  }
  async deletePastor(id) {
    this.state.pastors = this.state.pastors.filter(x => x.id !== id);
    this.state.members.forEach(m => { if (m.pastorId === id) m.pastorId = null; });
    this._persist();
  }

  /* attendance (per member per date) */
  async setAttendance(memberId, date, patch) {
    let a = this.state.attendance.find(x => x.memberId === memberId && x.date === date);
    if (!a) { a = { memberId, date, present: false, minutes: null }; this.state.attendance.push(a); }
    if ('present' in patch) a.present = !!patch.present;
    if ('minutes' in patch) a.minutes = (patch.minutes === '' || patch.minutes == null) ? null : Math.max(0, Math.round(+patch.minutes) || 0);
    this._persist(); return a;
  }

  /* services (headcount + guest roll) */
  async setService(date, patch) {
    let s = this.state.services.find(x => x.date === date);
    if (!s) { s = { id: date, date, headcount: null, guestRoll: [] }; this.state.services.push(s); }
    if ('headcount' in patch) s.headcount = (patch.headcount === '' || patch.headcount == null) ? null : Math.max(0, Math.round(+patch.headcount) || 0);
    if ('guestRoll' in patch) s.guestRoll = patch.guestRoll.slice();
    this._persist(); return s;
  }

  /* first timers */
  async addFirstTimer(f) {
    const rec = { id: uid('f'), name: f.name, invitedBy: f.invitedBy || null, contacts: f.contacts || null,
      visits: f.visits && f.visits.length ? f.visits.slice() : (f.firstVisit ? [f.firstVisit] : []),
      firstVisit: f.firstVisit || (f.visits && f.visits[0]) || null, linkedMemberId: f.linkedMemberId || null };
    this.state.firstTimers.push(rec); this._persist(); return rec;
  }
  async updateFirstTimer(id, patch) {
    const f = this.state.firstTimers.find(x => x.id === id); if (!f) return null;
    Object.assign(f, patch);
    if (patch.firstVisit) f.visits = [patch.firstVisit].concat((f.visits || []).filter(d => d !== patch.firstVisit));
    this._persist(); return f;
  }
  async deleteFirstTimer(id) {
    this.state.firstTimers = this.state.firstTimers.filter(x => x.id !== id); this._persist();
  }

  /* households */
  async addHousehold(name) { const rec = { id: uid('h'), name }; this.state.households.push(rec); this._persist(); return rec; }
  async updateHousehold(id, patch) { const h = this.state.households.find(x => x.id === id); if (h) Object.assign(h, patch); this._persist(); return h; }
  async deleteHousehold(id) {
    this.state.households = this.state.households.filter(x => x.id !== id);
    this.state.members.forEach(m => { if (m.householdId === id) m.householdId = null; });
    this._persist();
  }

  /* notes / pastoral follow-up log */
  async addNote(n) {
    const rec = { id: uid('n'), memberId: n.memberId, date: n.date || new Date().toISOString().slice(0,10),
      type: n.type || 'note', text: n.text || '', by: n.by || null, createdAt: Date.now() };
    this.state.notes.push(rec); this._persist(); return rec;
  }
  async deleteNote(id) { this.state.notes = this.state.notes.filter(x => x.id !== id); this._persist(); }

  /* giving / offerings */
  async addGiving(g) {
    const rec = { id: uid('g'), date: g.date, category: g.category || 'Offering', amount: Math.max(0, +g.amount || 0),
      memberId: g.memberId || null, note: g.note || null };
    this.state.giving.push(rec); this._persist(); return rec;
  }
  async deleteGiving(id) { this.state.giving = this.state.giving.filter(x => x.id !== id); this._persist(); }

  /* users (local mode is single-admin; no-ops that keep the API shape) */
  async setUserRole() { return null; }
  async removeUser() { return null; }

  /* ---- guest -> member promotion -------------------------------------- *
   * Moves a guest onto the roll WITHOUT losing anything:
   *   1. creates the member (records joinedAt + the guest visits they came from)
   *   2. back-fills an attendance record for every Sunday they attended as a guest
   *   3. removes that name from those guestRolls, so the same person is not counted
   *      twice (their presence simply moves from the guest column to the roll)
   *   4. writes a decision record, so the approval itself is auditable
   * Every headcount therefore stays exactly the same. */
  async promoteGuestToMember(guestName, visitDates, memberData, by) {
    const member = await this.addMember(Object.assign({}, memberData, {
      name: memberData.name || guestName, source: 'guest-promotion', joinedVia: 'guest-promotion',
      guestVisits: (visitDates || []).slice(), firstSeenAsGuest: (visitDates || [])[0] || null, approvedBy: by || null
    }));
    (visitDates || []).forEach(d => {
      let a = this.state.attendance.find(x => x.memberId === member.id && x.date === d);
      if (!a) this.state.attendance.push({ memberId: member.id, date: d, present: true, minutes: null });
      else a.present = true;
    });
    const key = nameKey(guestName);
    this.state.services.forEach(s => {
      if (!s.guestRoll || !s.guestRoll.length) return;
      const kept = s.guestRoll.filter(g => nameKey(g) !== key);
      if (kept.length !== s.guestRoll.length) s.guestRoll = kept;
    });
    this.state.guestDecisions = this.state.guestDecisions || [];
    this.state.guestDecisions = this.state.guestDecisions.filter(d => d.id !== key);
    this.state.guestDecisions.push({ id: key, name: guestName, decision: 'approved', memberId: member.id,
      visits: (visitDates || []).slice(), decidedAt: new Date().toISOString(), decidedBy: by || null });
    this._persist();
    return member;
  }

  async setGuestDecision(guestName, decision, by) {
    const key = nameKey(guestName);
    this.state.guestDecisions = (this.state.guestDecisions || []).filter(d => d.id !== key);
    if (decision) this.state.guestDecisions.push({ id: key, name: guestName, decision,
      decidedAt: new Date().toISOString(), decidedBy: by || null });
    this._persist();
  }

  /* ---- guest is actually an existing member (a spelling variant) ---------- *
   * Same no-loss mechanics as a promotion, but instead of creating a person we
   * record the spelling as an alias on the member they already are, move their
   * guest Sundays onto their attendance, and take the name out of the guest rolls. */
  async linkGuestToMember(guestName, visitDates, memberId, by) {
    const m = this.state.members.find(x => x.id === memberId); if (!m) return null;
    m.aliases = m.aliases || [];
    if (!m.aliases.some(a => nameKey(a) === nameKey(guestName))) m.aliases.push(guestName);
    (visitDates || []).forEach(d => {
      const a = this.state.attendance.find(x => x.memberId === memberId && x.date === d);
      if (!a) this.state.attendance.push({ memberId, date: d, present: true, minutes: null });
      else a.present = true;
    });
    const key = nameKey(guestName);
    this.state.services.forEach(s => {
      if (!s.guestRoll || !s.guestRoll.length) return;
      const kept = s.guestRoll.filter(g => nameKey(g) !== key);
      if (kept.length !== s.guestRoll.length) s.guestRoll = kept;
    });
    this.state.guestDecisions = (this.state.guestDecisions || []).filter(d => d.id !== key);
    this.state.guestDecisions.push({ id: key, name: guestName, decision: 'linked', memberId,
      visits: (visitDates || []).slice(), decidedAt: new Date().toISOString(), decidedBy: by || null });
    this._persist();
    return m;
  }
}

/* ------------------------------------------------------------- FIREBASE --- */
class FirebaseBackend {
  constructor(fb) { this.mode = 'firebase'; this.fb = fb; this.db = fb.firestore(); this.state = null; this._subs = []; this.role = 'viewer'; this.userEmail = null; }

  async init() {
    const user = this.fb.auth().currentUser;
    this.userEmail = user ? user.email : null;
    this.roleError = null;

    const cols = ['pastors', 'members', 'attendance', 'services', 'firstTimers', 'households', 'notes', 'giving', 'users', 'guestDecisions'];
    const out = {};
    await Promise.all(cols.map(async c => {
      try { const snap = await this.db.collection(c).get(); out[c] = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); }
      catch (e) { if (c === 'users') this.roleError = e.code || String(e); out[c] = []; }
    }));
    this.state = out;

    // Resolve this person's role. Accepts BOTH shapes so nothing breaks:
    //   users/{email}  (current)  or  users/{uid} with an `email` field (older)
    // The owner is always admin, which bootstraps the system. This is what fixes
    // admins being demoted to viewer on sign-in.
    if (user) this.role = this._resolveRole(user, out.users || []);

    cols.forEach(c => {
      this.db.collection(c).onSnapshot(snap => {
        this.state[c] = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        if (c === 'users' && user) this.role = this._resolveRole(user, this.state.users);
        this._subs.forEach(cb => { try { cb(this.snapshot()); } catch (e) {} });
      }, () => {});
    });

    // Self-register a viewer record only when this person is unknown, so an admin
    // can see them in the Team tab and grant access.
    if (user && this.role === 'viewer') {
      const email = (user.email || '').toLowerCase();
      const known = (out.users || []).some(u => (u.email || '').toLowerCase() === email || u.id === email);
      if (email && !known) { try { await this.db.collection('users').doc(email).set({ email, role: 'viewer' }); } catch (e) {} }
    }
    return this.snapshot();
  }

  _resolveRole(user, users) {
    const email = (user.email || '').toLowerCase();
    if (email && email === OWNER_EMAIL.toLowerCase()) return 'admin';
    const hit = (users || []).find(u =>
      u.id === email || (u.email || '').toLowerCase() === email || u.id === user.uid);
    return (hit && hit.role) || 'viewer';
  }
  onChange(cb) { this._subs.push(cb); return () => { this._subs = this._subs.filter(x => x !== cb); }; }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  async addMember(m) {
    const rec = { name: m.name, phone: m.phone || null, email: m.email || null, location: m.location || null,
      status: m.status || 'Growing', pastorId: m.pastorId || null, householdId: m.householdId || null,
      aliases: m.aliases || [],
      source: m.source || 'added', joinedAt: m.joinedAt || new Date().toISOString().slice(0, 10),
      joinedVia: m.joinedVia || 'manual', guestVisits: m.guestVisits || [], firstSeenAsGuest: m.firstSeenAsGuest || null,
      approvedBy: m.approvedBy || null };
    const ref = await this.db.collection('members').add(rec); return Object.assign({ id: ref.id }, rec);
  }
  async updateMember(id, patch) { await this.db.collection('members').doc(id).set(patch, { merge: true }); return Object.assign({ id }, patch); }
  async deleteMember(id) {
    await this.db.collection('members').doc(id).delete();
    const q = await this.db.collection('attendance').where('memberId', '==', id).get();
    const batch = this.db.batch(); q.docs.forEach(d => batch.delete(d.ref)); await batch.commit();
  }
  async addPastor(name) { const ref = await this.db.collection('pastors').add({ name }); return { id: ref.id, name }; }
  async updatePastor(id, patch) { await this.db.collection('pastors').doc(id).set(patch, { merge: true }); return Object.assign({ id }, patch); }
  async deletePastor(id) {
    await this.db.collection('pastors').doc(id).delete();
    const q = await this.db.collection('members').where('pastorId', '==', id).get();
    const batch = this.db.batch(); q.docs.forEach(d => batch.update(d.ref, { pastorId: null })); await batch.commit();
  }

  async setAttendance(memberId, date, patch) {
    const id = attId(memberId, date);
    const clean = { memberId, date };
    if ('present' in patch) clean.present = !!patch.present;
    if ('minutes' in patch) clean.minutes = (patch.minutes === '' || patch.minutes == null) ? null : Math.max(0, Math.round(+patch.minutes) || 0);
    await this.db.collection('attendance').doc(id).set(clean, { merge: true });
    return Object.assign({ id }, clean);
  }
  async setService(date, patch) {
    const clean = { date };
    if ('headcount' in patch) clean.headcount = (patch.headcount === '' || patch.headcount == null) ? null : Math.max(0, Math.round(+patch.headcount) || 0);
    if ('guestRoll' in patch) clean.guestRoll = patch.guestRoll.slice();
    await this.db.collection('services').doc(date).set(clean, { merge: true });
    return Object.assign({ id: date }, clean);
  }
  async addFirstTimer(f) {
    const rec = { name: f.name, invitedBy: f.invitedBy || null, contacts: f.contacts || null,
      visits: f.visits && f.visits.length ? f.visits.slice() : (f.firstVisit ? [f.firstVisit] : []),
      firstVisit: f.firstVisit || (f.visits && f.visits[0]) || null, linkedMemberId: f.linkedMemberId || null };
    const ref = await this.db.collection('firstTimers').add(rec); return Object.assign({ id: ref.id }, rec);
  }
  async updateFirstTimer(id, patch) { await this.db.collection('firstTimers').doc(id).set(patch, { merge: true }); return Object.assign({ id }, patch); }
  async deleteFirstTimer(id) { await this.db.collection('firstTimers').doc(id).delete(); }

  async addHousehold(name) { const ref = await this.db.collection('households').add({ name }); return { id: ref.id, name }; }
  async updateHousehold(id, patch) { await this.db.collection('households').doc(id).set(patch, { merge: true }); return Object.assign({ id }, patch); }
  async deleteHousehold(id) {
    await this.db.collection('households').doc(id).delete();
    const q = await this.db.collection('members').where('householdId', '==', id).get();
    const batch = this.db.batch(); q.docs.forEach(d => batch.update(d.ref, { householdId: null })); await batch.commit();
  }

  async addNote(n) {
    const rec = { memberId: n.memberId, date: n.date || new Date().toISOString().slice(0,10),
      type: n.type || 'note', text: n.text || '', by: n.by || this.userEmail || null, createdAt: Date.now() };
    const ref = await this.db.collection('notes').add(rec); return Object.assign({ id: ref.id }, rec);
  }
  async deleteNote(id) { await this.db.collection('notes').doc(id).delete(); }

  async addGiving(g) {
    const rec = { date: g.date, category: g.category || 'Offering', amount: Math.max(0, +g.amount || 0),
      memberId: g.memberId || null, note: g.note || null };
    const ref = await this.db.collection('giving').add(rec); return Object.assign({ id: ref.id }, rec);
  }
  async deleteGiving(id) { await this.db.collection('giving').doc(id).delete(); }

  async setUserRole(emailOrId, role) {
    const id = (emailOrId || '').toLowerCase();
    await this.db.collection('users').doc(id).set({ email: id, role }, { merge: true });
    return { id, role };
  }
  async removeUser(emailOrId) { await this.db.collection('users').doc((emailOrId || '').toLowerCase()).delete(); }

  /* ---- guest -> member promotion (see LocalBackend for the rationale) ---- *
   * One batched write, so the member, their back-filled attendance, the trimmed
   * guest rolls and the audit record either all land or none do. */
  async promoteGuestToMember(guestName, visitDates, memberData, by) {
    const batch = this.db.batch();
    const memberRef = this.db.collection('members').doc();
    const rec = { name: memberData.name || guestName, phone: memberData.phone || null, email: memberData.email || null,
      location: memberData.location || null, status: memberData.status || 'Growing',
      pastorId: memberData.pastorId || null, householdId: memberData.householdId || null,
      source: 'guest-promotion', joinedAt: memberData.joinedAt || new Date().toISOString().slice(0, 10),
      joinedVia: 'guest-promotion', guestVisits: (visitDates || []).slice(), aliases: memberData.aliases || [],
      firstSeenAsGuest: (visitDates || [])[0] || null, approvedBy: by || null };
    batch.set(memberRef, rec);

    (visitDates || []).forEach(d => {
      batch.set(this.db.collection('attendance').doc(memberRef.id + '_' + d),
        { memberId: memberRef.id, date: d, present: true, minutes: null }, { merge: true });
    });

    const key = nameKey(guestName);
    (this.state.services || []).forEach(s => {
      const roll = s.guestRoll || [];
      if (!roll.length) return;
      const kept = roll.filter(g => nameKey(g) !== key);
      if (kept.length !== roll.length) {
        batch.set(this.db.collection('services').doc(s.id || s.date), { guestRoll: kept }, { merge: true });
      }
    });

    // The member, their back-filled attendance and the trimmed guest rolls must all
    // land together — that is the part that must never half-apply.
    await batch.commit();

    // The audit record is best-effort: once someone is on the roll they are matched
    // to it and no longer show as a candidate, so a missing audit row cannot cause
    // a double promotion. This keeps approvals working before the updated
    // firestore.rules (which add guestDecisions) have been published.
    try {
      await this.db.collection('guestDecisions').doc(key).set({ name: guestName, decision: 'approved',
        memberId: memberRef.id, visits: (visitDates || []).slice(),
        decidedAt: new Date().toISOString(), decidedBy: by || null });
    } catch (e) { console.warn('[KRE] approval recorded, audit row skipped (publish firestore.rules):', e && e.code); }

    return Object.assign({ id: memberRef.id }, rec);
  }

  async setGuestDecision(guestName, decision, by) {
    const key = nameKey(guestName);
    const ref = this.db.collection('guestDecisions').doc(key);
    if (!decision) { await ref.delete(); return; }
    await ref.set({ name: guestName, decision, decidedAt: new Date().toISOString(), decidedBy: by || null });
  }

  /* guest turns out to be an existing member: record the spelling as an alias,
   * move their guest Sundays onto that member, clear the name from guest rolls. */
  async linkGuestToMember(guestName, visitDates, memberId, by) {
    const batch = this.db.batch();
    const key = nameKey(guestName);
    const existing = (this.state.members || []).find(m => m.id === memberId) || {};
    const aliases = (existing.aliases || []).slice();
    if (!aliases.some(a => nameKey(a) === key)) aliases.push(guestName);
    batch.set(this.db.collection('members').doc(memberId), { aliases }, { merge: true });

    (visitDates || []).forEach(d => {
      batch.set(this.db.collection('attendance').doc(memberId + '_' + d),
        { memberId, date: d, present: true, minutes: null }, { merge: true });
    });
    (this.state.services || []).forEach(s => {
      const roll = s.guestRoll || [];
      if (!roll.length) return;
      const kept = roll.filter(g => nameKey(g) !== key);
      if (kept.length !== roll.length) {
        batch.set(this.db.collection('services').doc(s.id || s.date), { guestRoll: kept }, { merge: true });
      }
    });
    await batch.commit();

    try {
      await this.db.collection('guestDecisions').doc(key).set({ name: guestName, decision: 'linked',
        memberId, visits: (visitDates || []).slice(), decidedAt: new Date().toISOString(), decidedBy: by || null });
    } catch (e) { console.warn('[KRE] link saved, audit row skipped (publish firestore.rules):', e && e.code); }
    return { id: memberId, aliases };
  }
}

/* --------------------------------------------------------------- FACTORY -- */
export async function createDB(opts) {
  opts = opts || {};
  const cfg = (typeof window !== 'undefined') && window.KRE_FIREBASE_CONFIG;
  const hasFb = !opts.forceLocal && cfg && cfg.apiKey && cfg.apiKey.indexOf('PASTE') < 0 && typeof window.firebase !== 'undefined' && window.firebase.firestore;
  if (hasFb) {
    try {
      if (!window.firebase.apps || !window.firebase.apps.length) window.firebase.initializeApp(cfg);
      // NOTE: Firestore offline persistence (enablePersistence) was intentionally
      // removed. In a browser-hosted, multi-tab context its IndexedDB lease
      // negotiation can hang the initial reads and freeze startup. Online reads are
      // fast and reliable. Revisit with the newer persistentLocalCache API if a
      // dedicated offline kiosk is ever needed.
      const be = new FirebaseBackend(window.firebase);
      await be.init();
      return be;
    } catch (e) {
      console.warn('[KRE] Firebase init failed:', e);
      // CRITICAL: if the user is signed in, never silently drop to local storage.
      // Doing so sent their edits to the browser instead of Firestore, which is why
      // data "vanished" after a refresh. Fail loudly instead.
      let signedIn = false;
      try { signedIn = !!window.firebase.auth().currentUser; } catch (_) {}
      if (signedIn) { const err = new Error('firestore-unavailable'); err.cause = e; throw err; }
    }
  }
  const be = new LocalBackend();
  await be.init();
  return be;
}

export { STATUSES, GUEST_STREAK_FOR_MEMBERSHIP, MISSES_FOR_FOLLOWUP, nameKey };
