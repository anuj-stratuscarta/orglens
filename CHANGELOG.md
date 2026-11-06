# Changelog

## 1.2.3

- **Fix for older Salesforce CLIs.** Connecting to an org failed with "org auth show-access-token is not a sf command" on CLI versions that predate that command. OrgLens now falls back to `sf org display` to get the access token. If no token can be obtained, the error suggests updating the CLI.

## 1.2.2

- New **demo video** on the extension page: a 4½-minute captioned walkthrough of every feature.
- Packaging: a local Salesforce CLI cache folder (`.sf/`) is no longer included in the extension.

## 1.2.1

- The OrgLens activity-bar icon now works as a button: it opens OrgLens Home and closes the sidebar, so no panel stays open.

## 1.2.0

- **No more Debug Logs panel.** Logs are no longer listed in the sidebar. Browse, filter, tail and open logs on the **Live Logs** page. The sidebar-only settings `openHomeOnSidebarClick` and `defaultOpenAction` are removed.

## 1.1.2

- **Select Org opens instantly.** The org list is read straight from the Salesforce CLI's local files instead of running `sf org list` (which contacts every org and could take a minute). The list now marks the connected org (✓) and the project default (★), and is searchable by alias, username or URL.

## 1.1.1

- User guide: new **Execute anonymous Apex** section and a step-by-step **Search inside logs** walkthrough, with screenshots of both features.

## 1.1.0

- **Search inside logs** now works in the Live Logs list: type text or a /regex/ and the list narrows to the logs that contain it, with match counts and the matching lines. Click a line to open the log in the Log Viewer with the search applied and that line selected.
- **Execute anonymous** opens a dialog: paste Apex, load a file or reuse a recent snippet, then Run. Shows success, compile errors (with the line highlighted) or runtime exceptions with stack trace, and opens the debug log automatically, even when the code fails.
- Anonymous Apex now runs through the Apex API directly: about 10× faster than before, with method-level timing in the log.

## 1.0.0 — first public release

OrgLens is the new name for the extension previously developed as "SF Log Studio".

**Debug logs**
- Debug Logs sidebar and a full-page **Live Logs** list with search, filters, sorting and multi-select.
- **Live tail**: watches the org for new logs, marks them NEW and notifies or opens them automatically.
- Search inside log bodies (text or regex); bulk delete; save; execute anonymous Apex (`Ctrl+Alt+E`).

**Log analyzer**
- Overview with automatic insights (SOQL/DML in loops, fatal errors, limits, hotspots).
- **Performance** profiler: health grade, time breakdown, critical path, recommendations, per-method stats (avg, median, p95, max) with hot/slow/chatty flags.
- Formatted **Log Viewer**, **Timeline** flame chart, **Call Tree**, Analysis, **Database** (with query plans) and Debug & Errors.

**Trace flags & debug levels**
- Trace any user, Automated Process, integration and guest users, or Apex classes/triggers; extend, change level or remove in bulk; edit debug levels.

**SOQL explorer**
- Object/field browser, autocomplete, history and saved queries, data grid with export.
- Inline editing with batch save and undo, bulk edit, delete, clone, **Show all data** record panel with related lists, new-record form, CSV/Excel **import** (insert/update/upsert/delete), row count and query plan.

**REST explorer**
- Call any Salesforce REST endpoint with headers and a JSON body; pretty collapsible JSON, raw and headers views; history, saved requests, cURL.

**Org setup**
- Setup settings (enabled/disabled, searchable), org limits, installed packages, licenses, your access and the setup audit trail.

**Home**
- Org and tracing status, one-click actions, log insights and an Org pulse (limits, Apex coverage, failed jobs, recent Apex/Flow changes, scheduled jobs).
- Built-in illustrated user guide.
