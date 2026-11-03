// OrgLens — built-in user guide (with screenshots of the working features)
(() => {
  'use strict';
  const { I, esc } = window.SFLS;
  const TABS = { logs: 'Live Logs', trace: 'Trace Flags', soql: 'SOQL', org: 'Org Setup', rest: 'REST Explorer', home: 'Home' };
  const go = (tab) => `<button class="btn sm" data-go="${tab}">Open ${TABS[tab] || 'Home'} →</button>`;
  const run = (cmd, label) => `<button class="btn sm" data-run="${cmd}">${label}</button>`;
  const k = (s) => s.split('+').map((x) => `<span class="kbd">${x}</span>`).join('+');
  const imgBase = (document.querySelector('meta[name="sfls-guide-images"]') || {}).content || '';
  const shot = (file, caption) =>
    imgBase
      ? `<figure class="g-shot"><img src="${imgBase}/${file}.png" alt="${esc(caption)}" loading="lazy" data-zoom><figcaption>${caption} <span class="muted">· click to enlarge</span></figcaption></figure>`
      : '';
  const h3 = (t) => `<h3 class="g-h3">${t}</h3>`;
  const note = (t) => `<div class="g-note">${t}</div>`;

  const SECTIONS = [
    ['start', 'Getting started', `
      <p>OrgLens retrieves, watches and analyzes Salesforce <b>Apex debug logs</b> inside VS Code. It also has a SOQL data tool, a REST API explorer, trace-flag management and an org setup viewer. It signs in with the orgs you have already authorized in the Salesforce CLI (<code>sf org login web</code>), so there is no separate login.</p>
      <ol class="steps">
        <li><b>Pick an org.</b> In a Salesforce project it connects to the project's default org automatically. Otherwise click the org pill at the top (or <i>Select Org</i> in the sidebar).</li>
        <li><b>Turn on debug logging.</b> Salesforce only writes logs while a <i>trace flag</i> is active. Click <i>Start tracing</i> on Home and choose the <b>Analysis</b> level for full performance detail.</li>
        <li><b>Do something in the org</b> — save a record, run a flow, call an API, or use <i>Execute anonymous</i>.</li>
        <li><b>Open the log.</b> It appears in <i>Live Logs</i> (instantly if live tail is on). Click it to open the analyzer.</li>
      </ol>
      <div class="g-acts">${run('orglens.startTrace', `${I.record} Start tracing`)} ${go('logs')}</div>
      ${h3('What you can do')}
      <div class="g-map">
        <div><b>${I.list} Logs</b><span>Live list, live tail, search inside logs, bulk delete</span></div>
        <div><b>${I.graph} Analyze</b><span>Performance, flame chart, call tree, formatted log, SOQL/DML, limits</span></div>
        <div><b>${I.record} Trace</b><span>Trace any user, Automated Process, guest or Apex class; debug levels</span></div>
        <div><b>${I.db} Data</b><span>Query, edit inline, bulk edit, delete, create, clone, import</span></div>
        <div><b>${I.ext} APIs</b><span>Call any REST endpoint; pretty, collapsible JSON responses</span></div>
        <div><b>${I.gear} Org</b><span>Settings on/off, limits, packages, licenses, access, audit trail</span></div>
      </div>
      ${shot('home', 'The OrgLens Home page: org and tracing status at the top, one-click actions, and quick stats.')}`],

    ['tail-vs-logs', 'Live Tail vs Live Logs', `
      <p>They work together but are different things:</p>
      <div class="cmp">
        <div class="cmp-c"><div class="cmp-h" style="--c:#e26d5a">${I.live}<b>Live Tail</b><span>a background watcher</span></div>
          <ul><li>An <b>on/off switch</b> (the <i>Live / Paused</i> pill, or <i>Go live</i>).</li>
          <li>While on, it <b>checks the org every few seconds</b> (default 4 s, setting <code>orglens.tail.intervalSeconds</code>).</li>
          <li>When a new log appears it marks it <span class="newtag">NEW</span>, shows a badge and — depending on <code>orglens.tail.onNewLog</code> — notifies you or opens it automatically.</li>
          <li>Keeps your trace flag from expiring while it runs (<code>orglens.trace.autoExtend</code>).</li>
          <li>Has no screen of its own.</li></ul></div>
        <div class="cmp-c"><div class="cmp-h" style="--c:#5b8def">${I.list}<b>Live Logs</b><span>a page / list view</span></div>
          <ul><li>The <b>table of debug logs</b> in the org: time, operation, user, duration, size, status.</li>
          <li>Search, filter (status, user, operation, time range, minimum duration, only mine), sort, multi-select, analyze, delete.</li>
          <li><b>With live tail on</b>, new logs flow into it by themselves.</li>
          <li><b>With live tail off</b>, it shows the list as of the last refresh — click ${I.refresh} Refresh to update it.</li></ul></div>
      </div>
      <p class="muted">Rule of thumb: <b>Live Logs is where you look; Live Tail decides whether that list updates by itself.</b> Neither creates logs — only an active trace flag does.</p>`],

    ['home', 'Home', `
      <p>Your dashboard. Hover any tile or pill for a description.</p>
      <ul>
        <li><b>Header pills:</b> the connected org (click to switch), debug-logging status with time left (click to start/extend), and live tail <i>Live / Paused</i> (click to toggle).</li>
        <li><b>Org &amp; tracing cards:</b> username and instance; whether logs are being captured, for how long and at which debug level, with <i>Extend / change</i>, <i>Stop</i> and <i>Manage all trace flags</i>.</li>
        <li><b>Actions:</b> live tail, Live Logs, refresh, start/stop tracing, trace flags, SOQL, REST, org setup, filter, search inside logs, execute anonymous, analyze a local file, delete logs.</li>
        <li><b>At a glance:</b> logs listed, failed, today, average duration, largest log, users.</li>
        <li><b>Log insights:</b> an activity chart (failures in red), top operations, slowest logs, latest logs and recent failures — click any log to analyze it. With no logs yet you get a short how-to instead.</li>
        <li><b>Org pulse:</b> org limits (API requests, storage, async Apex, emails) and Apex code coverage, failed background jobs in the last 24 h, Apex and Flow changes in the last 7 days, and upcoming scheduled jobs. Click a row to open it in Salesforce. It refreshes every 5 minutes, or click ↻.</li>
      </ul>
      ${shot('home-full', 'The full Home page, including log insights and Org pulse (limits, failed jobs, recent Apex/Flow changes, scheduled jobs).')}
      ${go('home')}`],

    ['logs', 'Live Logs', `
      <ul>
        <li><b>Click a row</b> to open the analyzer · <b>${k('Ctrl')}+click</b> for the raw log · <b>Shift+click</b> or the checkbox to select.</li>
        <li>Row icons: analyze, raw log, delete. With several selected: <i>Analyze</i> or <i>Delete</i> them together.</li>
        <li><b>Filters:</b> text search (operation, user, request, Id), status, user, operation, time range, minimum duration. <b>Only mine</b> asks the org for your logs only; the other filters work on the list already loaded (up to <code>orglens.maxLogs</code>, default 150).</li>
        <li>Failed transactions show a red dot and the error message; slow ones (over 5 s) get an amber duration bar. New arrivals are tagged <span class="newtag">NEW</span>.</li>
        <li><b>Search inside logs:</b> type a word, record Id, exception text or <code>/regex/</code> in the <i>Search inside logs</i> box (second row) and press ${k('Enter')}. OrgLens reads the bodies of the logs currently listed and narrows the list to the ones that contain it, each with its match count and the first matching lines highlighted. Click a line to open that log in the Log Viewer with the search applied and the line selected (${k('Ctrl')}+click opens the raw log at that line). <i>Clear</i> restores the full list. The Home tile and the sidebar 🔍 take you straight to this box.</li>
      </ul>
      ${shot('live-logs', 'Live Logs with live tail on: two NEW logs, one failed with its NullPointerException message, durations and sizes.')}
      ${go('logs')}`],

    ['analyzer', 'Log analyzer', `
      <p>Opens when you click a log. The header shows the operation, user, status, duration, size, line count and API version; <b>⧉ Summary</b> copies a Markdown summary for tickets and <b>Open raw log</b> opens the text in an editor with colouring, outline and folding.</p>
      <p>Click anything in any tab to see it in the bottom details panel, then jump to the <i>log viewer</i>, the <i>editor</i>, your <i>Apex source</i>, the <i>timeline</i> or the <i>call tree</i>.</p>
      ${note(`Method-level timing needs the <b>Analysis</b> (or Finest) debug level. With <i>Debug</i> level you only see code units, SOQL/DML and debug output.`)}

      ${h3('Overview')}
      <p>Key numbers (time, SOQL, DML, method calls, callouts, flows, debug lines, exceptions), <b>automatic insights</b> (SOQL or DML in loops, fatal errors, limits near the maximum, hotspots, slow queries, truncated logs), governor limits, the code-unit waterfall, log levels and the most frequent events.</p>
      ${shot('an-overview', 'Overview of a real log: the insight “SOQL executed 12× from the same line — likely inside a loop” points straight at LoopDemo.countFor line 3.')}

      ${h3('Performance')}
      <p>Answers “why is this slow?”.</p>
      <ul>
        <li><b>Transaction health:</b> <i>Good</i>, <i>Fair</i> (CPU ≥ 25 %, wall time ≥ 2 s or warnings) or <i>Needs work</i> (CPU ≥ 60 %, wall time ≥ 8 s or errors).</li>
        <li><b>Where the time went:</b> self time split into Apex, SOQL, DML, callouts, flows, system methods and platform time.</li>
        <li><b>Critical path:</b> the slowest chain of nested calls, from the transaction down to the deepest call.</li>
        <li><b>Recommendations</b> generated from what the log shows.</li>
        <li><b>Method performance:</b> calls, total, self, average, median, p95, max, % of the transaction, SOQL/DML/rows. Flags: <span class="badge err">hot</span> ≥ 15 % self time · <span class="badge warn">slow</span> average ≥ 50 ms · <span class="badge warn">chatty</span> ≥ 1,000 calls · <span class="badge">notable</span> ≥ 5 %.</li>
        <li><b>Slowest individual calls</b> and a <b>code unit</b> breakdown.</li>
      </ul>
      ${shot('an-performance', 'Performance of a CPU-heavy transaction: Crypto.generateDigest flagged hot (61 % self time) and chatty (1,500 calls), with recommendations.')}

      ${h3('Log Viewer')}
      <p>The raw log, formatted: colour-coded event names, indentation by call depth, relative timestamps and source-line badges. Search with optional regex (<b>.*</b>), next/previous with ${k('Enter')} / ${k('Shift')}+${k('Enter')} or ${k('F3')}, <i>Only matching lines</i>, category filters with counts (variables and system methods are hidden by default), and <i>Jump to next</i> error / SOQL-DML / debug / code unit. Click a line for details; double-click opens it in the editor.</p>
      ${shot('an-logviewer', 'Log Viewer searching for SOQL_EXECUTE_BEGIN (1 of 13 matches), indented by call depth with the query plan lines visible.')}

      ${h3('Timeline')}
      <p>A flame chart of the whole transaction with a minimap. Scroll to zoom, drag to pan, double-click a bar to zoom to it, ${k('W')} ${k('S')} ${k('A')} ${k('D')} keys, type toggles and a highlight search. Debug statements and exceptions are marked on the time axis.</p>
      ${shot('an-timeline', 'Timeline: the repeated LoopDemo.countFor → SELECT COUNT() pattern is easy to see as a row of identical bars.')}

      ${h3('Call Tree')}
      <p>Every call with total and self time and the SOQL, DML and rows below it. Filter by name, hide types, set a minimum duration, expand or collapse all. Keyboard: arrows to move, → / ← to expand/collapse, ${k('Enter')} to open the log line.</p>
      ${shot('an-calltree', 'Call Tree with total/self time and per-call SOQL counts.')}

      ${h3('Database')}
      <p>Every SOQL query and DML statement with rows, time, a repeat badge and the calling method and line. <i>Group identical</i> collapses repeats; <b>Plan</b> asks Salesforce whether the query can use an index (cost below 1.0 = selective).</p>
      ${shot('an-database', 'Database tab: the same COUNT() query repeated 12 times from LoopDemo.countFor line 3.')}

      ${h3('Analysis and Debug & Errors')}
      <p><b>Analysis</b> aggregates time by method, class or type. <b>Debug &amp; Errors</b> lists every <code>System.debug</code> line and exception with a level filter and regex search.</p>`],

    ['trace', 'Trace flags & debug levels', `
      <p>A <b>trace flag</b> tells Salesforce to write debug logs for someone for a period of time (max 24 h) at a given <b>debug level</b>.</p>
      ${h3('Add trace flags (right panel)')}
      <ol class="steps">
        <li>Choose who: <i>Users</i>, <i>Automated Process</i> (platform-event triggers, async flows and many background jobs), <i>Integration</i>, <i>Guest / Site</i> users, or <i>Apex classes &amp; triggers</i>. Search by name or username; <i>Me</i> adds yourself.</li>
        <li>Tick as many as you need — they appear as chips you can remove.</li>
        <li>Pick a debug level (the chips under it preview each category) and a duration from 15 minutes to 24 hours.</li>
        <li>Click <b>Start tracing</b>.</li>
      </ol>
      ${h3('Manage trace flags (left)')}
      <p>See every trace flag in the org with who it traces, the log type, the debug level (change it inline), and time left. <i>+1h</i> extends, the bin removes, and you can tick several to extend, change level or remove together. <i>Show expired</i> includes old flags.</p>
      ${h3('Debug levels')}
      <p>Edit any level's categories or create a new one. Presets created by OrgLens start with <code>OrgLens_</code>:</p>
      <table class="dgrid g-t"><tbody>
        <tr><td><b>Analysis</b></td><td>Method timing, SOQL/DML, limits, flows — best for the analyzer.</td></tr>
        <tr><td><b>Debug</b></td><td><code>System.debug</code>, SOQL &amp; DML, small logs.</td></tr>
        <tr><td><b>Finest</b></td><td>Everything including variable assignments — large logs that may be truncated at 20 MB.</td></tr>
        <tr><td><b>Errors only</b></td><td>Exceptions and limits — tiny logs.</td></tr>
      </tbody></table>
      <p class="muted">Your own user gets a <code>DEVELOPER_LOG</code> flag, everyone else <code>USER_DEBUG</code>; classes/triggers get <code>CLASS_TRACING</code> overrides.</p>
      ${shot('trace-flags', 'Trace Flags: your active flag with 28 minutes left, debug levels, and adding flags for yourself and the Automated Process user at the Analysis level for 1 hour.')}
      ${go('trace')}`],

    ['soql', 'SOQL explorer', `
      ${h3('Write and run queries')}
      <ul>
        <li><b>Objects (left):</b> search objects (tick <i>Tooling API</i> for metadata objects). Click one to start a query. The field list shows types, relationships (click <code>Owner.</code> to traverse) and picklist values. Click a field to insert it, <b>Shift+click</b> to add it to SELECT, <i>All</i> to select every field.</li>
        <li><b>Editor:</b> autocomplete for objects, fields, relationship paths, sub-queries, picklist values and keywords — ${k('Tab')} accepts the first suggestion. ${k('Ctrl')}+${k('Enter')} runs. <i>Include deleted</i> uses queryAll. History, Saved queries and Format are on the toolbar.</li>
        <li><b>Σ Count</b> counts matching rows without fetching them. <b>Plan</b> shows whether the query is selective (uses an index) and why.</li>
      </ul>
      ${h3('Results grid')}
      <p>Sort by header, drag column edges to resize, Compact/Comfortable density, filter box, field types in the headers. Click a cell then ${k('Ctrl')}+${k('C')} to copy it. Sub-query cells open their child records. Export CSV / JSON or Copy (pastes into Excel).</p>
      ${h3('Edit, bulk edit and delete')}
      <ul>
        <li>When the query selects <code>Id</code> from one object, <b>double-click any editable cell</b>. Picklists, checkboxes, dates, date-times and numbers get the right control; ${k('Enter')} keeps the change, ${k('Esc')} cancels. Formula and read-only fields can't be edited.</li>
        <li>Changed cells turn amber and the action bar shows <b>N unsaved changes</b>. <b>Save changes</b> commits them in one batch; rows that fail (e.g. a validation rule) are marked ⚠ with the error on hover, while the rest save. <b>Discard</b> throws pending edits away; <b>Undo last save</b> restores the previous values.</li>
        <li>Tick rows to <b>Bulk edit…</b> (set one field on all of them — added as pending edits for you to review), <b>Delete</b> (to the Recycle Bin), <b>Clone</b>, <b>Copy Ids</b> or <b>Show all data</b>.</li>
      </ul>
      ${shot('soql-edit', 'Inline editing: two pending changes (Industry and NumberOfEmployees, highlighted amber), two rows selected, and the action bar with Save changes, Bulk edit and Delete.')}
      ${h3('Show all data for a record')}
      <p>Click a row number or any Id — or use <b>Open Id</b> and paste an Id or a Salesforce URL. You get every field with its label, API name, type and flags (formula, read-only, required, external Id, unique) and help text. Filter fields, <i>Hide empty</i>, <i>Custom only</i>. <b>Edit</b> turns every editable field into the right control; <b>Save</b> writes only what changed. The <b>Related</b> tab lists child relationships — open one to load its records and counts, or <i>Query in SOQL →</i>. Click a lookup Id to drill into the parent record; <b>←</b> goes back. There is also <b>Clone</b>, <b>Delete</b>, JSON view and Open in Salesforce.</p>
      ${shot('soql-record', 'Show all data: every Account field with label, API name, type and read-only/required flags.')}
      ${shot('soql-record-edit', 'The same record in edit mode: typed editors for every editable field (text, picklist, lookup), read-only fields left as values, and the Save button counting the pending change.')}
      ${h3('Create and import records')}
      <ul>
        <li><b>New</b> opens a form built from the object's metadata, required fields first (marked <b class="req">*</b>), with help text and a <i>Required only</i> filter.</li>
        <li><b>Import</b>: choose the object and action — <b>Insert</b>, <b>Update</b> (needs an Id column), <b>Upsert</b> (pick the external Id to match on) or <b>Delete</b>. Paste CSV, copy cells straight from Excel or Google Sheets, or <i>Load file…</i>. The preview shows which columns match fields (green) and which will be ignored (red). Empty cells are left unchanged; <code>#N/A</code> or <code>NULL</code> clears a field. Results are shown per row and can be downloaded as CSV.</li>
      </ul>
      ${shot('soql-import', 'Import preview: three rows ready to insert, a quoted value with a comma parsed correctly, and an unknown column (Bogus__c) flagged red and ignored.')}
      ${note('Every change asks for confirmation and names the org. Writes use the sObject Collections API in batches of 200 and are never all-or-none, so one bad row doesn\'t block the others.')}
      ${go('soql')}`],

    ['rest', 'REST explorer', `
      <p>Test any Salesforce REST API against the connected org — like Workbench's REST Explorer or Postman, but already signed in.</p>
      <ul>
        <li><b>Request:</b> pick the method, type a path and press ${k('Ctrl')}+${k('Enter')}. Relative paths such as <code>/limits</code> resolve to <code>/services/data/vXX.0/limits</code>; paths that start with <code>/services/</code> (e.g. <code>/services/apexrest/…</code>) are used as-is. The resolved URL is shown under the path, and path autocomplete suggests endpoints and your org's objects.</li>
        <li><b>Body:</b> JSON editor with live validation (✓ / ✗), <i>Format</i> to pretty-print, ${k('Tab')} inserts spaces. Used for POST / PATCH / PUT.</li>
        <li><b>Headers:</b> add custom headers (e.g. <code>Sforce-Query-Options</code>); Authorization and Accept are added for you.</li>
        <li><b>Quick start</b> (left): ready-made requests — limits, describe, query, SOSL, create/update/delete a record, composite, tooling, Apex REST, Connect and invocable actions. Replace <code>{id}</code> placeholders before sending.</li>
        <li><b>Response:</b> status (green 2xx, amber 4xx, red 5xx), time and size, then three views —
          <b>Pretty</b>: a collapsible JSON tree (click ▸ to expand, <i>Expand all</i> / <i>Collapse all</i>, search keys &amp; values, click a key to copy its path such as <code>records[0].Name</code>, double-click a value to copy it, Salesforce Ids open the record, <code>/services/data/…</code> URLs are links you can follow);
          <b>Raw</b>: the exact response text; <b>Headers</b>: response headers.</li>
        <li><b>History &amp; Saved</b> keep your requests; <b>cURL</b> copies the request for a terminal (the token is a <code>$SF_ACCESS_TOKEN</code> placeholder); <b>Copy</b> and <b>Save</b> the response.</li>
      </ul>
      ${shot('rest-explorer', 'REST explorer: a query with a sub-query, 200 OK in 1.3 s, shown as a collapsible JSON tree with record Ids as links.')}
      <p class="muted">Safety: requests only go to the connected org's own instance — the access token is never sent to other hosts. DELETE asks for confirmation. POST/PATCH/DELETE change real data.</p>${go('rest')}`],

    ['org', 'Org setup', `
      <ul>
        <li><b>Settings:</b> every Setup settings page exposed by the Metadata API (≈200), with each option <span class="onoff on">● Enabled</span> or <span class="onoff off">○ Disabled</span> and counts per page. Search across all of them (they load in the background the first time, ~30 s), filter <i>Only enabled</i>, export CSV.</li>
        <li><b>Overview &amp; limits:</b> edition, instance, trial expiry, locale, language, time zone, active users, API version, and every org limit as a usage bar sorted by usage.</li>
        <li><b>Installed packages</b>, <b>Licenses</b> (user + permission set licenses with used/total), <b>My access</b> (profile, role, permission sets and groups), <b>Setup audit trail</b> (last 500 changes, filterable).</li>
      </ul>
      ${shot('org-settings', 'Org Setup → Settings: Order settings with 5 options enabled and 2 disabled, labels generated from the API names shown underneath.')}
      ${shot('org-overview', 'Overview & limits: org details and all 75 org limits as usage bars.')}
      ${note(`<b>Why settings don't look exactly like Setup:</b> they come from the Metadata API, not the Setup screens. Labels are generated from API names, one Setup page can combine several settings groups (plus licenses and features), some API flags are hidden in Setup, and some Setup options aren't in the API. Values match; layout and wording may not. Use the search box to find an option by keyword.`)}
      ${go('org')}`],

    ['workflows', 'Common workflows', `
      ${h3('Debug a failing transaction')}
      <ol class="steps"><li>Start tracing for the user who hits the error (yourself, or another user on <i>Trace Flags</i>).</li><li>Turn on live tail and reproduce the error.</li><li>The failed log appears in red in Live Logs — click it.</li><li>In <b>Debug &amp; Errors</b> (or Log Viewer → <i>Jump to next: Error</i>) find the exception, then <i>Open source</i> to land on the Apex line.</li></ol>
      ${h3('Find out why something is slow')}
      <ol class="steps"><li>Trace at the <b>Analysis</b> level and reproduce.</li><li>Open the log → <b>Performance</b>: read <i>Where the time went</i> and the <i>Critical path</i>.</li><li>Sort <i>Method performance</i> by Self; look for <i>hot</i> and <i>chatty</i> flags.</li><li>If SOQL dominates, open <b>Database</b> → <i>Group identical</i> and <b>Plan</b> the expensive queries.</li></ol>
      ${h3('Catch logs from an integration, guest user or background job')}
      <ol class="steps"><li><i>Trace Flags</i> → choose <i>Integration</i>, <i>Guest / Site</i> or <i>Automated Process</i>.</li><li>Tick the user, pick <i>Analysis</i>, a duration, and <b>Start tracing</b>.</li><li>Trigger the integration or job; filter Live Logs by that user.</li></ol>
      ${h3('Find SOQL or DML inside loops')}
      <p>Open any log: the <b>Overview</b> insights flag queries or DML repeated from the same line, and <b>Database</b> shows the ×N repeat badge with the calling method and line.</p>
      ${h3('Fix data in bulk')}
      <ol class="steps"><li>SOQL: query the records with <code>Id</code> and the fields to change.</li><li>Tick the rows → <b>Bulk edit…</b>, or double-click cells to edit them one by one.</li><li>Review the amber cells → <b>Save changes</b>. If something is wrong, <b>Undo last save</b>.</li></ol>
      ${h3('Load data from a spreadsheet')}
      <ol class="steps"><li>Put field API names in the first row; for updates include <code>Id</code>, for upserts the external Id field.</li><li>Copy the cells, then SOQL → <b>Import</b> → paste.</li><li>Check the column preview, run, and download the results CSV.</li></ol>
      ${h3('Test an Apex REST service or Connect API')}
      <p>REST → type <code>/services/apexrest/YourService</code> (or a <code>/connect/…</code> path), choose the method, paste the JSON body, ${k('Ctrl')}+${k('Enter')}. Expand the response tree, click keys to copy paths, and <b>Save</b> the request for next time.</p>
      ${h3('Check whether a feature setting is enabled')}
      <p>Org Setup → Settings → type a keyword (e.g. <i>history</i>, <i>pricing</i>, <i>orders</i>) in <i>Search every setting</i>. Tick <i>Only enabled</i> to see what is switched on.</p>`],

    ['sidebar', 'Sidebar, status bar & editor', `
      <ul>
        <li><b>Activity-bar icon:</b> opens this Studio on Home (setting <code>orglens.openHomeOnSidebarClick</code>) and shows the compact <i>Debug Logs</i> list with the same actions on its toolbar.</li>
        <li><b>Status bar:</b> <code>☁ org</code> switches org; the trace item shows time left and opens a quick menu.</li>
        <li><b>Raw logs</b> open with syntax colouring, an Outline (code units → methods) and folding.</li>
        <li><b>Execute anonymous:</b> the Home tile (or <i>OrgLens: Execute Anonymous Apex</i>) opens a dialog — paste Apex, <i>Load file…</i> (.apex/.cls/.txt) or pick a <i>Recent snippet</i>, and press Run (${k('Ctrl')}+${k('Enter')}). You see success, the compile error with its line selected in the code, or the runtime exception with stack trace, and the debug log opens in the analyzer automatically (captured at Analysis level, even when the code fails). In an Apex editor, select code and press ${k('Ctrl')}+${k('Alt')}+${k('E')} to run it directly.</li>
        <li><b>Any .log file:</b> right-click in the Explorer → <i>Analyze Apex Log File</i>.</li>
        <li><b>Commands:</b> every feature is in the Command Palette under <i>OrgLens:</i> — e.g. <i>Open OrgLens</i>, <i>Open SOQL Explorer</i>, <i>Open REST Explorer</i>, <i>Manage Trace Flags</i>, <i>Open User Guide</i>.</li>
      </ul>`],

    ['keys', 'Keyboard shortcuts', `
      <table class="dgrid g-t"><tbody>
        <tr><td>${k('Ctrl')}+${k('Alt')}+${k('E')}</td><td>Execute selected Apex and analyze its log</td></tr>
        <tr><td>${k('Ctrl')}+${k('Enter')}</td><td>Run SOQL query / send REST request</td></tr>
        <tr><td>${k('Tab')}</td><td>Accept first SOQL suggestion</td></tr>
        <tr><td>Double-click, ${k('Enter')} / ${k('Esc')}</td><td>Edit a SOQL result cell, keep / cancel the change</td></tr>
        <tr><td>${k('Ctrl')}+${k('C')}</td><td>Copy selected SOQL result cell</td></tr>
        <tr><td>${k('Ctrl')}+${k('F')}</td><td>Focus search (Live Logs, Log Viewer)</td></tr>
        <tr><td>${k('Enter')} / ${k('Shift')}+${k('Enter')}, ${k('F3')}</td><td>Next / previous match in Log Viewer</td></tr>
        <tr><td>${k('W')} ${k('S')} ${k('A')} ${k('D')}</td><td>Zoom / pan the Timeline</td></tr>
        <tr><td>Arrows, ${k('Enter')}</td><td>Navigate Call Tree, open line in log</td></tr>
        <tr><td>${k('Esc')}</td><td>Close the record panel</td></tr>
      </tbody></table>`],

    ['trouble', 'Troubleshooting & FAQ', `
      <dl class="faq">
        <dt>No logs appear.</dt><dd>Check the trace pill says <i>Tracing</i>. Logs are written for the traced user only — if the action ran as another user (integration, guest, Automated Process) add a trace flag for that user on <i>Trace Flags</i>. Then Refresh or turn on live tail.</dd>
        <dt>The call tree / Performance tab shows no methods.</dt><dd>The log was captured at <i>Debug</i> level. Switch your trace to <b>Analysis</b> and reproduce.</dd>
        <dt>“Log was truncated”.</dt><dd>Salesforce caps logs at 20 MB. Use a lower level (Analysis instead of Finest).</dd>
        <dt>I can't edit cells in the SOQL grid.</dt><dd>Editing needs <code>Id</code> in the SELECT and a query on a single object (not the Tooling API). Formula, read-only and relationship columns (e.g. <code>Owner.Name</code>) can't be edited — edit the lookup Id field instead.</dd>
        <dt>A save or import partly failed.</dt><dd>Each row is saved independently. Hover the ⚠ row (grid) or read the Error column (import results) — usually a validation rule, a required field or a permission. Fix those rows and save again.</dd>
        <dt>Connecting is slow the first time.</dt><dd>The first connection asks the sf CLI for a session (~5–8 s on Windows). It is then cached securely and later starts take ~1 s.</dd>
        <dt>Can't connect / wrong org.</dt><dd>Click the org pill and pick another, or re-authorize with <code>sf org login web -a ALIAS</code>. Details are in <i>View → Output → OrgLens</i>.</dd>
        <dt>Query plan unavailable.</dt><dd>Plans need literal values; bind variables are replaced with blanks, which some queries reject.</dd>
        <dt>Org settings don't match Setup.</dt><dd>See the note in <i>Org setup</i> — the values come from the Metadata API; use search to find an option by keyword.</dd>
        <dt>Where are downloaded logs kept?</dt><dd>In the extension's storage folder, so reopening is instant. <i>Clear Local Log Cache</i> (sidebar ··· menu) removes them.</dd>
      </dl>`],

    ['safety', 'Privacy & safety', `
      <ul>
        <li><b>Sign-in:</b> uses your existing Salesforce CLI authorization. The session token is cached in VS Code's encrypted Secret Storage, never in settings or files.</li>
        <li><b>Where requests go:</b> only to the connected org's own instance URL. The REST explorer refuses absolute URLs on other hosts.</li>
        <li><b>Writes:</b> every insert, update, delete, import, trace-flag or debug-level change asks for confirmation and names the org. Deletes go to the Recycle Bin.</li>
        <li><b>Logs:</b> downloaded logs stay on your machine in the extension's storage folder.</li>
      </ul>`],

    ['settings', 'Extension settings', `
      <p>Open VS Code Settings and search <b>OrgLens</b>:</p>
      <table class="dgrid g-t"><tbody>
        <tr><td><code>tail.intervalSeconds</code></td><td>How often live tail checks for new logs (default 4).</td></tr>
        <tr><td><code>tail.onNewLog</code></td><td>badge · notify · analyze · raw — what happens when a new log arrives.</td></tr>
        <tr><td><code>tail.autoStart</code></td><td>Start live tail automatically after connecting.</td></tr>
        <tr><td><code>trace.defaultPreset</code> / <code>trace.durationMinutes</code></td><td>Defaults when starting a trace.</td></tr>
        <tr><td><code>trace.autoExtend</code></td><td>Keep your trace alive while live tail runs.</td></tr>
        <tr><td><code>maxLogs</code></td><td>How many recent logs to list (default 150).</td></tr>
        <tr><td><code>defaultOpenAction</code></td><td>Clicking a log in the sidebar: analyze or raw.</td></tr>
        <tr><td><code>openHomeOnSidebarClick</code></td><td>Open this Studio when the activity-bar icon is clicked.</td></tr>
        <tr><td><code>analyzer.includeSystemMethods</code></td><td>Include system method frames in the call tree (noisier).</td></tr>
        <tr><td><code>search.maxLogs</code></td><td>Maximum logs downloaded when searching inside logs.</td></tr>
      </tbody></table>`],
  ];

  window.SFLS.pages.guide = {
    noOrg: true,
    build(el) {
      el.innerHTML = `<div class="guide">
        <nav class="g-nav"><input class="search" id="gsq" placeholder="Search the guide…">
          ${SECTIONS.map(([id, t]) => `<a href="#" data-sec="${id}">${esc(t)}</a>`).join('')}</nav>
        <article class="g-body" id="gbody">
          <header class="g-hero"><div class="g-logo">${I.logo}</div><div><h1>OrgLens user guide</h1><p class="muted">Apex debug logs, performance profiling, trace flags, SOQL data tools, REST APIs and org setup — inside VS Code. Screenshots show the features running against a real org.</p></div></header>
          ${SECTIONS.map(([id, t, html]) => `<section id="g-${id}" class="g-sec"><h2>${esc(t)}</h2>${html}</section>`).join('')}
        </article></div>`;
      const body = el.querySelector('#gbody');
      el.querySelector('.g-nav').onclick = (e) => {
        const a = e.target.closest('[data-sec]');
        if (!a) return;
        e.preventDefault();
        body.querySelector('#g-' + a.dataset.sec).scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      el.querySelector('#gsq').oninput = (e) => {
        const q = e.target.value.toLowerCase().trim();
        el.querySelectorAll('.g-sec').forEach((s) => (s.style.display = !q || s.textContent.toLowerCase().includes(q) ? '' : 'none'));
        el.querySelectorAll('.g-nav a').forEach((a) => {
          const s = body.querySelector('#g-' + a.dataset.sec);
          a.style.display = s.style.display;
        });
      };
      body.onclick = (e) => {
        const z = e.target.closest('[data-zoom]');
        if (z) {
          const box = document.createElement('div');
          box.className = 'g-lightbox';
          box.innerHTML = `<img src="${z.src}" alt=""><div class="g-lb-cap">${esc(z.alt)} <span class="muted">· click or Esc to close</span></div>`;
          const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
          const onKey = (ev) => { if (ev.key === 'Escape') close(); };
          box.onclick = close;
          document.addEventListener('keydown', onKey);
          document.body.appendChild(box);
          return;
        }
        const g = e.target.closest('[data-go]');
        if (g) return window.SFLS.setTab(g.dataset.go);
        const r = e.target.closest('[data-run]');
        if (r) window.SFLS.run(r.dataset.run);
      };
      // highlight current section in the nav
      const links = [...el.querySelectorAll('.g-nav a')];
      body.addEventListener('scroll', () => {
        let cur = SECTIONS[0][0];
        for (const [id] of SECTIONS) { const s = body.querySelector('#g-' + id); if (s.offsetTop - body.scrollTop < 120) cur = id; }
        links.forEach((a) => a.classList.toggle('on', a.dataset.sec === cur));
      });
    },
    shown() {},
  };
})();
