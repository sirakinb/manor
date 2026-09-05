import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { HeroSky } from "../components/beautiful-ui/HeroSky";
import { ParticleWordmark } from "../components/beautiful-ui/ParticleWordmark";
import { brand } from "../lib/brand";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const [demoOpen, setDemoOpen] = useState(false);
  return (
    <div className="lp relative min-h-full overflow-hidden bg-black text-[#fafafa]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src="/hero-night.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
        <HeroSky className="lp-sky absolute inset-0 h-full w-full" />
        <div className="lp-veil absolute inset-0 bg-[radial-gradient(80%_70%_at_78%_72%,rgba(128,51,204,0.22),transparent_55%),linear-gradient(to_top,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.18)_42%,rgba(0,0,0,0.45)_100%)]" />
        <div className="lp-grain" />
      </div>

      <div className="app-drag relative z-10 flex gap-2 px-5 pt-[18px]">
        <WindowChrome />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <div className="inline-flex items-center gap-2.5">
          <img src="/manor-mark.png" alt="" className="h-7 w-7" />
          <span className="rk-wordmark text-[13px] text-[#fafafa]">Manor</span>
        </div>
        <a
          href="https://cal.com/akinyemi-bajulaiye-2jua88/30min?overlayCalendar=true"
          target="_blank"
          rel="noreferrer"
          className="lp-glass app-no-drag inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] text-[#fafafa9e] transition hover:text-[#fafafa]"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            className="size-4"
          >
            <rect x="2" y="3" width="12" height="11" rx="2.5" />
            <path d="M2 6.5h12M5.5 1.6v2.4M10.5 1.6v2.4" strokeLinecap="round" />
          </svg>
          <Trans>Book demo</Trans>
        </a>
      </header>

      <main className="relative z-10 flex min-h-[calc(100dvh-108px)] flex-col justify-end px-5 pb-24 sm:px-8 sm:pb-36">
        {brand.id === "manor" ? (
          <div
            aria-hidden="true"
            className="lp-wordmark absolute top-[15%] left-1/2 w-[min(720px,88vw)] -translate-x-1/2 sm:top-[17%]"
          >
            <ParticleWordmark text="MANOR" fontSize={112} gap={3} label="Manor" fitOnMobile />
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setDemoOpen(true)}
          className="lp-lumen app-no-drag absolute top-1/2 left-1/2 inline-flex -translate-x-1/2 -translate-y-[58%] items-center gap-2 rounded-full px-5 py-2.5 text-sm text-[#fafafa] transition"
        >
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded-full bg-white/90"
          >
            <span className="ml-0.5 border-y-[5px] border-l-[8px] border-y-transparent border-l-black" />
          </span>
          <Trans>Watch it work</Trans>
        </button>
        <div className="max-w-4xl">
          <h1 className="lp-rise text-[2.15rem] leading-[1.08] tracking-[-0.04em] sm:text-5xl">
            <Trans>
              Your team of{" "}
              <span className="rk-display bg-linear-to-r from-[#8033cc] to-[#fafafa] bg-clip-text text-transparent">
                always-on AI agents
              </span>
              <br />
              that you can give{" "}
              <span className="rk-display bg-linear-to-r from-[#8033cc] to-[#fafafa] bg-clip-text text-transparent">
                real work
              </span>{" "}
              to.
            </Trans>
          </h1>
        </div>
      </main>

      {demoOpen ? <DemoOverlay onClose={() => setDemoOpen(false)} /> : null}
    </div>
  );
}

function DemoOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const dialog = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    dialog.current?.focus();
    // A click opened this, so the page carries user activation and audio may start.
    // Browsers that still refuse leave the poster up behind the native controls.
    void video.current?.play().catch(() => undefined);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="app-no-drag absolute inset-0 z-30 flex items-center justify-center bg-[rgba(4,4,5,.78)] p-4 backdrop-blur-sm sm:p-10">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t`Close demo`}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t`Manor demo`}
        tabIndex={-1}
        className="relative w-[min(1240px,92vw)] overflow-hidden rounded-[18px] border border-[#2B2B2F] bg-black shadow-[0_40px_90px_rgba(0,0,0,.6)] outline-none"
      >
        <video
          ref={video}
          src="/manor-demo.mp4"
          poster="/manor-demo-poster.jpg"
          controls
          playsInline
          preload="metadata"
          onEnded={onClose}
          className="block max-h-[82vh] w-full bg-black"
        >
          <track kind="captions" />
        </video>
      </div>
      <button
        type="button"
        aria-label={t`Close demo`}
        onClick={onClose}
        className="lp-glass absolute top-5 right-5 grid size-9 place-items-center rounded-full text-[#fafafa] transition hover:bg-white/15 sm:top-8 sm:right-8"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
          <path
            d="M3.5 3.5l9 9m0-9l-9 9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
