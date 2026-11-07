import { placeholderStatus } from "../lib/status";

export default function Home() {
  return (
    <main>
      <h1>VBT</h1>
      <p>{placeholderStatus()}</p>
    </main>
  );
}
