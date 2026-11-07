# PrecinctTable

The officials' main table: one row per precinct with ballot count, stage progress, status and cross-check result; selecting rows raises the BatchActionBar.

- **Consumer provides:** precinct rows (name, ballot count, stage per segment, status, cross-check result), the selection state, and filters.
- `.vbt-table` inside a `.vbt-card.vbt-table-wrap`: muted 13px headers, 1px `line` row dividers, selected rows on `accent-tint`, counts in tabular numbers, the compact StageTimeline bar in the Progress column.
- Filters sit above as removable chips (`.vbt-badge.plain` with an ×), not a form.
- Status and cross-check always use StatusBadge (word plus color); a mismatch names its count ("1 mismatch").
- Wide tables scroll inside their card; the page never scrolls sideways.
- **Paging:** the server pages and filters; the browser never loads every row. 50 rows per page by default (100 or 200 on request), with the header row pinned while scrolling. The pager shows "Showing 1–50 of 412" in tabular numbers, Previous and Next, and a few page numbers around the current one.
- **Selecting across pages:** checking the header box selects the visible page only. A banner then offers "Select all 412 that match" the current filters, and the BatchActionBar count says which (50 or 412). A batch action applies to the filter on the server, not to a list of IDs sent from the browser.
- The same pager and select-all rules apply to the ChallengeQueue and to any table of individual ballots (a county can have tens of thousands).
