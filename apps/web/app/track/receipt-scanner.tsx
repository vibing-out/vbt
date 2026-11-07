"use client";

import { Button } from "@vbt/ui/components/button";
import { Icon } from "@vbt/ui/components/icon";
import { QrFrame, type QrFrameState } from "@vbt/ui/components/qr-frame";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseReceiptQr } from "../../lib/receipt-url";

// The in-page receipt scanner (design system QRScanner README). Frames are decoded on the device with
// the browser's BarcodeDetector, or jsQR where that API is missing; nothing is uploaded or recorded.

type Phase = "idle" | "asking" | "scanning" | "found" | "wrong-code" | "denied" | "no-camera";

/** Decodes one video frame; resolves to the QR text, or null when none is in view. */
type FrameDecoder = (video: HTMLVideoElement) => Promise<string | null>;

// Lets the "found" corners show for duration-fast before navigating.
const FOUND_DELAY_MS = 120;
const SCAN_INTERVAL_MS = 150;

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

async function createDecoder(): Promise<FrameDecoder> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Detector) {
    const formats = (await Detector.getSupportedFormats?.()) ?? ["qr_code"];
    if (formats.includes("qr_code")) {
      const detector = new Detector({ formats: ["qr_code"] });
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
    }
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const { videoWidth: w, videoHeight: h } = video;
    if (!ctx || !w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

export interface ReceiptScannerProps {
  /** Hosts whose receipt URLs are accepted. */
  hosts: string[];
  /** TRACKING_CODE_PATTERN.source, passed from the server so @vbt/crypto stays out of the client bundle. */
  codePattern: string;
  /** id of the typed-code input that "Type the code instead" focuses. */
  manualInputId: string;
}

export function ReceiptScanner({ hosts, codePattern, manualInputId }: ReceiptScannerProps): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // The camera indicator turns off whenever the scanner closes, navigates or unmounts.
  useEffect(() => stopCamera, [stopCamera]);

  // Focus returns to the trigger when the scanner closes (it unmounts while the scanner is open).
  const refocusTrigger = useRef(false);
  useEffect(() => {
    if (phase === "idle" && refocusTrigger.current) triggerRef.current?.focus();
    refocusTrigger.current = false;
  }, [phase]);

  const close = useCallback(() => {
    stopCamera();
    refocusTrigger.current = true;
    setPhase("idle");
  }, [stopCamera]);

  const typeInstead = useCallback(() => {
    stopCamera();
    setPhase("idle");
    document.getElementById(manualInputId)?.focus();
  }, [manualInputId, stopCamera]);

  async function allowCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("no-camera");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setPhase("scanning");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no-camera");
    }
  }

  const scanning = phase === "scanning" || phase === "wrong-code";

  // Attach the stream once the video element exists, then decode frames until a receipt is read.
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
    const pattern = new RegExp(codePattern);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    void (async () => {
      const decode = await createDecoder();
      const tick = async () => {
        if (cancelled) return;
        const text = video.readyState >= 2 ? await decode(video).catch(() => null) : null;
        if (cancelled) return;
        if (text !== null) {
          const code = parseReceiptQr(text, { hosts, codePattern: pattern });
          if (code) {
            navigator.vibrate?.(50);
            setPhase("found");
            stopCamera();
            setTimeout(() => router.push(`/track/${encodeURIComponent(code)}`), FOUND_DELAY_MS);
            return;
          }
          setPhase("wrong-code");
        }
        timer = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      void tick();
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanning, codePattern, hosts, router, stopCamera]);

  if (phase === "idle") {
    return (
      <Button ref={triggerRef} type="button" variant="secondary" className="w-full" onClick={() => setPhase("asking")}>
        <Icon name="scan-line" /> Scan your receipt
      </Button>
    );
  }

  if (phase === "asking") {
    return (
      <div className="flex flex-col gap-3" data-testid="scanner-ask">
        <p className="text-body text-ink">We use the camera only to read the code. Nothing is recorded.</p>
        <Button type="button" className="w-full" onClick={allowCamera} autoFocus>
          Allow camera
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={close}>
          Cancel
        </Button>
      </div>
    );
  }

  if (phase === "denied" || phase === "no-camera") {
    return (
      <div className="flex flex-col gap-3" role="alert" data-testid="scanner-unavailable">
        <p className="text-body text-ink">
          {phase === "denied"
            ? "Camera access is off. You can type the code instead."
            : "No camera is available here. You can type the code instead."}
        </p>
        <Button type="button" className="w-full" onClick={typeInstead}>
          Type the code instead
        </Button>
      </div>
    );
  }

  const frameState: QrFrameState = phase === "found" ? "found" : phase === "wrong-code" ? "wrong-code" : "scanning";
  return (
    <QrFrame state={frameState} onClose={close} onManualEntry={typeInstead}>
      <video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay aria-hidden="true" />
    </QrFrame>
  );
}
