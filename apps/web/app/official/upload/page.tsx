import { OFFICIAL_ROLES } from "@vbt/domain";
import { requireOfficialPage } from "../../../lib/page-guard";
import { Forbidden, OfficialNav } from "../ui";
import { UploadForm } from "./upload-form";

// Upload exported machine logs and results files (T-09). Any official; the API checks the scope per file.
// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const official = await requireOfficialPage(OFFICIAL_ROLES);
  if (!official) return <Forbidden />;

  return (
    <main>
      <h1>Upload exported files</h1>
      <OfficialNav />
      <p>Files are checked and their SHA-256 is recorded; the file itself is not stored.</p>
      <UploadForm defaultScopeId={official.scopeId ?? ""} />
    </main>
  );
}
