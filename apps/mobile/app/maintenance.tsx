import type { MaintenanceJob, Me } from "@rakazo/contracts";
import {
  MaintenanceController,
  maintenanceCanApprove,
  maintenanceUpdateAdvice,
} from "@rakazo/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { rpc } from "../lib/api";
import { native } from "../lib/native";

const requestKey = () => `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function Maintenance() {
  const [owner, setOwner] = useState<boolean | null>(null);
  useEffect(() => {
    void rpc<Me>("me")
      .then((me) => setOwner(me.isDeploymentOwner))
      .catch(() => setOwner(false));
  }, []);
  if (owner === null) return <ActivityIndicator accessibilityLabel="Loading maintenance" />;
  if (!owner)
    return (
      <Text accessibilityRole="alert" style={{ color: native.label, padding: 20 }}>
        Maintenance is restricted to the deployment owner.
      </Text>
    );
  return <MaintenanceContent />;
}

function MaintenanceContent() {
  const params = useLocalSearchParams<{ runId?: string }>();
  const controller = useMemo(
    () =>
      new MaintenanceController({
        list: () => rpc("maintenance/list"),
        create: (input) => rpc("maintenance/create", input),
        approve: (input) => rpc("maintenance/approve", input),
        cancel: (input) => rpc("maintenance/cancel", input),
      }),
    [],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [issue, setIssue] = useState("");
  const [runId, setRunId] = useState(
    typeof params.runId === "string" && params.runId.length <= 200 ? params.runId : "",
  );
  const [requestId, setRequestId] = useState(requestKey);
  const [diffId, setDiffId] = useState<string | null>(null);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  function approve(job: MaintenanceJob) {
    Alert.alert(
      job.simulated ? "Simulate release?" : "Deploy tested revision?",
      job.review?.revision,
      [
        { text: "Go back", style: "cancel" },
        {
          text: "Approve",
          onPress: () => {
            void controller.approve(job);
          },
        },
      ],
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
      <Text style={{ color: native.label, fontSize: 22 }}>Maintenance Agent</Text>
      <Action label="Refresh" onPress={() => void controller.refresh()} />
      {state.loading ? <ActivityIndicator accessibilityLabel="Loading jobs" /> : null}
      {state.error ? (
        <Text accessibilityRole="alert" style={{ color: "#F3A59B" }}>
          {state.error}
        </Text>
      ) : null}
      {state.data ? (
        <>
          {state.data.mode !== "connected" ? (
            <Text style={{ color: native.secondaryLabel }}>
              {state.data.mode === "test"
                ? "Test adapter · simulated investigation and release"
                : "Workspace and release integration is not connected. Issues will be saved for later."}
            </Text>
          ) : null}
          <TextInput
            editable={!state.pending}
            accessibilityLabel="Bug or improvement"
            placeholder="Bug or improvement"
            placeholderTextColor={native.secondaryLabel}
            multiline
            maxLength={8000}
            value={issue}
            onChangeText={(text) => {
              setIssue(text);
              setRequestId(requestKey());
            }}
            style={{
              color: native.label,
              borderColor: "#303034",
              borderWidth: 1,
              borderRadius: 12,
              padding: 14,
              minHeight: 120,
            }}
          />
          <TextInput
            editable={!state.pending}
            accessibilityLabel="Run ID (optional)"
            placeholder="Run ID (optional)"
            placeholderTextColor={native.secondaryLabel}
            value={runId}
            maxLength={200}
            onChangeText={(text) => {
              setRunId(text);
              setRequestId(requestKey());
            }}
            style={{ color: native.label, padding: 12 }}
          />
          <Action
            label="Submit issue"
            disabled={!issue.trim() || state.pending}
            onPress={() =>
              void controller
                .create({ issue, requestId, ...(runId.trim() ? { runId: runId.trim() } : {}) })
                .then((ok) => {
                  if (ok) {
                    setIssue("");
                    setRunId("");
                    setRequestId(requestKey());
                  }
                })
            }
          />
          {state.data.jobs.map((job) => (
            <View
              key={job.id}
              style={{ gap: 12, padding: 16, borderRadius: 16, backgroundColor: native.fill }}
            >
              <Text selectable style={{ color: native.label, fontWeight: "600" }}>
                {job.issue}
              </Text>
              <Text style={{ color: native.secondaryLabel }}>
                {job.status} · {job.message}
              </Text>
              {job.review ? (
                <>
                  <Text selectable style={{ color: native.secondaryLabel }}>
                    {job.review.branch}
                    {"\n"}
                    {job.review.revision}
                  </Text>
                  <Action
                    label={diffId === job.id ? "Hide diff" : "Review diff"}
                    onPress={() => setDiffId(diffId === job.id ? null : job.id)}
                  />
                  {diffId === job.id ? (
                    <ScrollView horizontal>
                      <Text
                        selectable
                        style={{ color: native.label, fontFamily: "monospace", fontSize: 12 }}
                      >
                        {job.review.diff}
                      </Text>
                    </ScrollView>
                  ) : null}
                  {job.review.checks.map((check, index) => (
                    <Text key={`${index}:${check.name}`} style={{ color: native.label }}>
                      {check.passed ? "Passed" : "Failed"} · {check.name}
                    </Text>
                  ))}
                  {job.review.release ? (
                    <Text selectable style={{ color: native.secondaryLabel, fontSize: 12 }}>
                      Release manifest{"\n"}
                      {job.review.release.manifestHash}
                    </Text>
                  ) : null}
                  <Text style={{ color: native.label }}>{job.review.previewSummary}</Text>
                  {job.review.previewUrl ? (
                    <Action
                      label="Open private preview"
                      onPress={() =>
                        void Linking.openURL(job.review!.previewUrl!).catch(() =>
                          Alert.alert("Preview unavailable"),
                        )
                      }
                    />
                  ) : null}
                  {maintenanceCanApprove(job) ? (
                    <Action
                      label={
                        job.simulated ? "Approve simulated release" : "Approve tested revision"
                      }
                      disabled={state.pending}
                      onPress={() => approve(job)}
                    />
                  ) : null}
                </>
              ) : null}
              {job.status === "completed" ? (
                <Text style={{ color: native.secondaryLabel }}>{maintenanceUpdateAdvice(job)}</Text>
              ) : null}
              {["queued", "investigating", "review", "blocked", "failed"].includes(job.status) ? (
                <Action
                  label="Cancel job"
                  disabled={state.pending}
                  onPress={() => void controller.cancel(job.id)}
                />
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 10, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: "#C4B5FD" }}>{label}</Text>
    </Pressable>
  );
}
