import type { Run, RunDiagnostics } from "@rakazo/contracts";
import { RunLogsController } from "@rakazo/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from "react-native";
import { rpc } from "../lib/api";

export default function RunLogs() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const controller = useMemo(
    () =>
      new RunLogsController(botId, {
        history: (input) => rpc<{ runs: Run[] }>("runs/history", input),
        diagnostics: (input) => rpc<RunDiagnostics>("runs/diagnostics", input),
      }),
    [botId],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  const data = state.data;
  const [choosingRun, setChoosingRun] = useState(false);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void controller.refresh()}
          style={{ paddingVertical: 12 }}
        >
          <Text style={{ color: "#C4B5FD" }}>Refresh</Text>
        </Pressable>
        {data ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void Share.share({ message: JSON.stringify(data, null, 2) }).catch(() => undefined)
            }
            style={{ paddingVertical: 12 }}
          >
            <Text style={{ color: "#C4B5FD" }}>Share diagnostics</Text>
          </Pressable>
        ) : null}
      </View>
      {state.loading ? <ActivityIndicator accessibilityLabel="Loading run logs" /> : null}
      {state.error ? (
        <Text accessibilityRole="alert" style={{ color: "#F3A59B" }}>
          {state.error}
        </Text>
      ) : null}
      {!state.loading && !state.runs.length && !state.error ? (
        <Text style={{ color: "#ECECEE" }}>No runs yet.</Text>
      ) : null}
      {state.runs.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: choosingRun }}
          onPress={() => setChoosingRun(!choosingRun)}
          style={{ paddingVertical: 12 }}
        >
          <Text style={{ color: "#C4B5FD" }}>
            {data
              ? `${new Date(data.run.createdAt).toLocaleString()} · ${data.run.trigger}`
              : "Choose run"}{" "}
            ▾
          </Text>
        </Pressable>
      ) : null}
      {choosingRun
        ? state.runs.map((run) => (
            <Pressable
              key={run.id}
              accessibilityRole="button"
              accessibilityState={{ selected: state.selectedId === run.id }}
              onPress={() => {
                controller.select(run.id);
                setChoosingRun(false);
              }}
              style={{
                padding: 12,
                borderRadius: 12,
                backgroundColor: state.selectedId === run.id ? "#282034" : "#17171A",
              }}
            >
              <Text style={{ color: "#ECECEE" }}>
                {new Date(run.createdAt).toLocaleString()} · {run.trigger} · {run.status}
              </Text>
            </Pressable>
          ))
        : null}
      {data ? (
        <>
          <Text selectable style={{ color: "#ECECEE" }}>
            Run ID: {data.run.id}
            {"\n"}
            {data.run.modelProvider} / {data.run.modelId}
            {"\n"}
            {data.run.status}
          </Text>
          {data.run.error ? (
            <Text selectable style={{ color: "#F3A59B" }}>
              {data.run.error}
              {"\n"}Failure stage: {data.failure?.stage ?? "unknown"}
            </Text>
          ) : null}
          <Text style={{ color: "#A8A8AD" }}>Attempts: {data.attempts.length}</Text>
          <Text style={{ color: "#A8A8AD" }}>
            Started: {data.run.startedAt ? new Date(data.run.startedAt).toLocaleString() : "—"}
            {"\n"}Finished:{" "}
            {data.run.completedAt ? new Date(data.run.completedAt).toLocaleString() : "—"}
          </Text>
          {data.olderCursor !== null ? (
            <Pressable
              accessibilityRole="button"
              disabled={state.loadingOlder}
              onPress={() => void controller.loadOlder()}
              style={{ paddingVertical: 12 }}
            >
              <Text style={{ color: "#C4B5FD" }}>Load earlier events</Text>
            </Pressable>
          ) : null}
          {data.events.map((event) => (
            <View
              key={event.id}
              style={{ borderBottomWidth: 1, borderColor: "#26262A", paddingBottom: 10, gap: 4 }}
            >
              <Text style={{ color: "#A8A8AD" }}>
                {new Date(event.createdAt).toLocaleTimeString()}
              </Text>
              <Text selectable style={{ color: event.status === "failed" ? "#F3A59B" : "#ECECEE" }}>
                {event.tool ?? event.type}
                {event.tool ? ` · ${event.status ?? "started"}` : ""}
                {event.durationMs === null ? "" : ` · ${(event.durationMs / 1000).toFixed(1)}s`}
              </Text>
            </View>
          ))}
          <Text style={{ color: "#A8A8AD" }}>
            Diagnostics exclude prompts, credentials, tool inputs and outputs.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}
