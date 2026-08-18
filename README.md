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

## Pastors on the attendance roll

Pastors previously existed only as assignment labels, so they could not be marked present — which is why their livestream names (“Samuel Atta Tonyemevor”, “Ps Gyan”, “Ps Daniel (WD)”, “Mark Tonyemevor”) kept landing in the guest list and appearing as membership candidates.
On the **Pastors** tab each card now shows whether that pastor is on the attendance roll. **+ Add to attendance roll** creates a member record for them with the new **Pastor** status, links it to the pastor entity (`pastors/{id}.memberId`), and lets you tick which livestream spellings are really them. Those spellings are saved as **aliases**, their Sundays become real attendance records, and the names are removed from the guest lists — so they are marked present like anyone else and never resurface as guests. Nothing is pre-ticked: surnames are shared across the congregation, so the choice is deliberate.

## Setting a guest aside

**Set aside** takes someone out of the membership pipeline without deleting anything — use it for one-time visitors, and for entries that aren't people at all (the Zoom host, “Digital Team KRE”). They stop appearing as candidates and stop prompting you, stay listed under **Set Aside** with a **restore** link, and are labelled *Set aside* in the Guest Streaks sheet. It is available on every Approvals row and directly on each guest chip in This Sunday.

## When a guest is really an existing member

**Already a member…** on any Approvals row opens a picker (likely matches first). Choosing the member saves that spelling as an **alias**, moves the guest Sundays onto their attendance, and clears the name from the guest lists. Because matching also reads aliases, that spelling never appears as a guest or candidate again. Every one of these actions is reversible with **undo**, and none of them delete anything.

## New members: the guest → member pipeline

A guest who attends **3 Sundays in a row and is still coming** becomes a *candidate*. Nothing is automatic — an admin approves them on the **Approvals** tab (the sidebar carries a live count badge, and a prompt also appears on the Dashboard and inside This Sunday).

What approval does, in one atomic write:
1. Creates the member, recording **`joinedAt`** (date joined, editable), `joinedVia: 'guest-promotion'`, `guestVisits`, `firstSeenAsGuest` and `approvedBy`.
2. **Back-fills an attendance record** (present) for every Sunday they attended as a guest — no history is lost.
3. Removes their name from those guest lists, so the same person is never counted twice. **Every headcount stays identical** — they simply move from the guest column onto the roll.
4. Writes an audit row to `guestDecisions` (who approved, when).

The Approvals screen has four sections so nothing is hidden: **Ready to Approve**, **Reached the Streak Earlier** (hit 3 but stopped coming — approve anyway or set aside), **On Watch** (currently attending, building toward 3), and **Set Aside** (kept as guests; restorable).

**Name matching:** guest names are matched against the roll generously (two shared name words, or one name containing the other), because the imported guest lists are pasted livestream rolls where the same person appears as “Michael Mante Osei Bobie” and “Michael Bobie”. ~136 guest names match existing members this way and never appear as candidates. Near-miss spellings that slip past that test (“Cindy Amoak” vs “Cindy Amoako”) are caught at the moment of approval: the form warns which similar member is already on the roll and asks you to confirm they really are a different person. It is a warning rather than a block, so two people who genuinely share a name can still both be added — but a duplicate can no longer be created silently.

## Follow-up rule (KRE standard)

A member **needs follow-up once they have missed 4 consecutive services**. Counted backwards from the most recent service; attending once resets it to zero. Services *before* someone joined never count against them, so a newly approved member is never instantly flagged. This same rule drives the Dashboard “Needs Follow-Up” figure, the Follow-Up tab, the Pastors tab and the reports.

## Reports & downloads

**Download full workbook (.xlsx)** produces one Excel file with 13 sheets — every column, like the original database:

| Sheet | Contents |
|---|---|
| Member Roster | S/N, name, **also known as (aliases)**, phone, email, location, status, pastor, household, **joined on, how they joined, guest visits before joining, approved by**, services present/recorded, rate %, avg + total minutes, first/last attendance, **consecutive services missed, needs follow-up**, follow-ups logged |
| Attendance Register | member × every service (1 present / 0 absent / blank not recorded) |
| Duration in Service | minutes stayed, per member per service |
| Service Summary | headcount vs. members marked present/absent, guests, total minutes |
| Guests & One-Timers | every guest per service |
| First Timers | invited by, contact, first visit, all visit dates, returned, became member |
| Follow-Up Priority | consecutive misses, needs-follow-up flag, phone + email for calling |
| **Guest Streaks & Candidates** | every guest, longest + current streak, still coming, status, matched member, all visit dates, decision + who decided |
| **New Members** | everyone approved from guest, joined date, approver, prior guest visits |
| Follow-Up Log | every call/visit/message with who logged it |
| Households | family groupings and members |
| Giving | date, category, amount, member, note |
| Pastor Summary | **on attendance roll as**, flock size, showing up, needs follow-up, avg rate |

CSV exports the single sheet on screen; Print saves it as PDF. Wide sheets show the first 14 columns on screen — the download always contains all of them.

## Seeing duration and guests for a Sunday

On **This Sunday**, pick the date and you get all three: the **min** box beside each present member (their duration), the **Guests** panel for that service, and a read-only **This Service at a Glance** recap listing every member present with how long they stayed, plus totals. For all Sundays at once use the *Duration in Service* and *Guests & One-Timers* sheets.

## Roles & access

Three roles, enforced by Firestore rules **and** the UI:
- **Admin** — full access, including delete and managing the team.
- **Editor** — add / edit / record attendance & giving, but cannot delete.
- **Viewer** — read-only.

Roles resolve by **email** (with backward compatibility for older uid-keyed records), and the owner (`jeffnathan2@gmail.com`, set in `kre-db.js` + `firestore.rules`) is always admin. On the **Team** tab an admin can **authorise someone by email before their first sign-in**, so nobody lands as a viewer by mistake. “Refresh my access” re-reads your role without signing out.

> **Publish the rules once more:** roles are email-keyed and there is a new `guestDecisions` collection. Re-publish `firestore.rules` (Firestore ▸ Rules ▸ paste ▸ Publish) to enable **Grant access** on the Team tab and the **Set aside / restore** actions on Approvals. Approving a guest as a member already works without it (the audit row is written best-effort).

## Data safety

- Every write is confirmed. If one fails, a red **“Not saved”** banner names the reason (e.g. rules rejected it) instead of the change silently disappearing on refresh.
- If you are signed in and the database can't be reached, the app now **refuses to load demo data** — previously it quietly switched to browser-only storage, which is why entries vanished after a refresh. A yellow banner marks demo mode whenever it is active.
- Headcount and minutes fields save as you type (they were previously read-only due to a controlled-input bug).

## Scheduled backups (recommended, ~2 min in the console)
Firestore ▸ **Backups** ▸ *Create schedule* → daily, retention 7–14 days. (Requires the Blaze plan; inexpensive at this data size.)

## Migration notes (what the cleanup did)

- **98 members**: 86 from *Member Status* + 7 recovered from attendance rows that weren't on the roster.
- Names **trimmed and de-duplicated**; the confirmed aliases (Michael Bobie, Linda Addo) merged.
- All the inconsistent date headers ("10th May 2026", "7-Jun-26", "3rd May", "7-June-36") normalized to ISO dates.
- Attendance (present/absent) and Duration (minutes) — split across two sheets in Excel — merged into one record per member per Sunday.
- General Attendance headcounts kept; the pasted Zoom/stream name rolls preserved as each service's `guestRoll` (kept *out* of the member roster).
- *Offerings* was an empty template in the workbook, so no data was imported — the structure can be added when you want to track it.
