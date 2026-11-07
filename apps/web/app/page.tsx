import { pipelineSmoke } from "../flags";
import { placeholderStatus } from "../lib/status";

export default async function Home() {
  const smoke = await pipelineSmoke();
  return (
    <main>
      <h1>VBT</h1>
      <p>{placeholderStatus()}</p>
      <p data-testid="flag-pipeline-smoke">pipeline-smoke flag: {smoke ? "on" : "off"}</p>
    </main>
  );
}
