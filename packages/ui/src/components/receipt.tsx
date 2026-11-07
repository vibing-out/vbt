import { useId, type ReactNode } from "react";
import { bodyText, dateOnly, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import type { BallotStatus } from "../status";
import { Button } from "./button";
import { CodeText } from "./code-text";
import { CopyCode } from "./copy-code";
import { StatusBadge } from "./status-badge";

/**
 * The fixed promise line, word for word from the receipt mockup (docs/voter-journey.md). Not a
 * prop: no screen may change what the receipt promises.
 */
export const RECEIPT_PROMISE = "This code shows your ballot's progress. It does not show how you voted.";

export interface ReceiptLabels {
  heading: string;
  codeIntro: string;
  trackIt: string;
  call: string;
  phoneCode: string;
  textUpdates: string;
  trackThis: string;
  saveImage: string;
  saveIsSafe: string;
}

export const RECEIPT_LABELS: ReceiptLabels = {
  heading: "Your ballot receipt",
  codeIntro: "Your ballot tracking code:",
  trackIt: "Track it:",
  call: "Or call:",
  phoneCode: "Phone code:",
  textUpdates: "Text updates:",
  trackThis: "Track this ballot",
  saveImage: "Save image",
  saveIsSafe: "Saving or sharing this receipt is safe. It shows nothing about how you voted.",
};

// Never on a receipt: choices, time of voting, sequence number, machine ID, voter name. These
// props are the whole of what a receipt can show; there is no field for any of those.
interface CommonProps {
  mode?: Mode;
  county: string;
  /** e.g. "General Election". */
  election: string;
  /** The election date only, e.g. "Nov 3, 2026". */
  electionDate: string;
  /** e.g. "Precinct 12". */
  precinct: string;
  /** Shown exactly as passed in. */
  code: string;
  /** The QR code image, rendered by the consumer (T-07 encodes it). It opens /track/<code>. */
  qr: ReactNode;
  labels?: Partial<ReceiptLabels>;
  className?: string;
}

/** The digital pass, on screen. */
export type ReceiptPassProps = CommonProps & {
  form?: "pass";
  /** The ballot's status, shown as a StatusBadge in the top band. */
  status?: BallotStatus;
  /** The tracking page, for the "Track this ballot" action under the pass. */
  trackHref?: string;
  /** Saves the pass as an image, for the "Save image" action under the pass. */
  onSaveImage?: () => void;
};

/** The printed slip. The address and phone are placeholders for a county's own. */
export type ReceiptSlipProps = CommonProps & {
  form: "slip";
  /** The tracker address, e.g. "vote.marion.in.gov/track". */
  trackUrl: string;
  /** The phone line. */
  phone: string;
  /** Numeric code for keypad entry (T-17, stretch). The row is left out when absent. */
  phoneCode?: string;
  /** Number to text "TRACK" and the code to (T-18, stretch). The row is left out when absent. */
  textNumber?: string;
};

export type ReceiptProps = ReceiptPassProps | ReceiptSlipProps;

export function Receipt(props: ReceiptProps) {
  const mode = props.mode ?? "voter";
  const labels = { ...RECEIPT_LABELS, ...props.labels };
  const electionDate = dateOnly(props.electionDate, "The receipt's election date") ?? "";
  return props.form === "slip" ? (
    <Slip {...props} mode={mode} labels={labels} electionDate={electionDate} />
  ) : (
    <Pass {...props} mode={mode} labels={labels} electionDate={electionDate} />
  );
}

type Filled<P> = P & { mode: Mode; labels: ReceiptLabels };

/** The QR code with its alt text. Its tile is always the light surface-raised value, so it scans in dark mode too. */
function QrTile({ code, qr, className }: { code: string; qr: ReactNode; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`QR code for tracking code ${code}`}
      data-slot="qr-tile"
      data-theme="light"
      className={cn("shrink-0 bg-surface-raised text-ink", className)}
    >
      {qr}
    </div>
  );
}

