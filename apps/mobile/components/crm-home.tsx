import type { CrmOverview } from "@rakazo/contracts";
import { Text, View } from "react-native";
import {
  ALL_PIPELINES,
  formatMoney,
  formatMoneyShort,
  STATUS_COLORS,
  scopeOverview,
  stageBreakdown,
  summarize,
} from "../lib/crm";
import { manor } from "../lib/native";
import { Bar, Card, Empty, Label, Segmented } from "./crm-kit";

export function CrmHome({
  overview,
  pipelineId,
  onPipelineChange,
}: {
  overview: CrmOverview;
  pipelineId: string;
  onPipelineChange: (id: string) => void;
}) {
  const scope = scopeOverview(overview, pipelineId);
  const summary = summarize(scope);
  const stages = stageBreakdown(scope);

  const cards = [
    {
      label: "Total pipeline",
      value: formatMoney(summary.totalValue),
      detail: `${summary.dealCount} deal${summary.dealCount === 1 ? "" : "s"}`,
    },
    {
      label: "Won revenue",
      value: formatMoney(summary.wonValue),
      detail: `${summary.wonCount} closed`,
    },
    {
      label: "Open deals",
      value: String(summary.openCount),
      detail: `${formatMoney(summary.openValue)} in play`,
    },
    {
      label: "Avg deal size",
      value: formatMoney(summary.avgDeal),
      detail: `${overview.contacts.length} contact${overview.contacts.length === 1 ? "" : "s"}`,
    },
  ];

  const status = [
    { label: "Open", count: summary.openCount, color: STATUS_COLORS.open },
    { label: "Won", count: summary.wonCount, color: STATUS_COLORS.won },
    { label: "Lost", count: summary.lostCount, color: STATUS_COLORS.lost },
  ].filter((entry) => entry.count > 0);

  return (
    <View style={{ paddingBottom: 32 }}>
      {overview.pipelines.length > 1 ? (
        <View style={{ marginBottom: 16 }}>
          <Segmented
            value={pipelineId}
            onChange={onPipelineChange}
            options={[
              { key: ALL_PIPELINES, label: "All pipelines" },
              ...overview.pipelines.map((pipeline) => ({
                key: pipeline.id,
                label: pipeline.name,
              })),
            ]}
          />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {cards.slice(0, 2).map((card) => (
            <Metric key={card.label} {...card} />
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {cards.slice(2).map((card) => (
            <Metric key={card.label} {...card} />
          ))}
        </View>

        <Card style={{ marginTop: 6 }}>
          <Text style={styles.heading}>Value by stage</Text>
          {stages.length === 0 ? (
            <Empty>No stages yet</Empty>
          ) : (
            <View style={{ gap: 13, marginTop: 13 }}>
              {stages.map((stage) => (
                <View key={stage.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: manor.body, fontSize: 14, flex: 1 }} numberOfLines={1}>
                      {stage.name}
                    </Text>
                    <Text style={{ color: manor.muted, fontSize: 12.5 }}>
                      {stage.count} · {formatMoneyShort(stage.value)}
                    </Text>
                  </View>
                  <Bar share={stage.share} color={stage.color} />
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.heading}>Deals by status</Text>
          {status.length === 0 ? (
            <Empty>Nothing to chart yet</Empty>
          ) : (
            <View style={{ gap: 13, marginTop: 13 }}>
              {status.map((entry) => (
                <View key={entry.label} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: manor.body, fontSize: 14, flex: 1 }}>{entry.label}</Text>
                    <Text style={{ color: manor.muted, fontSize: 12.5 }}>{entry.count}</Text>
                  </View>
                  <Bar share={entry.count / summary.dealCount} color={entry.color} />
                </View>
              ))}
            </View>
          )}
        </Card>
      </View>
    </View>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <Label>{label}</Label>
      <Text style={{ color: manor.ink, fontSize: 23, fontWeight: "600", marginTop: 9 }}>
        {value}
      </Text>
      <Text style={{ color: manor.muted, fontSize: 12, marginTop: 2 }}>{detail}</Text>
    </Card>
  );
}

const styles = {
  heading: { color: manor.ink, fontSize: 14, fontWeight: "600" as const },
};
