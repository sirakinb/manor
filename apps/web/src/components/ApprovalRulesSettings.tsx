import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ActionApprovalRule,
  ActionAutoReviewSettings,
  ApprovalMode,
  SettingsScope,
} from "@rakazo/contracts";
import { humanizeToolName } from "@rakazo/core";
import { writeSaved } from "@rakazo/core/query";
import { Button, Label, Switch, ToggleGroup, ToggleGroupItem } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { lazy, Suspense, useId, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

const segmented = "rounded-lg bg-muted p-1";
const segment = "h-7 px-3 text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm";

const VerificationComparisonOverlay = lazy(() =>
  import("./VerificationComparison").then((module) => ({
    default: module.VerificationComparisonOverlay,
  })),
);

/** Approvals for the account, or for the bound Space when it customizes them. */
export function ApprovalRulesSettings({ scope }: { scope: SettingsScope }) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const answerCheckId = useId();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const input = { scope };
  const rulesQuery = useQuery(queries.approvalRules.list.queryOptions({ input }));
  const autoReviewQuery = useQuery(queries.autoReview.get.queryOptions({ input }));
  const rules = rulesQuery.data ?? [];
  const autoReview = autoReviewQuery.data ?? null;
  const loading = rulesQuery.isPending || autoReviewQuery.isPending;
  const loadFailed = rulesQuery.error ?? autoReviewQuery.error;
  const [saving, setSaving] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const error =
    actionError ?? (loadFailed ? errorText(loadFailed, t`Could not load approval rules`) : null);
  const modes: Array<{ mode: ApprovalMode; label: string }> = [
    { mode: "never", label: t`Never ask` },
    // Auto needs an approval model; it stays listed while chosen so the choice is visible.
    ...(autoReview?.checkerAvailable || autoReview?.mode === "auto"
      ? [{ mode: "auto" as const, label: t`Auto` }]
      : []),
    { mode: "ask", label: t`Ask` },
  ];

  function setRules(update: (current: ActionApprovalRule[]) => ActionApprovalRule[]) {
    return writeSaved(queryClient, queries.approvalRules.list.queryKey({ input }), (current) =>
      update(current ?? []),
    );
  }

  function setAutoReview(next: ActionAutoReviewSettings) {
    return writeSaved(queryClient, queries.autoReview.get.queryKey({ input }), () => next);
  }

  async function save(work: () => Promise<unknown>, failure: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err, failure));
    } finally {
      setSaving(false);
    }
  }

  const setMode = (mode: ApprovalMode) =>
    save(
      async () => setAutoReview(await rpc.autoReview.set({ scope, mode })),
      t`Could not save Auto Review`,
    );

  const setEffect = (rule: ActionApprovalRule, effect: "always_allow" | "deny") =>
    save(async () => {
      if (rule.matchKind === "category") return;
      const saved = await rpc.approvalRules.set({
        scope,
        effect,
        matchKind: rule.matchKind,
        matchValue: rule.matchValue,
      });
      // Saving replaces the rule's other effect on the same match.
      await setRules((current) => [...current.filter((other) => other.id !== rule.id), saved]);
    }, t`Could not save rule`);

  const removeRule = (rule: ActionApprovalRule) =>
    save(async () => {
      await rpc.approvalRules.remove({ scope, id: rule.id });
      await setRules((current) => current.filter((other) => other.id !== rule.id));
    }, t`Could not remove rule`);

  // Manor: the reply check and checker choice save beside the mode.
  const saveAutoReview = (update: { checkAnswers?: boolean; engine?: string; compare?: boolean }) =>
    save(
      async () => setAutoReview(await rpc.autoReview.set({ scope, ...update })),
      t`Could not save Auto Review`,
    );

  const engines = autoReview?.engines ?? [];

  return (
    <div data-testid="approval-settings" className="space-y-8">
      <SettingsGroup>
        <SettingsRow
          label={<Trans>Mode</Trans>}
          control={
            <ToggleGroup
              aria-label={t`Mode`}
              data-testid="approval-mode"
              value={autoReview ? [autoReview.mode] : []}
              onValueChange={([next]) => {
                if (next && next !== autoReview?.mode) void setMode(next as ApprovalMode);
              }}
              disabled={loading || saving || !autoReview}
              spacing={1}
              className={segmented}
            >
              {modes.map(({ mode, label }) => (
                <ToggleGroupItem key={mode} value={mode} className={segment}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        >
          {autoReview?.mode === "auto" && !autoReview.checkerAvailable ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              <Trans>Add a model in Settings to use this.</Trans>
            </p>
          ) : null}
        </SettingsRow>
        {/* Manor: the reply check in every mode; the checker choice under Auto. */}
        <SettingsRow
          label={
            <Label htmlFor={answerCheckId} className="text-[14px] font-normal text-foreground">
              <Trans>Check replies against sources</Trans>
            </Label>
          }
          control={
            <Switch
              id={answerCheckId}
              data-testid="answer-check-toggle"
              checked={autoReview?.checkAnswers ?? false}
              disabled={loading || saving || !autoReview}
              onCheckedChange={(checked) => void saveAutoReview({ checkAnswers: checked })}
            />
          }
        >
          {autoReview?.checkAnswers && !autoReview.checkerAvailable ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              <Trans>Add a model in Settings to use this.</Trans>
            </p>
          ) : null}
        </SettingsRow>
        {autoReview && autoReview.mode === "auto" && engines.length > 1 ? (
          <div className="flex flex-col gap-2 px-4 py-3">
            <fieldset data-testid="auto-review-engine" className="flex flex-wrap gap-2">
              <legend className="sr-only">
                <Trans>Checker</Trans>
              </legend>
              {engines.map((engine) => (
                <label
                  key={engine.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[14px] text-foreground/75 has-[:checked]:border-ring has-[:disabled]:cursor-default has-[:disabled]:opacity-50"
                >
                  <input
                    type="radio"
                    name="auto-review-engine"
                    value={engine.id}
                    checked={autoReview.engine === engine.id}
                    disabled={saving || !engine.available}
                    onChange={() => void saveAutoReview({ engine: engine.id })}
                  />
                  {engine.label}
                </label>
              ))}
            </fieldset>
            {engines.every((engine) => engine.available) ? (
              <label className="flex cursor-pointer items-center gap-3 text-[14px] text-foreground/75">
                <input
                  type="checkbox"
                  data-testid="auto-review-compare"
                  checked={autoReview.compare}
                  disabled={saving}
                  onChange={(event) => void saveAutoReview({ compare: event.target.checked })}
                />
                <Trans>Compare checkers</Trans>
              </label>
            ) : null}
            <Button
              variant="link"
              data-testid="open-checker-comparison"
              className="h-auto w-fit p-0 text-[14px]"
              onClick={() => setComparisonOpen(true)}
            >
              <Trans>View comparison</Trans>
            </Button>
          </div>
        ) : null}
      </SettingsGroup>
      {rules.length > 0 ? (
        <SettingsGroup title={<Trans>Rules</Trans>} data-testid="approval-rules">
          {rules.map((rule) => (
            <SettingsRow
              key={rule.id}
              label={ruleLabel(rule)}
              control={
                <>
                  {rule.matchKind === "category" ? (
                    <span className="text-[13px] text-muted-foreground">
                      {rule.effect === "always_allow" ? (
                        <Trans>Allow</Trans>
                      ) : rule.effect === "deny" ? (
                        <Trans>Block</Trans>
                      ) : (
                        <Trans>Ask</Trans>
                      )}
                    </span>
                  ) : (
                    <ToggleGroup
                      aria-label={ruleLabel(rule)}
                      value={[rule.effect]}
                      onValueChange={([next]) => {
                        if (next === "always_allow" || next === "deny") void setEffect(rule, next);
                      }}
                      disabled={saving}
                      spacing={1}
                      className={segmented}
                    >
                      <ToggleGroupItem value="always_allow" className={segment}>
                        <Trans>Allow</Trans>
                      </ToggleGroupItem>
                      {/* An older ask rule keeps showing what it does until it is switched. */}
                      {rule.effect === "require_approval" ? (
                        <ToggleGroupItem value="require_approval" className={segment}>
                          <Trans>Ask</Trans>
                        </ToggleGroupItem>
                      ) : null}
                      <ToggleGroupItem value="deny" className={segment}>
                        <Trans>Block</Trans>
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Remove`}
                    className="text-destructive hover:text-destructive"
                    disabled={saving}
                    onClick={() => void removeRule(rule)}
                  >
                    <Trash2 />
                  </Button>
                </>
              }
            />
          ))}
        </SettingsGroup>
      ) : null}
      {comparisonOpen ? (
        <Suspense fallback={null}>
          <VerificationComparisonOverlay onClose={() => setComparisonOpen(false)} />
        </Suspense>
      ) : null}
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

/** A site reads as itself; a tool, connector or older category by its name. */
function ruleLabel(rule: ActionApprovalRule): string {
  return rule.matchKind === "site" ? rule.matchValue : humanizeToolName(rule.matchValue);
}
