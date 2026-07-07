# Kadosh Royal Ecclesia — Netlify + Google Sheets Setup

This version needs **no server and no laptop**. Your dashboard is a single static
page hosted on Netlify, and it talks directly to your Google Sheet through a small
script that lives inside the sheet. Editing the sheet updates the dashboard, and
edits you make in the dashboard (status changes, new members, new first timers,
attendance marks) write straight back into the sheet.

```
kre-netlify/
├── index.html   ← the dashboard you deploy to Netlify
├── Code.gs      ← paste this into your Google Sheet's Apps Script
└── README.md    ← this file
```

## How it fits together
```
   Google Sheet  ──(Apps Script web app: reads + writes)──►  index.html on Netlify
        ▲                                                          │
        └───────────────── edits posted back ─────────────────────┘
```

---

## Step 1 — Put the script inside your sheet (≈3 min, one time)
1. Open your Google Sheet.
2. **Extensions ▸ Apps Script.**
3. Delete any sample code, then paste the entire contents of **`Code.gs`**. Save.
4. **Deploy ▸ New deployment.** Click the gear ▸ choose **Web app**.
   - **Execute as:** Me
   - **Who has access:** **Anyone**
5. **Deploy.** Approve the Google permission prompt (it's your own script editing
   your own sheet).
6. Copy the **Web app URL** it gives you — it ends in `/exec`.

## Step 2 — Point the dashboard at your sheet
1. Open **`index.html`** in any text editor.
2. Near the top of the script you'll see:
   ```js
   const GAS_URL="PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
   Replace the placeholder with the URL you copied. Save.

## Step 3 — Deploy to Netlify
**Easiest (drag-and-drop):**
1. Go to <https://app.netlify.com/drop>.
2. Drag the **`kre-netlify`** folder (the one containing `index.html`) onto the page.
3. Netlify gives you a live URL. Done.

**Or via a Git repo:** push this folder to GitHub and "Add new site ▸ Import from Git"
in Netlify. No build command needed; publish directory is the folder with `index.html`.

That's it — open your Netlify URL and the dashboard loads live from your sheet.

---

## Day-to-day
- **Edit the sheet** (add a Sunday column, fix a name, etc.) → the dashboard shows it
  on next load. No redeploy needed.
- **Edit in the dashboard** (change a status, add a member/worker/first timer, mark
  attendance) → it writes back into the sheet automatically.
- **Marking 2027 / 2028 attendance:** the register already shows all three years, but
  your sheet's Attendance tab only has 2026 date columns today. To have those marks
  saved into the sheet, add the new Sunday date columns to that tab (same header style,
  e.g. `4-Jan-2027`). Until then, 2027–28 marks live only in the open dashboard.

## How the dashboard maps to your sheet tabs

| Dashboard action | Writes to tab | Where |
|---|---|---|
| Change status | **Member Status** | col G (matched by name in col B) |
| Edit member details | **Member Status** | cols B/C/D/G/H; a rename also updates the name in Attendance, Duration, First Timers & Offerings |
| Add member / worker | **Member Status** (new row) + a matching row is also created in **Attendance**, **Duration** & **Offerings** |
| Mark attendance | **Attendance Mark** | the date column (auto-created if missing), row matched/created by name |
| Service Duration edit | **Duration in Ser** | the date column (auto-created), row matched/created by name |
| General headcount | **General Attendance** | row 2 of the date column (auto-created) |
| Service attendee roll | **General Attendance** | rows 3+ of the date column (auto-created) |
| Add / edit first timer | **First Timers Attendance** | name/invited/contacts + a 1 in the date column (auto-created) |

Reads pull from the same tabs: Member Status (B,C,D,G,H), Attendance Mark, Duration in Ser, First Timers Attendance, and General Attendance (row 2 = headcount, rows 3+ = service roll).

**Auto-captured for you:** new Sunday columns (2027–2028 and beyond) and rows for new people are created automatically when you save — you don't need to pre-add them.

**Not used by the dashboard:** Member Status col E *Last Attendance* and col F *Invited By* are computed/derived and left blank in the sheet; the **Offerings** tab is kept in sync (new members get a row) but isn't shown anywhere yet — ask if you'd like an offerings section built.

## Updating the script later
If you change `Code.gs`, publish the change with
**Deploy ▸ Manage deployments ▸ (pencil) Edit ▸ Version: New version ▸ Deploy.**
The URL stays the same.

## Notes & limits
- Writes use a `text/plain` POST so they slip past the cross-origin check the Apps
  Script can't answer — this is the standard, supported pattern.
- The dashboard updates the screen instantly and posts the change in the background.
  If a write fails (e.g., no internet), reload to resync from the sheet.
- Apps Script has generous free quotas; a single church's traffic is far below them.
- "Who has access: Anyone" means anyone with the long, unguessable `/exec` URL can
  read/write through the script. Don't post that URL publicly. For tighter control,
  ask and I'll add a simple shared-secret check to the script.
