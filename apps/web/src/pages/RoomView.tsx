import type { Bot, RoomSnapshot, ThreadMessage } from "@rakazo/contracts";
import { BotAvatar } from "@rakazo/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

/**
 * A room reads as one conversation with several speakers, so every message
 * carries who said it — the way a group chat does, rather than the two-sided
 * bubbles a direct thread uses.
 */
export function RoomView({
  roomId,
  bots,
  onClose,
}: {
  roomId: string;
  bots: Bot[];
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const botById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const participants = useMemo(
    () => (snapshot?.room.botIds ?? []).flatMap((id) => botById.get(id) ?? []),
    [botById, snapshot?.room.botIds],
  );

  const refresh = useCallback(async () => {
    const next = await rpc.rooms.snapshot({ roomId }).catch(() => null);
    if (next) setSnapshot(next);
  }, [roomId]);

  useEffect(() => {
    void refresh();
    // Rooms wake several bots at once, so poll while anyone is still working.
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [snapshot?.messages.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await rpc.rooms.send({ roomId, text });
      setDraft("");
      if (result.woke.length === 0 && text.includes("@")) {
        setNotice("Nobody was woken — check the name matches a bot in this room.");
      }
      if (result.queued.length > 0) {
        const names = result.queued.map((botId) => botById.get(botId)?.name ?? "a bot").join(", ");
        setNotice(`${names} will follow once the bot before them is done.`);
      }
      if (result.refused.length > 0) {
        const names = result.refused
          .map((entry) => botById.get(entry.botId)?.name ?? "a bot")
          .join(", ");
        setNotice(`Held back: ${names}.`);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  const running = new Set(snapshot?.runningBotIds ?? []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
      <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[15px]">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-medium text-[#ECECEE]">
            {snapshot?.room.name ?? "Room"}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-[#6E6975]">
            {participants.map((bot) => bot.name).join(" · ") || "No bots yet"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {participants.map((bot) => (
              <span key={bot.id} title={bot.name} className="rounded-full ring-2 ring-[#0D0D0E]">
                <BotAvatar color={bot.color} size={26} />
              </span>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close room"
            onClick={onClose}
            className="text-[#85858A] hover:text-[#ECECEE]"
          >
            ✕
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="rk-scroll min-h-0 flex-1 overflow-y-auto px-[22px] py-5">
        {(snapshot?.messages ?? []).map((message) => (
          <RoomMessage key={message.id} message={message} botById={botById} />
        ))}
        {participants
          .filter((bot) => running.has(bot.id))
          .map((bot) => (
            <div key={`working-${bot.id}`} className="mb-4 flex items-center gap-2.5">
              <BotAvatar color={bot.color} size={26} />
              <span className="text-[13px] text-[#6E6975]">{bot.name}</span>
              <span
                className="text-[13px] text-[#6E6975]"
                style={{ animation: "rkPulse 1.6s ease-in-out infinite" }}
              >
                · working
              </span>
            </div>
          ))}
      </div>

      <div className="border-t border-[#141416] px-[22px] py-4">
        {notice ? <p className="mb-2 text-[12.5px] text-[#E8A33C]">{notice}</p> : null}
        <div className="flex items-end gap-2.5 rounded-[18px] border border-[#202023] bg-[#131315] px-4 py-2.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Give the room an objective, or @name a bot"
            className="max-h-[160px] min-h-[24px] flex-1 resize-none bg-transparent text-[15px] text-[#ECECEE] outline-none placeholder:text-[#5F5B69]"
          />
          <button
            type="button"
            disabled={!draft.trim() || sending}
            onClick={() => void send()}
            className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#F1F1EF] text-[#17171A] disabled:opacity-40"
          >
            ↑
          </button>
        </div>
        <p className="mt-2 text-[12px] text-[#5F5B69]">
          Mention a bot by name to bring it in. Bots hand work to each other the same way.
        </p>
      </div>
    </div>
  );
}

function RoomMessage({ message, botById }: { message: ThreadMessage; botById: Map<string, Bot> }) {
  const author = message.authorBotId ? botById.get(message.authorBotId) : undefined;
  const text = message.blocks
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
  if (!text.trim()) return null;

  // The room speaking for itself — a refused handoff, a pause — is a notice,
  // not a turn, so it gets no author and sits quietly between the speakers.
  if (message.role === "system") {
    return <div className="mb-5 pl-[30px] text-[12.5px] italic text-[#8A8590]">{text}</div>;
  }

  // A handoff is worth showing as its own beat, so the room reads as a chain
  // of ownership rather than a wall of chat.
  const handoffTo = author
    ? [...botById.values()].filter(
        (bot) => bot.id !== author.id && text.toLowerCase().includes(`@${bot.name.toLowerCase()}`),
      )
    : [];

  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center gap-2">
        {author ? (
          <BotAvatar color={author.color} size={22} />
        ) : (
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#26262A] text-[10px] text-[#C9C9CE]">
            you
          </span>
        )}
        <span className="text-[13px] font-medium text-[#C9C9CE]">{author?.name ?? "You"}</span>
      </div>
      <div className="pl-[30px] text-[15px] leading-[1.55] whitespace-pre-wrap text-[#DFDFE2]">
        {text}
      </div>
      {handoffTo.length > 0 ? (
        <div className="mt-1.5 pl-[30px] text-[12.5px] text-[#A855F7]">
          ↳ handed to {handoffTo.map((bot) => bot.name).join(", ")}
        </div>
      ) : null}
    </div>
  );
}