function Pass({
  mode,
  labels,
  county,
  election,
  electionDate,
  precinct,
  code,
  qr,
  status,
  trackHref,
  onSaveImage,
  className,
}: Filled<ReceiptPassProps>) {
  const headingId = useId();
  const text = bodyText(mode);
  return (
    <section
      data-component="receipt"
      data-form="pass"
      data-mode={mode}
      aria-labelledby={headingId}
      className={cn("vbt-receipt flex w-full max-w-95 flex-col gap-4", className)}
    >
      <h2 id={headingId} className="sr-only">
        {labels.heading}
      </h2>
      <div className="vbt-pass relative overflow-hidden rounded-lg bg-surface-inverse text-on-inverse shadow-overlay">
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-label uppercase text-on-inverse-muted">
              {county} {election}
            </p>
            {status ? <StatusBadge status={status} mode={mode} /> : null}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-label uppercase text-on-inverse-muted">{labels.codeIntro}</p>
            <CopyCode code={code} mode={mode} surface="inverse" />
          </div>
        </div>
        {/* Perforation: a cut-out half circle on each edge and a dotted rule. Decorative only. */}
        <div aria-hidden="true" data-slot="perforation" className="relative">
          <div className="mx-6 border-t-2 border-dotted border-on-inverse-muted/30" />
          <span className="absolute top-0 -left-2 size-4 -translate-y-1/2 rounded-pill bg-surface" />
          <span className="absolute top-0 -right-2 size-4 -translate-y-1/2 rounded-pill bg-surface" />
        </div>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-end gap-4">
            <QrTile code={code} qr={qr} className="rounded-md p-3" />
            <p className={cn(text, "text-on-inverse")}>
              {precinct} · {electionDate}
            </p>
          </div>
          <p data-slot="promise" className={cn(text, "text-on-inverse-muted")}>
            {RECEIPT_PROMISE}
          </p>
        </div>
      </div>
      {trackHref || onSaveImage ? (
        <div data-slot="actions" data-print="hide" className="flex flex-col gap-3">
          {trackHref ? (
            <Button asChild mode={mode} className="w-full">
              <a href={trackHref}>{labels.trackThis}</a>
            </Button>
          ) : null}
          {onSaveImage ? (
            <Button variant="secondary" mode={mode} className="w-full" onClick={onSaveImage}>
              {labels.saveImage}
            </Button>
          ) : null}
          <p className={cn(text, "text-ink-muted")}>{labels.saveIsSafe}</p>
        </div>
      ) : null}
    </section>
  );
}

function Slip({
  mode,
  labels,
  county,
  election,
  electionDate,
  precinct,
  code,
  qr,
  trackUrl,
  phone,
  phoneCode,
  textNumber,
  className,
}: Filled<ReceiptSlipProps>) {
  const headingId = useId();
  const text = bodyText(mode);
  const rows: [string, ReactNode][] = [
    [labels.trackIt, trackUrl],
    [labels.call, phone],
  ];
  if (phoneCode) rows.push([labels.phoneCode, <span className="font-mono">{phoneCode}</span>]);
  if (textNumber) rows.push([labels.textUpdates, `text TRACK + your code to ${textNumber}`]);

  // The mockup's order and words. One ink on a light slip, solid rules, readable in black and white.
  return (
    <section
      data-component="receipt"
      data-form="slip"
      data-mode={mode}
      aria-labelledby={headingId}
      className={cn(
        "vbt-receipt vbt-slip flex w-full flex-col gap-4 rounded-sm border-2 border-ink bg-surface-raised p-6 text-ink",
        className,
      )}
    >
      <h2 id={headingId} className="sr-only">
        {labels.heading}
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-label uppercase">
          {county} {election} · {electionDate}
        </p>
        <p className={cn(text, "font-semibold")}>{precinct}</p>
      </div>
      <div className="flex flex-col gap-1 border-t border-ink pt-4">
        <p className={text}>{labels.codeIntro}</p>
        <CodeText code={code} mode={mode} />
      </div>
      <QrTile code={code} qr={qr} className="self-start" />
      <dl className={cn("flex flex-col gap-2 border-t border-ink pt-4", text)}>
        {rows.map(([term, value]) => (
          <div key={term} className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p data-slot="promise" className={cn(text, "border-t border-ink pt-4")}>
        {RECEIPT_PROMISE}
      </p>
    </section>
  );
}
