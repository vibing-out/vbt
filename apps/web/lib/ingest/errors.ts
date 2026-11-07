/** An uploaded file that is not in the expected format. Its message is safe to show the official. */
export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}
