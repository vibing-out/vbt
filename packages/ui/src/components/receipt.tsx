import type { ReactNode } from "react";
import { bodyText, dateOnly, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";

/** The fixed promise line (Receipt README). Not a prop: no screen may change what the receipt promises. */
export const RECEIPT_PROMISE = "Shows your ballot's progress. Does not show how you voted.";

export interface ReceiptLabels {
  title: string;
  election: string;
  date: string;
  precinct: string;
  codeIntro: string;
  trackIt: string;
  call: string;
  phoneCode: string;
  textUpdates: string;
}

export const RECEIPT_LABELS: ReceiptLabels = {
  title: "Ballot receipt",
  election: "Election",
  date: "Date",
  precinct: "Precinct",
  codeIntro: "Your ballot tracking code",
  trackIt: "Track it",
  call: "Or call",
  phoneCode: "Phone code",
  textUpdates: "Text updates",
};

// Principle 1: a receipt never carries choices or identity. Principle 5: never the time of voting.
// These props are the whole of what a receipt can show; there is no field for a name, choices or a time.
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
  /** The QR code, rendered by the consumer (T-07 encodes it). */
  qr: ReactNode;
  labels?: Partial<ReceiptLabels>;
  className?: string;
}

/** The digital pass, on screen. */
export type ReceiptPassProps = CommonProps & { form?: "pass" };

/** The printed slip. The address and phone are placeholders for a county's own. */
export type ReceiptSlipProps = CommonProps & {
  form: "slip";
  /** The tracker address, e.g. "vote.marion.in.gov/track". */
  trackUrl: string;
  /** The phone line. */
  phone: string;
  /** Numeric code for keypad entry (T-17, stretch). The row is left out when absent. */
  phoneCode?: string;
  /** Number to text "TRACK <code>" to (T-18, stretch). The row is left out when absent. */
  textNumber?: string;
};

export type ReceiptProps = ReceiptPassProps | ReceiptSlipProps;

export function Receipt(props: ReceiptProps) {
  const mode = props.mode ?? "voter";
  const labels = { ...RECEIPT_LABELS, ...props.labels };
  const electionDate = dateOnly(props.electionDate, "The receipt's election date");
  return props.form === "slip" ? (
    <Slip {...props} mode={mode} labels={labels} electionDate={electionDate ?? ""} />
  ) : (
    <Pass {...props} mode={mode} labels={labels} electionDate={electionDate ?? ""} />
  );
}

type Filled<P> = P & { mode: Mode; labels: ReceiptLabels };

function Pass({ mode, labels, county, election, electionDate, precinct, code, qr, className }: Filled<ReceiptPassProps>) {
  const text = bodyText(mode);
  const facts = [
    [labels.election, election],
    [labels.date, electionDate],
    [labels.precinct, precinct],
  ] as const;
  return (
    <article
      data-component="receipt"
      data-form="pass"
      data-mode={mode}
      aria-label={labels.title}
      className={cn(
        "vbt-receipt vbt-pass relative w-full overflow-hidden rounded-lg bg-surface-inverse text-on-inverse shadow-overlay",
        className,
      )}
    >
      <div aria-hidden="true" className="h-2 bg-brand-orange" />
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-label uppercase text-on-inverse-muted">{county}</p>
          <p className="text-label uppercase">{labels.title}</p>
        </div>
        <p className={cn("font-mono wrap-anywhere", mode === "admin" ? "text-code" : "text-code-lg")}>{code}</p>
        <dl className="grid grid-cols-3 gap-3">
          {facts.map(([term, value]) => (
            <div key={term} className="flex min-w-0 flex-col gap-1">
              <dt className="text-label uppercase text-on-inverse-muted">{term}</dt>
              <dd className={cn(mode === "admin" ? "text-small" : "text-body-lg", "font-semibold")}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {/* Perforated tear line with notches, like a wallet ticket. */}
      <div aria-hidden="true" className="relative">
        <div className="mx-6 border-t-2 border-dashed border-on-inverse-muted" />
        <span className="absolute top-0 -left-3 size-6 -translate-y-1/2 rounded-pill bg-surface" />
        <span className="absolute top-0 -right-3 size-6 -translate-y-1/2 rounded-pill bg-surface" />
      </div>
      <div className="flex flex-col items-center gap-4 p-6">
        <div className="rounded-md bg-on-inverse p-3 text-surface-inverse">{qr}</div>
        <p className={cn(text, "text-center")}>{RECEIPT_PROMISE}</p>
      </div>
    </article>
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
  const text = bodyText(mode);
  const rows: [string, ReactNode][] = [
    [labels.trackIt, trackUrl],
    [labels.call, phone],
  ];
  if (phoneCode) rows.push([labels.phoneCode, <span className="font-mono">{phoneCode}</span>]);
  if (textNumber) rows.push([labels.textUpdates, `Text TRACK and your code to ${textNumber}`]);

  // One ink on a light slip, solid rules, readable in black and white.
  return (
    <article
      data-component="receipt"
      data-form="slip"
      data-mode={mode}
      aria-label={labels.title}
      className={cn(
        "vbt-receipt vbt-slip flex w-full flex-col gap-4 rounded-sm border-2 border-ink bg-surface-raised p-6 text-ink",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-label uppercase">
          {county} · {election} · {electionDate}
        </p>
        <p className={cn(text, "font-semibold")}>{precinct}</p>
      </div>
      <div className="flex flex-col gap-1 border-t border-ink pt-4">
        <p className={text}>{labels.codeIntro}</p>
        <p className={cn("font-mono wrap-anywhere", mode === "admin" ? "text-code" : "text-code-lg")}>{code}</p>
      </div>
      <div className="self-start">{qr}</div>
      <dl className={cn("flex flex-col gap-2 border-t border-ink pt-4", text)}>
        {rows.map(([term, value]) => (
          <div key={term} className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{term}:</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={cn(text, "border-t border-ink pt-4")}>{RECEIPT_PROMISE}</p>
    </article>
  );
}
