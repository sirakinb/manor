import type { CrmOverview } from "@rakazo/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { CrmContacts } from "../components/crm-contacts";
import { CrmHome } from "../components/crm-home";
import { Segmented } from "../components/crm-kit";
import { CrmPipeline } from "../components/crm-pipeline";
import { rpc } from "../lib/api";
import { ALL_PIPELINES } from "../lib/crm";
import { manor } from "../lib/native";

type Tab = "home" | "pipeline" | "contacts";

export default function Crm() {
  const [overview, setOverview] = useState<CrmOverview | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [pipelineId, setPipelineId] = useState<string>(ALL_PIPELINES);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await rpc<CrmOverview>("crm/overview");
      // A first visit gets a ready board instead of an empty screen.
      setOverview(
        next.pipelines.length === 0 ? await rpc<CrmOverview>("crm/pipelines/seed") : next,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the CRM");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: manor.danger, textAlign: "center" }}>{error}</Text>
      </View>
    );
  }

  if (!overview) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={manor.muted} />
      </View>
    );
  }

  // The pipeline board needs a single pipeline; the dashboard can span them all.
  const boardPipelineId =
    pipelineId === ALL_PIPELINES ? (overview.pipelines[0]?.id ?? "") : pipelineId;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: 14 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={manor.muted}
        />
      }
    >
      <View style={{ marginBottom: 16 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: "home", label: "Home" },
            { key: "pipeline", label: "Pipeline" },
            { key: "contacts", label: "Contacts" },
          ]}
        />
      </View>

      {tab === "home" ? (
        <CrmHome overview={overview} pipelineId={pipelineId} onPipelineChange={setPipelineId} />
      ) : null}
      {tab === "pipeline" ? (
        <CrmPipeline
          overview={overview}
          pipelineId={boardPipelineId}
          onPipelineChange={setPipelineId}
          onChanged={load}
        />
      ) : null}
      {tab === "contacts" ? <CrmContacts overview={overview} onChanged={load} /> : null}
    </ScrollView>
  );
}
