# Kadosh Royal Ecclesia — Church Management Platform

A rebuilt, Firebase-backed membership system that replaces the Netlify + Excel setup.
It runs **live on your cleaned real data right now** (local demo mode) and switches to
**Firebase** the moment you paste your project keys — no code changes.

---

## The files

| File | What it is |
|---|---|
| `KRE Church Management.dc.html` | The application — open this. |
| `kre-db.js` | Data layer. One API, two backends (local ↔ Firebase). |
| `data/seed-data.json` | Your Excel data, cleaned & de-duplicated. Powers demo mode **and** the import. |
| `firebase-config.js` | Paste your Firebase keys here (one file, used everywhere). |
| `import-to-firestore.html` | One-click tool that pushes the seed data into Firestore. |
| `firestore.rules` | Security rules — signed-in staff only. |

---

## Going live on Firebase (≈ 10 minutes, one time)

1. **Create the project** — <https://console.firebase.google.com> → *Add project*.
2. **Create the database** — Build ▸ Firestore Database ▸ *Create database* → **Production mode** → pick a region.
3. **Get your keys** — Project settings (⚙) ▸ *Your apps* ▸ web icon `</>` ▸ register an app ▸ copy the `firebaseConfig` object.
4. **Paste them** into `firebase-config.js`, replacing the `PASTE_...` placeholders. Save.
5. **Add sign-in** — Build ▸ Authentication ▸ *Get started* ▸ enable **Email/Password**, then add a user for each staff member (Users tab ▸ Add user).
6. **Publish the rules** — Firestore ▸ Rules tab ▸ paste the contents of `firestore.rules` ▸ Publish.
7. **Import your data** — open `import-to-firestore.html`, click **Import all data now**. Watch it commit ~1,300 documents.
   - *Tip:* if the rules block the import before you've built a login screen, temporarily set the rules to `allow read, write: if true;`, run the import, then re-publish the secure rules.
8. **Open the dashboard.** It detects the real config and connects to Firestore automatically — the sidebar badge switches from **"Demo · local data"** to **"Live · Firebase"**, and every device now sees the same data in real time.

Until step 4 is done, the app keeps running on local demo data (saved in your browser), so you can explore every screen today.

---

## Firestore data model

Everything is keyed by a **stable ID** — never by name — which is the core fix over the spreadsheet.

```
pastors/{id}        { name }
members/{id}        { name, phone, location, status, pastorId, source }
                      status ∈ Growing · Active · Worker · Covenant · Inactive · Drifting · Unclassified
attendance/{id}     { memberId, date:"YYYY-MM-DD", present:bool, minutes:number|null }
                      id = `${memberId}_${date}`  → re-imports never duplicate
services/{date}     { date, headcount:number|null, guestRoll:[string] }
firstTimers/{id}    { name, invitedBy, contacts, visits:[date], firstVisit, linkedMemberId }
```

---

## How the three attendance problems are solved

**1. Overall headcount vs. 2. marking the roll** — the *This Sunday* screen splits them into
two clearly separate panels. **① Overall Headcount** is one number on the `service` document
(everyone present: members, visitors, online). **② Member Roll** marks *which members* were
present and their minutes, as `attendance` records. They never overwrite each other, and a
reconciliation line ("32 members + 58 guests = 90") lets you set the headcount from the roll
with one tap when you want them to match.

**Non-members / one-timers (the duplicity issue)** — the **③ Guests** panel captures people
who attended but aren't on the roll, stored as a simple `guestRoll` list on the service.
Marking someone present **never silently creates a member** (the old sheet's phantom-row bug);
a genuine new visitor is logged in *First Timers* instead.

**3. Future dates (e.g. 9 May 2027)** — there are no fixed date columns anymore. A service is a
document identified by its date, so any Sunday — past or future — can be opened and marked, and
the record is created on demand. The Register generates every Sunday of 2026 / 2027 / 2028 (and
beyond) automatically; tapping a future cell just works.

---

## Roles & access (new)

Three roles, enforced by Firestore rules **and** the UI:
- **Admin** — full access, including delete and managing the team.
- **Editor** — add / edit / record attendance & giving, but cannot delete.
- **Viewer** — read-only.

The owner (set in `firebase-config`/`kre-db.js`/`firestore.rules` as `jeffnathan2@gmail.com`) is always admin — no manual bootstrap. Add other staff in **Firebase ▸ Authentication ▸ Users**; after their first sign-in they appear on the **Team** tab where an admin sets their role.

> **Important:** the security rules changed to add roles + the new collections (households, notes, giving, users). **Re-publish `firestore.rules`** (Firestore ▸ Rules ▸ paste ▸ Publish) or the new features will show `permission-denied`. The app keeps working on core data even before you do this.

## What's new in this version
- **Email** field on members. **Households** (group families; assign from a member's Edit screen). **Follow-up log** — record calls/visits/notes with a timeline on each member profile. **Giving & Offerings** — record per service by category, with totals and breakdown. **Team** — manage who has access and their role.
- **Offline mode** is on: attendance can be marked with a poor/absent connection and syncs automatically when back online.

## Scheduled backups (recommended, ~2 min in the console)
Firestore ▸ **Backups** ▸ *Create schedule* → daily, retention 7–14 days. (Requires the Blaze plan; backups themselves are inexpensive for this data size.) This protects against accidental deletion.

## Migration notes (what the cleanup did)

- **98 members**: 86 from *Member Status* + 7 recovered from attendance rows that weren't on the roster.
- Names **trimmed and de-duplicated**; the confirmed aliases (Michael Bobie, Linda Addo) merged.
- All the inconsistent date headers ("10th May 2026", "7-Jun-26", "3rd May", "7-June-36") normalized to ISO dates.
- Attendance (present/absent) and Duration (minutes) — split across two sheets in Excel — merged into one record per member per Sunday.
- General Attendance headcounts kept; the pasted Zoom/stream name rolls preserved as each service's `guestRoll` (kept *out* of the member roster).
- *Offerings* was an empty template in the workbook, so no data was imported — the structure can be added when you want to track it.
