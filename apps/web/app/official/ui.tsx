import { BALLOT_STATUSES, publicLabel } from "@vbt/domain";

// Plain semantic markup shared by the official pages (T-09). No new design tokens: packages/ui is T-03's.

export function Forbidden() {
  return (
    <main data-testid="forbidden">
      <h1>Forbidden</h1>
      <p>Sign in as an official with multi-factor authentication to see this page.</p>
      <p>
        <a href="/login">Sign in</a>
      </p>
    </main>
  );
}

export function StatusCounts({ counts }: { counts: Record<string, number> }) {
  return (
    <table data-testid="status-counts">
      <caption>Ballots by status</caption>
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Public label</th>
          <th scope="col">Ballots</th>
        </tr>
      </thead>
      <tbody>
        {BALLOT_STATUSES.map((status) => (
          <tr key={status}>
            <th scope="row">{status}</th>
            <td>{publicLabel(status)}</td>
            <td>{counts[status] ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OfficialNav() {
  return (
    <nav aria-label="Official tools">
      <ul>
        <li>
          <a href="/official/upload">Upload files</a>
        </li>
        <li>
          <a href="/official/challenges">Challenge queue</a>
        </li>
        <li>
          <a href="/official/mismatches">Mismatch report</a>
        </li>
      </ul>
    </nav>
  );
}
