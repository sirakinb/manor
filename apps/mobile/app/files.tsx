import { ChatMarkdown } from "@rakazo/chat-ui/native";
import {
  type ComputerStatus,
  WORKSPACE_FILE_MAX_BYTES,
  type WorkspaceEntry,
  type WorkspaceLocation,
  workspacePreviewType,
} from "@rakazo/contracts";
import { WorkspaceFilesController } from "@rakazo/core";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { rpc } from "../lib/api";

const inputStyle = {
  color: "#ECECEE",
  backgroundColor: "#17171A",
  borderColor: "#343438",
  borderWidth: 1,
  borderRadius: 10,
  padding: 12,
};
const rowStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  flexWrap: "wrap" as const,
  gap: 8,
};
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

type Form = { action: "file" | "dir" | "move" | "delete"; path: string; revision?: string };

export default function Files() {
  const { botId = "", name = "Bot" } = useLocalSearchParams<{ botId?: string; name?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const controller = useMemo(
    () =>
      new WorkspaceFilesController(botId, (request) =>
        rpc("computer/workspace", request, { timeoutMs: 90_000 }),
      ),
    [botId],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [tab, setTab] = useState<"browse" | "changes">("browse");
  const [form, setForm] = useState<Form | null>(null);
  const [destination, setDestination] = useState("");
  const [destinationLocation, setDestinationLocation] = useState<WorkspaceLocation>("bot");
  const [preview, setPreview] = useState(true);
  const [repoPath, setRepoPath] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [branch, setBranch] = useState("");
  const [branchCreate, setBranchCreate] = useState(true);
  const awake = computer?.state === "running";
  const disabled = state.busy || !awake || Boolean(computer?.busyBotName);
  const repo = state.repos.find((item) => item.path === repoPath) ?? state.repos[0];
  const file = state.file;

  useEffect(() => {
    navigation.setOptions({ title: `${name} · Files` });
  }, [navigation, name]);
  useEffect(() => {
    setSelected([]);
    setBranch("");
  }, [repo?.revision, repo?.path, state.location]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const status = await rpc<ComputerStatus>("computer/status", { botId });
        if (active) setComputer(status);
      } catch (error) {
        if (active) controller.error(error);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
      void controller.checkOpenFile();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [botId, controller]);
  useEffect(() => {
    if (!awake) return;
    const timer = setTimeout(() => void controller.refresh(), 200);
    return () => clearTimeout(timer);
  }, [awake, controller, state.search, state.hidden]);
  useEffect(() => {
    if (awake && tab === "changes") void controller.gitStatus();
  }, [awake, controller, tab, state.location]);
  usePreventRemove(controller.dirty || state.busy, ({ data }) => {
    if (state.busy) {
      Alert.alert("Saving files", "Wait for the operation to finish.");
      return;
    }
    Alert.alert("Discard unsaved edits?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  function navigate(action: () => void) {
    if (state.busy) return;
    if (!controller.dirty) {
      action();
      return;
    }
    Alert.alert("Discard unsaved edits?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: action },
    ]);
  }
  function browse(path: string, location = state.location) {
    navigate(() => {
      setForm(null);
      void controller.browse(path, location);
    });
  }
  function open(entry: WorkspaceEntry) {
    navigate(() => {
      setForm(null);
      setPreview(true);
      if (entry.kind === "dir") void controller.browse(entry.path);
      else void controller.open(entry.path);
    });
  }
  async function editEntry(entry: WorkspaceEntry, action: "move" | "delete") {
    try {
      const revision = await controller.inspect(entry.path);
      setForm({ action, path: entry.path, revision });
      setDestination(entry.path);
      setDestinationLocation(state.location);
    } catch (error) {
      controller.error(error);
    }
  }
  function entryMenu(entry: WorkspaceEntry) {
    if (disabled) return;
    navigate(() =>
      Alert.alert(entry.path, undefined, [
        { text: "Rename / Move", onPress: () => void editEntry(entry, "move") },
        { text: "Delete", style: "destructive", onPress: () => void editEntry(entry, "delete") },
        { text: "Cancel", style: "cancel" },
      ]),
    );
  }
  async function submit() {
    if (!form || disabled) return;
    let ok = false;
    if (form.action === "file" || form.action === "dir") {
      const path = join(state.directory, destination);
      ok = await controller.perform({ action: "create", path, kind: form.action });
      if (ok && form.action === "file") await controller.open(path);
    } else if (form.revision) {
      ok = await controller.perform(
        form.action === "move"
          ? {
              action: "move",
              path: form.path,
              destination,
              destinationLocation,
              revision: form.revision,
            }
          : { action: "delete", path: form.path, revision: form.revision },
      );
    }
    if (ok) setForm(null);
  }
  async function upload() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      for (const asset of picked.assets) {
        const source = new File(asset.uri);
        if (source.size > WORKSPACE_FILE_MAX_BYTES)
          throw new Error("Files must be 10 MiB or smaller");
        if (
          !(await controller.perform({
            action: "upload",
            path: join(state.directory, asset.name),
            dataBase64: await source.base64(),
          }))
        )
          break;
      }
    } catch (error) {
      controller.error(error);
    }
  }
  async function download(path: string, draft?: string) {
    let cached: File | undefined;
    try {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error(
          "File sharing is unavailable on this device. Use the web file manager to download.",
        );
      const result = draft === undefined ? await controller.download(path) : null;
      cached = new File(
        Paths.cache,
        `workspace-${Date.now()}-${path.split("/").at(-1) ?? "file"}${draft === undefined ? "" : ".draft.txt"}`,
      );
      cached.create({ overwrite: true });
      if (result) cached.write(result.dataBase64!, { encoding: "base64" });
      else cached.write(draft ?? "");
      await Sharing.shareAsync(cached.uri, { mimeType: result?.mimeType ?? "text/plain" });
    } catch (error) {
      controller.error(error);
    } finally {
      if (cached?.exists) cached.delete();
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#0A0A0B" }}
      contentContainerStyle={{ padding: 18, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={rowStyle}>
        <Action label="Browse" selected={tab === "browse"} onPress={() => setTab("browse")} />
        <Action label="Changes" selected={tab === "changes"} onPress={() => setTab("changes")} />
        <Action
          label="Refresh"
          disabled={!awake || state.busy}
          onPress={() => {
            controller.clearError();
            void controller.refresh();
            void controller.checkOpenFile();
            if (tab === "changes") void controller.gitStatus();
          }}
        />
      </View>
      <View style={rowStyle}>
        <Action
          label="Bot files"
          selected={state.location === "bot"}
          onPress={() => browse("", "bot")}
        />
        {computer?.mode === "team" ? (
          <Action
            label="Shared files"
            selected={state.location === "shared"}
            onPress={() => browse("", "shared")}
          />
        ) : null}
      </View>
      {state.error ? (
        <Text accessibilityRole="alert" style={{ color: "#FCA5A5" }}>
          {state.error}
        </Text>
      ) : null}
      {!awake ? (
        <Action
          label="Wake computer"
          onPress={() =>
            void rpc<ComputerStatus>("computer/boot", { botId }, { timeoutMs: 90_000 })
              .then(setComputer)
              .catch(controller.error)
          }
        />
      ) : tab === "browse" ? (
        <>
          <View style={rowStyle}>
            <Action
              label={state.location === "shared" ? "Shared files" : "Bot files"}
              onPress={() => browse("")}
            />
            {state.directory
              .split("/")
              .filter(Boolean)
              .map((part, index, all) => (
                <Action
                  key={all.slice(0, index + 1).join("/")}
                  label={`› ${part}`}
                  onPress={() => browse(all.slice(0, index + 1).join("/"))}
                />
              ))}
          </View>
          <View style={rowStyle}>
            <Action
              label="New file"
              disabled={disabled}
              onPress={() =>
                navigate(() => {
                  setForm({ action: "file", path: "" });
                  setDestination("");
                })
              }
            />
            <Action
              label="New folder"
              disabled={disabled}
              onPress={() =>
                navigate(() => {
                  setForm({ action: "dir", path: "" });
                  setDestination("");
                })
              }
            />
            <Action label="Upload" disabled={disabled} onPress={() => void upload()} />
          </View>
          {form ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#343438",
                borderRadius: 12,
                padding: 12,
                gap: 12,
              }}
            >
              <Text style={{ color: "#ECECEE" }}>
                {form.action === "delete"
                  ? `Delete ${form.path} and everything inside?`
                  : form.action === "move"
                    ? `Rename / Move ${form.path}`
                    : `New ${form.action === "dir" ? "folder" : "file"}`}
              </Text>
              {form.action !== "delete" ? (
                <>
                  <TextInput
                    accessibilityLabel={form.action === "move" ? "Destination path" : "Name"}
                    style={inputStyle}
                    value={destination}
                    onChangeText={setDestination}
                    autoCapitalize="none"
                  />
                  {form.action === "move" && computer?.mode === "team" ? (
                    <View style={rowStyle}>
                      <Action
                        label="To bot files"
                        selected={destinationLocation === "bot"}
                        onPress={() => setDestinationLocation("bot")}
                      />
                      <Action
                        label="To shared files"
                        selected={destinationLocation === "shared"}
                        onPress={() => setDestinationLocation("shared")}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}
              <View style={rowStyle}>
                <Action
                  label={form.action === "delete" ? "Delete" : "Save"}
                  disabled={disabled}
                  onPress={() => void submit()}
                />
                <Action label="Cancel" disabled={state.busy} onPress={() => setForm(null)} />
              </View>
            </View>
          ) : null}
          <TextInput
            accessibilityLabel="Search files"
            placeholder="Search files in this folder"
            placeholderTextColor="#85858A"
            style={inputStyle}
            value={state.search}
            onChangeText={(value) => controller.setSearch(value)}
          />
          <View style={rowStyle}>
            <Switch
              accessibilityLabel="Show hidden files"
              value={state.hidden}
              onValueChange={(value) => controller.setHidden(value)}
            />
            <Text style={{ color: "#A8A8AD" }}>Hidden files</Text>
          </View>
          {state.loading ? <ActivityIndicator color="#A8A8AD" /> : null}
          {!state.entries.length && !state.loading ? (
            <Text style={{ color: "#85858A" }}>
              {state.search ? "No matching files" : "Empty folder"}
            </Text>
          ) : null}
          {[...state.entries]
            .sort((a, b) =>
              a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "dir" ? -1 : 1,
            )
            .map((entry) => (
              <View
                key={entry.path}
                style={{
                  ...rowStyle,
                  borderBottomWidth: 1,
                  borderColor: "#26262A",
                  flexWrap: "nowrap",
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={entry.path}
                  disabled={state.busy}
                  onPress={() => open(entry)}
                  style={{ flex: 1, paddingVertical: 14 }}
                >
                  <Text numberOfLines={2} style={{ color: "#DFDFE2" }}>
                    {entry.kind === "dir" ? "▸ " : ""}
                    {state.search ? entry.path : entry.path.split("/").at(-1)}
                  </Text>
                </Pressable>
                <Action
                  label="···"
                  accessibilityLabel={`Actions for ${entry.path}`}
                  disabled={disabled}
                  onPress={() => entryMenu(entry)}
                />
              </View>
            ))}
          {state.truncated ? (
            <Text style={{ color: "#A8A8AD" }}>
              Some results are hidden. Open a smaller folder.
            </Text>
          ) : null}
          {file ? (
            <View
              style={{
                gap: 12,
                borderWidth: 1,
                borderColor: "#343438",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ color: "#ECECEE" }}>
                {file.path}
                {controller.dirty ? " •" : ""}
              </Text>
              <View style={rowStyle}>
                <Action label="Download" onPress={() => void download(file.path)} />
                <Action
                  label="Attach to chat"
                  disabled={controller.dirty || state.busy}
                  onPress={() =>
                    router.navigate({
                      pathname: "/thread",
                      params: {
                        botId,
                        name,
                        workspaceFile: file.path,
                        workspaceLocation: state.location,
                        workspaceAttachmentId: String(Date.now()),
                      },
                    })
                  }
                />
                {file.content !== null ? (
                  <Action
                    label="Save"
                    disabled={disabled || !controller.dirty || file.stale}
                    onPress={() => void controller.save()}
                  />
                ) : null}
                {workspacePreviewType(file.path) === "markdown" ? (
                  <Action
                    label={preview ? "Edit" : "Preview"}
                    onPress={() => setPreview(!preview)}
                  />
                ) : null}
              </View>
              {file.stale ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: "#FCA5A5" }}>
                    This file changed on the computer. Your edits are still here.
                  </Text>
                  <Action
                    label="Reload file"
                    onPress={() => navigate(() => void controller.open(file.path))}
                  />
                  {controller.dirty ? (
                    <Action
                      label="Download my draft"
                      onPress={() => void download(file.path, file.draft)}
                    />
                  ) : null}
                </View>
              ) : null}
              {file.mimeType.startsWith("image/") && file.dataBase64 ? (
                <Image
                  accessibilityLabel={file.path}
                  source={{ uri: `data:${file.mimeType};base64,${file.dataBase64}` }}
                  style={{ width: "100%", height: 300 }}
                  resizeMode="contain"
                />
              ) : file.mimeType === "application/pdf" ? (
                <>
                  <Text style={{ color: "#A8A8AD" }}>
                    Open this PDF in a viewer on your device.
                  </Text>
                  <Action label="Open PDF" onPress={() => void download(file.path)} />
                </>
              ) : file.content !== null ? (
                preview && workspacePreviewType(file.path) === "markdown" ? (
                  <ChatMarkdown>{file.draft}</ChatMarkdown>
                ) : (
                  <TextInput
                    accessibilityLabel="File content"
                    value={file.draft}
                    onChangeText={(value) => controller.setDraft(value)}
                    multiline
                    editable={!disabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{
                      ...inputStyle,
                      minHeight: 260,
                      textAlignVertical: "top",
                      fontFamily: "monospace",
                    }}
                  />
                )
              ) : (
                <Text style={{ color: "#A8A8AD" }}>
                  Preview unavailable. Download this file to open it.
                </Text>
              )}
            </View>
          ) : null}
        </>
      ) : (
        <>
          {state.repos.map((item) => (
            <Action
              key={item.path}
              label={`${item.path || "Workspace"} · ${item.branch}`}
              selected={item.path === repo?.path}
              onPress={() => setRepoPath(item.path)}
            />
          ))}
          {!repo ? (
            <>
              <Text style={{ color: "#A8A8AD" }}>No Git repositories in this location.</Text>
              <Action
                label="Enable Git in this folder"
                disabled={disabled}
                onPress={() =>
                  Alert.alert("Enable Git?", "Files stay on this computer.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Enable Git",
                      onPress: () =>
                        void controller.perform({ action: "git-init", path: state.directory }),
                    },
                  ])
                }
              />
            </>
          ) : (
            <>
              <Text style={{ color: "#ECECEE" }}>Branch: {repo.branch}</Text>
              <View style={rowStyle}>
                <Switch
                  accessibilityLabel="Create new branch"
                  value={branchCreate}
                  onValueChange={setBranchCreate}
                />
                <Text style={{ color: "#A8A8AD" }}>New branch</Text>
              </View>
              {!branchCreate ? (
                <View style={rowStyle}>
                  {repo.branches
                    .filter((item) => item !== repo.branch)
                    .map((item) => (
                      <Action
                        key={item}
                        label={item}
                        selected={branch === item}
                        onPress={() => setBranch(item)}
                      />
                    ))}
                </View>
              ) : (
                <TextInput
                  accessibilityLabel="Branch name"
                  style={inputStyle}
                  value={branch}
                  onChangeText={setBranch}
                  autoCapitalize="none"
                />
              )}
              <Action
                label={branchCreate ? "Create branch" : "Switch branch"}
                disabled={disabled || !branch || repo.files.length > 0}
                onPress={() =>
                  void controller.perform({
                    action: "git-branch",
                    path: repo.path,
                    revision: repo.revision,
                    branch,
                    create: branchCreate,
                  })
                }
              />
              {repo.files.length ? (
                <Text style={{ color: "#A8A8AD" }}>Commit changes before switching branches.</Text>
              ) : (
                <Text style={{ color: "#A8A8AD" }}>Working tree clean</Text>
              )}
              {repo.files.map((change) => (
                <View key={change.path} style={rowStyle}>
                  <Switch
                    accessibilityLabel={`Include ${change.path} in commit`}
                    disabled={disabled}
                    value={selected.includes(change.path)}
                    onValueChange={(value) =>
                      setSelected(
                        value
                          ? [...selected, change.path]
                          : selected.filter((path) => path !== change.path),
                      )
                    }
                  />
                  <Pressable
                    onPress={() => void controller.showDiff(repo.path, change.path)}
                    style={{ flex: 1, padding: 8 }}
                  >
                    <Text style={{ color: "#DFDFE2" }}>
                      {change.path} · {change.status}
                    </Text>
                  </Pressable>
                </View>
              ))}
              {repo.files.length ? (
                <>
                  <TextInput
                    accessibilityLabel="Commit message"
                    placeholder="Commit message"
                    placeholderTextColor="#85858A"
                    style={inputStyle}
                    value={message}
                    onChangeText={setMessage}
                  />
                  <Action
                    label="Commit selected files"
                    disabled={disabled || !message.trim() || !selected.length}
                    onPress={() =>
                      void controller
                        .perform({
                          action: "git-commit",
                          path: repo.path,
                          revision: repo.revision,
                          message,
                          files: selected,
                        })
                        .then((ok) => {
                          if (ok) setMessage("");
                        })
                    }
                  />
                </>
              ) : null}
              {state.diff !== null ? (
                <ScrollView horizontal>
                  <Text
                    selectable
                    style={{ color: "#DFDFE2", fontFamily: "monospace", fontSize: 12 }}
                  >
                    {state.diff}
                  </Text>
                </ScrollView>
              ) : null}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Action({
  label,
  onPress,
  disabled,
  selected,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: selected ? "#343438" : "#1B1B1E",
        opacity: disabled ? 0.4 : 1,
        paddingHorizontal: 12,
        paddingVertical: 11,
        minHeight: 44,
        borderRadius: 12,
      }}
    >
      <Text style={{ color: "#ECECEE" }}>{label}</Text>
    </Pressable>
  );
}
