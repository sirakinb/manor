import { useLingui } from "@lingui/react/macro";
import type {
  WorkspaceChannel,
  WorkspaceOverview,
  WorkspacePipeStatus,
  WorkspaceTeamWorker,
} from "@rakazo/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { accentColor } from "../../lib/brand";
import { formatAgo, formatNumber, PIPE_COLORS, type SectionKey, withAlpha } from "./bits";

/**
 * A source node's title: the row name when it is already a proper name
 * ("Instagram", "Zoho Campaigns"), otherwise the pipe's registry label
 * ("buildium" → "Buildium API"), and never a lowercase vendor slug.
 */
function sourceTitle(name: string, label: string | undefined): string {
  if (/[A-Z]/.test(name)) return name;
  return label ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/* The client's live pipeline map: sources on the left feed the vault in the
   middle, the vault feeds one node per channel, and each channel hands off to
   the AI worker that runs it. Edges animate with the pipe's freshness. The
   viewBox is computed from the tallest column and the SVG scales to fill
   whatever pane it is given. Hand placed columns, no layout engine. */

const NODE_W = 200;
const NODE_H = 58;
const VAULT_W = 256;
const VAULT_H = 128;
const MIN_ROW = 72;
const MAX_ROW = 124;
const PAD_TOP = 30;
const PAD_BOTTOM = 12;
const COL_X = {
  source: 16,
  vault: 16 + NODE_W + 112,
  channel: 16 + NODE_W + 112 + VAULT_W + 112,
  worker: 16 + NODE_W + 112 + VAULT_W + 112 + NODE_W + 96,
} as const;
const WIDTH = COL_X.worker + NODE_W + 16;

const STATUS_RANK: Record<WorkspacePipeStatus, number> = {
  failing: 3,
  overdue: 2,
  flowing: 1,
  idle: 0,
};

function worst(a: WorkspacePipeStatus | undefined, b: WorkspacePipeStatus): WorkspacePipeStatus {
  if (!a) return b;
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

const WORKER_STATUS_AS_PIPE: Record<WorkspaceTeamWorker["status"], WorkspacePipeStatus> = {
  working: "flowing",
  fresh: "flowing",
  catching_up: "overdue",
  setting_up: "idle",
};

type MapNode = {
  id: string;
  kind: "source" | "vault" | "channel" | "worker";
  title: string;
  subtitle: string;
  freshness: string | null;
  status: WorkspacePipeStatus;
  x: number;
  y: number;
  w: number;
  h: number;
  section: SectionKey;
};

type MapEdge = { key: string; d: string; status: WorkspacePipeStatus; thin?: boolean };

export function PipelineMap({
  overview,
  onOpen,
}: {
  overview: WorkspaceOverview;
  onOpen: (section: SectionKey) => void;
}) {
  const { t, i18n } = useLingui();
  const [hovered, setHovered] = useState<string | null>(null);
  // The container's aspect ratio decides how far apart the rows sit, so the
  // tallest column fills the pane instead of leaving a band of slack.
  const boxRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const channelLabel = (channel: WorkspaceChannel): string =>
    channel === "voice"
      ? t`Voice`
      : channel === "email"
        ? t`Email`
        : channel === "social"
          ? t`Social`
          : channel === "leasing"
            ? t`Leasing`
            : t`Utilities`;

  const { nodes, edges, height, vaultCounts } = useMemo(() => {
    const syncedLabel = (iso: string | null) =>
      iso ? t`Synced ${formatAgo(iso, i18n.locale)}` : t`Not synced yet`;
    const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

    // Source nodes: every registered row, plus one synthetic node per external
    // pipe that has no row. Internal pipes (recaps over vault data) get none.
    type SourceNode = {
      key: string;
      name: string;
      sourceType: string | null;
      lastAt: string | null;
      rowStatus: string | null;
    };
    const sourceList: SourceNode[] = overview.sources.map((source) => ({
      key: source.id,
      name: source.name,
      sourceType: source.sourceType,
      lastAt: source.lastSyncedAt,
      rowStatus: source.status,
    }));
    const sourceKeyForPipe = new Map<string, string | null>();
    const sourceLabel = new Map<string, string>();
    for (const pipe of overview.pipes) {
      if (pipe.internal) {
        sourceKeyForPipe.set(pipe.key, null);
        continue;
      }
      const registered = pipe.sourceId
        ? overview.sources.find((source) => source.id === pipe.sourceId)
        : undefined;
      if (registered) {
        sourceKeyForPipe.set(pipe.key, registered.id);
        if (!sourceLabel.has(registered.id)) sourceLabel.set(registered.id, pipe.source);
        continue;
      }
      const key = `pipe:${pipe.key}`;
      sourceList.push({ key, name: pipe.source, sourceType: null, lastAt: null, rowStatus: null });
      sourceKeyForPipe.set(pipe.key, key);
    }

    const sourceStatus = new Map<string, WorkspacePipeStatus>();
    const sourceLastAt = new Map<string, string | null>();
    const sourceChannels = new Map<string, WorkspaceChannel[]>();
    const channelStatus = new Map<WorkspaceChannel, WorkspacePipeStatus>();
    const channelLastAt = new Map<WorkspaceChannel, string | null>();
    const newer = (current: string | null | undefined, candidate: string | null) =>
      !current || (candidate && candidate > current) ? (candidate ?? current ?? null) : current;
    for (const pipe of overview.pipes) {
      channelStatus.set(pipe.channel, worst(channelStatus.get(pipe.channel), pipe.status));
      channelLastAt.set(pipe.channel, newer(channelLastAt.get(pipe.channel), pipe.lastAt));
      const sourceKey = sourceKeyForPipe.get(pipe.key);
      if (!sourceKey) continue;
      sourceStatus.set(sourceKey, worst(sourceStatus.get(sourceKey), pipe.status));
      sourceLastAt.set(sourceKey, newer(sourceLastAt.get(sourceKey), pipe.lastAt));
      const fed = sourceChannels.get(sourceKey) ?? [];
      if (!fed.includes(pipe.channel)) fed.push(pipe.channel);
      sourceChannels.set(sourceKey, fed);
    }

    const channels = overview.workspace.channels;
    const workers = overview.team;
    const rows = Math.max(sourceList.length, channels.length, workers.length, 2);
    const wanted = aspect ? WIDTH / aspect - PAD_TOP - PAD_BOTTOM : 0;
    const ROW = Math.min(MAX_ROW, Math.max(MIN_ROW, wanted / rows));
    const height = PAD_TOP + rows * ROW + PAD_BOTTOM;
    const centreY = PAD_TOP + (rows * ROW) / 2;
    const rowY = (index: number, total: number) => centreY - (total * ROW) / 2 + index * ROW + 7;

    const nodes: MapNode[] = [];
    sourceList.forEach((source, index) => {
      const fed = sourceChannels.get(source.key) ?? [];
      const subtitle =
        fed.length > 0
          ? fed.map(channelLabel).join(" · ")
          : source.sourceType
            ? capitalise(source.sourceType)
            : t`Source`;
      nodes.push({
        id: `source:${source.name}`,
        kind: "source",
        title: sourceTitle(source.name, sourceLabel.get(source.key)),
        subtitle,
        freshness: syncedLabel(source.lastAt ?? sourceLastAt.get(source.key) ?? null),
        status: sourceStatus.get(source.key) ?? (source.rowStatus === "error" ? "failing" : "idle"),
        x: COL_X.source,
        y: rowY(index, sourceList.length),
        w: NODE_W,
        h: NODE_H,
        section: "system",
      });
    });
    const sourceNodeByKey = new Map(sourceList.map((source, index) => [source.key, nodes[index]!]));

    const vaultStatus = overview.pipes.reduce<WorkspacePipeStatus>(
      (acc, pipe) => worst(acc, pipe.status),
      "idle",
    );
    const newestPipe = overview.pipes.reduce<string | null>(
      (acc, pipe) => newer(acc, pipe.lastAt),
      null,
    );
    const vault: MapNode = {
      id: "vault",
      kind: "vault",
      title: overview.workspace.name,
      subtitle: t`Data vault`,
      freshness: newestPipe ? t`Updated ${formatAgo(newestPipe, i18n.locale)}` : null,
      status: vaultStatus,
      x: COL_X.vault,
      y: centreY - VAULT_H / 2,
      w: VAULT_W,
      h: VAULT_H,
      section: "system",
    };
    nodes.push(vault);

    const channelNode = new Map<WorkspaceChannel, MapNode>();
    channels.forEach((channel, index) => {
      const node: MapNode = {
        id: `channel:${channel}`,
        kind: "channel",
        title: channelLabel(channel),
        subtitle: t`Channel`,
        freshness: syncedLabel(channelLastAt.get(channel) ?? null),
        status: channelStatus.get(channel) ?? "idle",
        x: COL_X.channel,
        y: rowY(index, channels.length),
        w: NODE_W,
        h: NODE_H,
        section: channel,
      };
      channelNode.set(channel, node);
      nodes.push(node);
    });

    const workerNodes = workers.map((worker, index) => {
      const node: MapNode = {
        id: `worker:${worker.key}`,
        kind: "worker",
        title: worker.name,
        subtitle: worker.role,
        freshness: worker.lastAt
          ? t`Active ${formatAgo(worker.lastAt, i18n.locale)}`
          : t`Setting up`,
        status: WORKER_STATUS_AS_PIPE[worker.status],
        x: COL_X.worker,
        y: rowY(index, workers.length),
        w: NODE_W,
        h: NODE_H,
        section: "team",
      };
      nodes.push(node);
      return { worker, node };
    });

    const edges: MapEdge[] = [];
    const vaultIn = { x: vault.x, y: vault.y + VAULT_H / 2 };
    const vaultOut = { x: vault.x + VAULT_W, y: vault.y + VAULT_H / 2 };
    for (const source of sourceList) {
      const node = sourceNodeByKey.get(source.key)!;
      edges.push({
        key: `s:${source.key}`,
        d: edgePath(node.x + NODE_W, node.y + NODE_H / 2, vaultIn.x, vaultIn.y),
        status: sourceStatus.get(source.key) ?? "idle",
      });
    }
    for (const channel of channels) {
      const node = channelNode.get(channel)!;
      const external = overview.pipes.filter((pipe) => pipe.channel === channel && !pipe.internal);
      const internal = overview.pipes.filter((pipe) => pipe.channel === channel && pipe.internal);
      if (external.length > 0 || internal.length === 0) {
        edges.push({
          key: `c:${channel}`,
          d: edgePath(vaultOut.x, vaultOut.y, node.x, node.y + NODE_H / 2),
          status: external.reduce<WorkspacePipeStatus>(
            (acc, pipe) => worst(acc, pipe.status),
            "idle",
          ),
        });
      }
      if (internal.length > 0) {
        // Recaps run on vault data: a second, thinner edge slightly below the main one.
        const offset = external.length > 0 ? 9 : 0;
        edges.push({
          key: `i:${channel}`,
          d: edgePath(vaultOut.x, vaultOut.y + offset, node.x, node.y + NODE_H / 2 + offset),
          status: internal.reduce<WorkspacePipeStatus>(
            (acc, pipe) => worst(acc, pipe.status),
            "idle",
          ),
          thin: true,
        });
      }
    }
    for (const { worker, node } of workerNodes) {
      const from = channelNode.get(worker.channel);
      if (!from) continue;
      edges.push({
        key: `w:${worker.key}`,
        d: edgePath(from.x + NODE_W, from.y + NODE_H / 2, node.x, node.y + NODE_H / 2),
        status: WORKER_STATUS_AS_PIPE[worker.status],
        thin: true,
      });
    }

    // What the vault holds, in the client's words: up to three row counts.
    const vaultCounts: string[] = [];
    if (overview.voice) vaultCounts.push(t`${formatNumber(overview.voice.calls30d)} calls · 30d`);
    if (overview.email)
      vaultCounts.push(t`${formatNumber(overview.email.campaignsTotal)} campaigns`);
    if (overview.leasing)
      vaultCounts.push(t`${formatNumber(overview.leasing.activeLeases)} leases`);
    if (vaultCounts.length < 3 && overview.social?.followers != null)
      vaultCounts.push(t`${formatNumber(overview.social.followers)} followers`);
    if (vaultCounts.length < 3 && overview.utilities)
      vaultCounts.push(t`${formatNumber(overview.utilities.billsThisMonth)} bills · month`);

    return { nodes, edges, height, vaultCounts: vaultCounts.slice(0, 3) };
  }, [overview, t, i18n.locale, aspect]);

  const columnLabels: Array<{ x: number; label: string }> = [
    { x: COL_X.source, label: t`Sources` },
    { x: COL_X.vault, label: t`Vault` },
    { x: COL_X.channel, label: t`Channels` },
    { x: COL_X.worker, label: t`AI team` },
  ];

  return (
    <div ref={boxRef} className="h-full min-h-0 w-full" data-testid="workspace-map">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="block h-full w-full"
        preserveAspectRatio="xMidYMin meet"
        role="img"
        aria-label={t`Pipeline map`}
      >
        {columnLabels.map((column) => (
          <text
            key={column.label}
            x={column.x}
            y={14}
            fontSize="10.5"
            fontWeight="600"
            letterSpacing="0.09em"
            fill="#6E6975"
            style={{ textTransform: "uppercase" }}
          >
            {column.label}
          </text>
        ))}

        {edges.map((edge) => {
          const color = PIPE_COLORS[edge.status];
          const animated = edge.status !== "idle";
          return (
            <g key={edge.key}>
              <path d={edge.d} fill="none" stroke="#1F1F23" strokeWidth={edge.thin ? 1.5 : 2.5} />
              <path
                d={edge.d}
                fill="none"
                stroke={color}
                strokeWidth={edge.thin ? 1.5 : 2}
                strokeLinecap="round"
                strokeDasharray={animated ? "6 10" : undefined}
                className={animated ? `rk-pipe rk-pipe-${edge.status}` : undefined}
                opacity={animated ? 0.95 : 0.7}
              />
            </g>
          );
        })}

        {nodes.map((node) => {
          const color = PIPE_COLORS[node.status];
          const isVault = node.kind === "vault";
          const active = hovered === node.id;
          const subtitle = active && node.freshness ? node.freshness : node.subtitle;
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG nodes cannot be <button>; the group carries the button role, focus, and key handling
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={node.freshness ? `${node.title}. ${node.freshness}` : node.title}
              data-node={node.id}
              transform={`translate(${node.x} ${node.y})`}
              className="rk-map-node cursor-pointer outline-none"
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered((current) => (current === node.id ? null : current))}
              onFocus={() => setHovered(node.id)}
              onBlur={() => setHovered((current) => (current === node.id ? null : current))}
              onClick={() => onOpen(node.section)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(node.section);
                }
              }}
            >
              <title>{node.freshness ? `${node.title} — ${node.freshness}` : node.title}</title>
              {active ? (
                <rect
                  x={-3}
                  y={-3}
                  width={node.w + 6}
                  height={node.h + 6}
                  rx={isVault ? 19 : 15}
                  fill="none"
                  stroke={withAlpha(accentColor, 0.4)}
                  strokeWidth={3}
                />
              ) : null}
              <rect
                width={node.w}
                height={node.h}
                rx={isVault ? 16 : 12}
                fill={
                  isVault
                    ? withAlpha(accentColor, active ? 0.16 : 0.1)
                    : active
                      ? "#1A1A1D"
                      : "#131315"
                }
                stroke={active ? color : isVault ? withAlpha(accentColor, 0.45) : "#26262A"}
                strokeWidth={active || isVault ? 1.5 : 1}
              />
              {isVault ? (
                <>
                  <VaultGlyph x={16} y={VAULT_H / 2 - 18} color={accentColor} size={36} />
                  <text x={64} y={32} fontSize="14" fontWeight="600" fill="#ECECEE">
                    {truncate(node.title, 24)}
                  </text>
                  <text x={64} y={49} fontSize="11" fill="#85858A">
                    {truncate(subtitle, 30)}
                  </text>
                  {vaultCounts.map((line, index) => (
                    <text
                      key={line}
                      x={64}
                      y={72 + index * 16}
                      fontSize="11.5"
                      fill="#C9C9CE"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {line}
                    </text>
                  ))}
                </>
              ) : (
                <>
                  <circle cx={18} cy={node.h / 2} r={4} fill={color} />
                  {node.status !== "idle" ? (
                    <circle
                      cx={18}
                      cy={node.h / 2}
                      r={7.5}
                      fill="none"
                      stroke={color}
                      strokeWidth={1}
                      opacity={0.35}
                    />
                  ) : null}
                  <text x={34} y={node.h / 2 - 3} fontSize="13.5" fontWeight="600" fill="#ECECEE">
                    {truncate(node.title, 22)}
                  </text>
                  <text x={34} y={node.h / 2 + 14} fontSize="11" fill="#85858A">
                    {truncate(subtitle, 28)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A small database cylinder. */
export function VaultGlyph({
  x,
  y,
  color,
  size = 44,
}: {
  x: number;
  y: number;
  color: string;
  size?: number;
}) {
  const w = size;
  const h = size;
  const ry = w * 0.16;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M 0 ${ry} v ${h - ry * 2} a ${w / 2} ${ry} 0 0 0 ${w} 0 v ${-(h - ry * 2)}`}
        fill={withAlpha(color, 0.18)}
        stroke={color}
        strokeWidth="1.5"
      />
      <ellipse
        cx={w / 2}
        cy={ry}
        rx={w / 2}
        ry={ry}
        fill={withAlpha(color, 0.35)}
        stroke={color}
        strokeWidth="1.5"
      />
      <path
        d={`M 0 ${h / 2} a ${w / 2} ${ry} 0 0 0 ${w} 0`}
        fill="none"
        stroke={color}
        strokeWidth="1"
        opacity="0.6"
      />
    </g>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
