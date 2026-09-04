import { ChatMarkdown } from "@rakazo/chat-ui/web";
import { createRoot } from "react-dom/client";
import {
  ActivityTimeline,
  groupNarrationBlocks,
  isInterimProse,
  LiveStatusLine,
} from "../../src/components/ActivityTimeline";
import { I18nBootstrap } from "../../src/components/I18nBootstrap";
import "../../src/styles.css";

const live = new URLSearchParams(location.search).get("live") === "1";
const thinking = new URLSearchParams(location.search).get("thinking") !== "0";

const blocks = [
  ...(thinking
    ? [
        {
          kind: "thinking" as const,
          text: "Checking Adzo's reference crops, I confirm all five show her face clearly against neutral backgrounds, but I'll exclude #1 since the Santa hat would bleed into her look — using #2 through #5 instead. Now I need to work through Aki's four new reference videos in Downloads.\n\nI'll probe them first for duration, resolution, and orientation, then build frame sheets to see what's actually in them — talking, walking, wardrobe, background — since that determines how to trim them for the reference-to-video budget.",
          durationMs: 12000,
        },
      ]
    : []),
  {
    kind: "text" as const,
    text: "I'll probe the four reference videos and pull frames to see what's in each before trimming them. Also, for Adzo's crops I'm dropping #1 (Santa hat, too intrusive) and keeping #2–#5, which are clean.",
  },
  {
    kind: "steps" as const,
    steps: [
      { label: "Shell", count: 1 },
      { label: "Read file", count: 4 },
    ],
    durationMs: 8000,
  },
  ...(thinking
    ? [
        {
          kind: "thinking" as const,
          text: 'I need to look at the four frame sheets (v1–v4) to figure out what each video actually shows — wardrobe, motion, background, and whether Aki is genuinely on camera. V1 seems like a music-only b-roll, v2 sounds like a screen-recorded tutorial, v3 appears mostly silent, and v4 has him talking about "AI slop" designs.',
          durationMs: 6000,
        },
      ]
    : []),
  ...(live
    ? [
        { kind: "steps" as const, steps: [{ label: "Read file", count: 1 }] },
        { kind: "progress" as const, text: "" },
      ]
    : [
        {
          kind: "text" as const,
          text: "**v2** is gold: it's the exact black turtleneck wardrobe requested, plus natural talking, hand gestures, and head turns. I'll trim it to the first 12 seconds and use it as the primary motion reference.",
        },
      ]),
];

function Preview() {
  const entries = groupNarrationBlocks(blocks);
  const trailingActivity = entries.reduce(
    (found, entry, index) =>
      entry.kind === "activity" ||
      (entry.kind === "prose" && entry.block.kind === "progress" && !entry.block.text)
        ? found
        : index,
    -1,
  );
  return (
    <div className="mx-auto max-w-[860px] px-6 py-10 font-sans">
      <div className="flex justify-end pb-9">
        <div className="max-w-[74%] rounded-[20px] bg-[#1F1F23] px-[18px] py-3 text-[15.5px] leading-[1.5] text-[#ECECEE]">
          here are 4 reference videos of me to go along with the clips you have
        </div>
      </div>
      <div
        data-testid="narration"
        className="rk-narration w-full min-w-0 space-y-4 text-[15.5px] leading-[1.6] text-[#DFDFE2]"
      >
        {entries.map((entry, i) => {
          if (entry.kind === "activity") {
            return (
              <ActivityTimeline key={i} items={entry.items} live={live && i > trailingActivity} />
            );
          }
          if (!entry.block.text) return null;
          return (
            <div key={i} className={isInterimProse(entries, i) ? "rk-tl-interim" : undefined}>
              <ChatMarkdown streaming={entry.block.kind === "progress"}>
                {entry.block.text}
              </ChatMarkdown>
            </div>
          );
        })}
        {live ? (
          <LiveStatusLine startedAt={new Date(Date.now() - 193_000).toISOString()} name="Chief" />
        ) : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nBootstrap>
    <Preview />
  </I18nBootstrap>,
);
