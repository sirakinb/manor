import { useNavigate } from "react-router-dom";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className="lp relative min-h-full overflow-hidden bg-black text-[#fafafa]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src="/hero-night.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
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
        <div className="lp-glass app-no-drag grid w-[13rem] grid-cols-2 rounded-full p-1">
          <button
            type="button"
            onClick={() => navigate("/sign-up")}
            className="w-full rounded-full px-2 py-1.5 text-center text-[12px] text-[#fafafa9e] transition hover:text-[#fafafa]"
          >
            Get Started
          </button>
          <button
            type="button"
            onClick={() => navigate("/sign-in")}
            className="w-full rounded-full px-2 py-1.5 text-center text-[12px] text-[#fafafa9e] transition hover:text-[#fafafa]"
          >
            Sign In
          </button>
        </div>
      </header>

      <main className="relative z-10 flex min-h-[calc(100dvh-108px)] flex-col justify-end px-5 pb-24 sm:px-8 sm:pb-36">
        <button
          type="button"
          onClick={() => navigate("/sign-up")}
          className="lp-glass app-no-drag absolute top-1/2 left-1/2 inline-flex -translate-x-1/2 -translate-y-[58%] items-center gap-2 rounded-full px-5 py-2.5 text-sm text-[#fafafa] transition hover:bg-white/15"
        >
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded-full bg-white/90"
          >
            <span className="ml-0.5 border-y-[5px] border-l-[8px] border-y-transparent border-l-black" />
          </span>
          Watch it work
        </button>
        <div className="max-w-4xl">
          <h1 className="lp-rise text-[2.15rem] leading-[1.08] tracking-[-0.04em] sm:text-5xl">
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
          </h1>
        </div>
      </main>
    </div>
  );
}
