"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { decodeQrFrame } from "../qr-input";

type CameraStatus = "off" | "starting" | "live" | "denied" | "unsupported" | "insecure" | "error";

/** How often a frame is looked at, and the widest picture that is analysed (smaller is faster and lighter). */
const FRAME_INTERVAL_MS = 150;
const MAX_FRAME_WIDTH = 640;
/**
 * A card that was just handled is ignored until it has left the picture (this many empty frames in a row), so a
 * customer still holding their card up is not stamped, or refused, a second time.
 */
const EMPTY_FRAMES_TO_REARM = 6;

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

/**
 * The camera. It starts only when staff ask, shows the live picture, reads QR codes from it, and lets go of the
 * camera the moment it is turned off, the page is hidden or this component goes away.
 *
 * Privacy: frames are drawn to a small off-screen canvas, read, and overwritten by the next one. Nothing is
 * recorded, saved, converted to an image file or uploaded; stopping clears the canvas and releases the camera.
 */
export function CameraPanel({
  enabled,
  onEnabledChange,
  paused,
  onCode,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** True while a scan is being handled, so the same card is not read again. */
  paused: boolean;
  onCode: (text: string) => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const [status, setStatus] = useState<CameraStatus>("off");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    onCodeRef.current = onCode;
  });

  const release = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    trackRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      release();
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let lastCode: string | null = null;
    let emptyFrames = 0;

    const stopEverything = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      release();
      canvas.width = 0;
      canvas.height = 0;
    };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus(window.isSecureContext ? "unsupported" : "insecure");
        return;
      }
      setStatus("starting");
      setTorchOn(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const [track] = stream.getVideoTracks();
        trackRef.current = track ?? null;
        const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined;
        setTorchSupported(Boolean(capabilities?.torch));
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setStatus("live");

        timer = setInterval(() => {
          const v = videoRef.current;
          if (!v || !context || pausedRef.current || v.readyState < 2 || !v.videoWidth) return;
          const scale = Math.min(1, MAX_FRAME_WIDTH / v.videoWidth);
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          context.drawImage(v, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          void decodeQrFrame(frame).then((text) => {
            if (cancelled || pausedRef.current) return;
            if (!text) {
              if (++emptyFrames >= EMPTY_FRAMES_TO_REARM) lastCode = null;
              return;
            }
            emptyFrames = 0;
            if (text === lastCode) return;
            lastCode = text;
            onCodeRef.current(text);
          });
        }, FRAME_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        setStatus(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "unsupported"
              : "error",
        );
      }
    }

    void start();

    // A hidden page must not keep the camera: stop it, and bring it back when the page is shown again.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopEverything();
        setStatus("off");
      } else if (!streamRef.current && !cancelled) {
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopEverything);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stopEverything);
      stopEverything();
    };
  }, [enabled, release]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  // What is shown follows the switch immediately; the stored status is only meaningful while it is on.
  const shown: CameraStatus = enabled ? status : "off";
  const torchAvailable = enabled && shown === "live" && torchSupported;
  const unavailable: Partial<Record<CameraStatus, string>> = {
    denied: t("scanner.cameraDenied"),
    unsupported: t("scanner.cameraUnavailable"),
    insecure: t("scanner.cameraInsecure"),
    error: t("scanner.cameraError"),
  };
  const problem = unavailable[shown];

  return (
    <section aria-labelledby="camera-title" className="flex flex-col gap-3">
      <h2 id="camera-title" className="text-xl font-bold text-green-900">
        {t("scanner.title")}
      </h2>

      <div
        className="relative aspect-[3/4] w-full overflow-hidden rounded-card bg-charcoal-900 sm:aspect-video"
        data-testid="camera-view"
        data-camera={shown}
      >
        {/* The picture is for aiming only. It is muted, inline (no full-screen takeover on iPhone) and unrecorded. */}
        <video
          ref={videoRef}
          muted
          playsInline
          aria-hidden="true"
          className={shown === "live" ? "h-full w-full object-cover" : "hidden"}
        />
        {shown === "live" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-white">
            <p role="status">
              {shown === "starting" ? t("scanner.cameraStarting") : t("scanner.cameraIdleHint")}
            </p>
          </div>
        )}
      </div>

      {problem ? <Alert tone="warning">{problem}</Alert> : null}
      {shown === "live" ? (
        <p role="status" className="text-sm text-muted">
          {t("scanner.cameraLive")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {enabled && (shown === "live" || shown === "starting") ? (
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => onEnabledChange(false)}
          >
            {t("scanner.stop")}
          </Button>
        ) : (
          <Button
            size="lg"
            className="flex-1"
            onClick={() => {
              // A fresh attempt: turning it off and on again restarts a camera that errored or was refused.
              onEnabledChange(false);
              setTimeout(() => onEnabledChange(true), 0);
            }}
          >
            {problem ? t("scanner.cameraRetry") : t("scanner.start")}
          </Button>
        )}
        {torchAvailable ? (
          <Button
            variant="secondary"
            size="lg"
            aria-pressed={torchOn}
            onClick={() => void toggleTorch()}
          >
            {torchOn ? t("scanner.torchOff") : t("scanner.torchOn")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
