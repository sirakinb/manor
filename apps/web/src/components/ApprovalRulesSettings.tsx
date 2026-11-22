import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ActionApprovalRule,
  ActionAutoReviewSettings,
  ApprovalMode,
  SettingsScope,
} from "@rakazo/contracts";
import type { ApprovalRuleChoice } from "@rakazo/core";
import {
  APPROVAL_RULE_EFFECTS,
  approvalRuleApplies,
  approvalRuleChoices,
  approvalRuleEffectChoices,
  approvalRuleLabel,
} from "@rakazo/core";
import { writeSaved } from "@rakazo/core/query";
import {
  Button,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  Label,
  ListSearchInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { lazy, Suspense, useId, useRef, useState } from "react";
import { useSave, useSpaceQueries } from "../lib/query";
import type { RpcClient } from "../lib/rpc";
import { useListSearch } from "../lib/use-list-search";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";
import { SpendingLimitSettings } from "./SpendingLimitSettings";

const segmented = "rounded-lg bg-muted p-1";
const segment = "h-7 px-3 text-body-sm aria-pressed:bg-background aria-pressed:shadow-sm";

const VerificationComparisonOverlay = lazy(() =>
  import("./VerificationComparison").then((module) => ({
    default: module.VerificationComparisonOverlay,
  })),
);

/** Manor: the reply check and checker choice save beside the mode. */
type AutoReviewUpdate = { checkAnswers?: boolean; engine?: string; compare?: boolean };

type Change =
  | { kind: "mode"; mode: ApprovalMode }
  | { kind: "autoReview"; update: AutoReviewUpdate }
  | { kind: "rule"; rule: Pick<ActionApprovalRule, "effect" | "matchKind" | "matchValue"> }
  | { kind: "remove"; rule: ActionApprovalRule };

/** Approvals for the account, or for the bound Space when it customizes them. */
export function ApprovalRulesSettings({ scope }: { scope: SettingsScope }) {
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
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const change = useSave({
    save: async (next: Change, rpc) => {
      if (next.kind === "mode") {
        return setAutoReview(await rpc.autoReview.set({ scope, mode: next.mode }));
      }
      if (next.kind === "autoReview") {
        return setAutoReview(await rpc.autoReview.set({ scope, ...next.update }));
      }
      if (next.kind === "rule") return putRule(next.rule, rpc);
      await rpc.approvalRules.remove({ scope, id: next.rule.id });
      await setRules((current) => current.filter((other) => other.id !== next.rule.id));
    },
  });
  const saving = change.pending;
  const failures: Record<Change["kind"], string> = {
    mode: t`Could not save Auto Review`,
    autoReview: t`Could not save Auto Review`,
    rule: t`Could not save rule`,
    remove: t`Could not remove rule`,
  };
  const actionError =
    change.error && change.input ? errorText(change.error, failures[change.input.kind]) : null;
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

  async function putRule(
    rule: Pick<ActionApprovalRule, "effect" | "matchKind" | "matchValue">,
    rpc: RpcClient,
  ) {
    if (rule.matchKind === "category") return;
    const saved = await rpc.approvalRules.set({
      scope,
      effect: rule.effect,
      matchKind: rule.matchKind,
      matchValue: rule.matchValue,
    });
    // Saving replaces any other effect on the same match.
    await setRules((current) => [
      ...current.filter(
        (other) =>
          other.matchKind !== saved.matchKind ||
          other.matchValue.toLowerCase() !== saved.matchValue.toLowerCase(),
      ),
      saved,
    ]);
  }

  const saveAutoReview = (update: AutoReviewUpdate) => change.run({ kind: "autoReview", update });

  const engines = autoReview?.engines ?? [];

  const modeDetail =
    autoReview?.mode === "auto" && !autoReview.checkerAvailable
      ? t`Add a model in Settings to use this.`
      : autoReview?.mode === "auto"
        ? t`A model approves routine actions and asks you about the rest.`
        : autoReview?.mode === "never"
          ? t`Asks only before purchases and the first use of your computer. Only Block rules apply.`
          : autoReview?.mode === "ask"
            ? t`Asks before sending, spending or changing anything in your apps.`
            : null;
  const groupTitles: Record<ActionApprovalRule["effect"], string> = {
    always_allow: t`Always allow`,
    require_approval: t`Always ask`,
    deny: t`Blocked`,
  };
  const groups = APPROVAL_RULE_EFFECTS.map((effect) => ({ effect, title: groupTitles[effect] }));

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
                if (next && next !== autoReview?.mode)
                  change.run({ kind: "mode", mode: next as ApprovalMode });
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
          {modeDetail ? (
            <p className="mt-1 text-body-sm text-muted-foreground">{modeDetail}</p>
          ) : null}
        </SettingsRow>
        {/* Manor: the reply check in every mode; the checker choice under Auto. */}
        <SettingsRow
          label={
            <Label htmlFor={answerCheckId} className="text-body font-normal text-foreground">
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
            <p className="mt-1 text-body-sm text-muted-foreground">
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
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-body text-foreground/75 has-[:checked]:border-ring has-[:disabled]:cursor-default has-[:disabled]:opacity-50"
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
              <label className="flex cursor-pointer items-center gap-3 text-body text-foreground/75">
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
              className="h-auto w-fit p-0 text-body"
              onClick={() => setComparisonOpen(true)}
            >
              <Trans>View comparison</Trans>
            </Button>
          </div>
        ) : null}
      </SettingsGroup>
      {/* Spending is the person's own across every Space, so it is set with the account's approvals. */}
      {scope === "account" ? <SpendingLimitSettings /> : null}
      <AddRulePicker
        choices={approvalRuleChoices(rules)}
        disabled={loading || Boolean(loadFailed) || saving}
        // An app or tool that already has a rule is not offered, so a pick always adds one.
        onPick={({ matchKind, matchValue }) =>
          change.run({ kind: "rule", rule: { effect: "require_approval", matchKind, matchValue } })
        }
      />
      {groups.map(({ effect, title }) => {
        const matching = rules.filter((rule) => rule.effect === effect);
        if (matching.length === 0) return null;
        // Never ask runs everything a block does not stop, so these rules wait for another mode.
        const unused = !approvalRuleApplies(autoReview?.mode, effect);
        return (
          <div
            key={effect}
            data-unused={unused || undefined}
            className={unused ? "opacity-50" : undefined}
          >
            <SettingsGroup title={title} data-testid={`approval-rules-${effect}`}>
              {matching.map((rule) => (
                <SettingsRow
                  key={rule.id}
                  label={approvalRuleLabel(rule)}
                  control={
                    <RuleControls
                      rule={rule}
                      disabled={saving}
                      onEffect={(effect) => change.run({ kind: "rule", rule: { ...rule, effect } })}
                      onRemove={() => change.run({ kind: "remove", rule })}
                    />
                  }
                />
              ))}
            </SettingsGroup>
          </div>
        );
      })}
      {comparisonOpen ? (
        <Suspense fallback={null}>
          <VerificationComparisonOverlay onClose={() => setComparisonOpen(false)} />
        </Suspense>
      ) : null}
      {error ? <p className="text-body-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/** A searchable list of the tools a rule can name, so nobody types a tool's name. */
function AddRulePicker({
  choices,
  disabled,
  onPick,
}: {
  choices: ApprovalRuleChoice[];
  disabled: boolean;
  onPick: (choice: ApprovalRuleChoice) => void;
}) {
  const { t } = useLingui();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const { query, setQuery, visible } = useListSearch(choices, {
    text: (choice) => [choice.label, choice.matchValue],
  });
  const item = (choice: ApprovalRuleChoice) => (
    <CommandItem
      key={`${choice.matchKind}:${choice.matchValue}`}
      value={`${choice.matchKind}:${choice.matchValue}`}
      onSelect={() => {
        setOpen(false);
        setQuery("");
        onPick(choice);
      }}
    >
      {choice.label}
    </CommandItem>
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={<Button variant="outline" size="sm" disabled={disabled} />}
        data-testid="approval-rule-add"
      >
        <Trans>Add rule</Trans>
      </PopoverTrigger>
      <PopoverContent initialFocus={searchRef} className="w-72 gap-0 p-0" align="start">
        <Command label={t`Search tools`} shouldFilter={false}>
          <ListSearchInput
            command
            inputRef={searchRef}
            query={query}
            setQuery={setQuery}
            label={t`Search tools`}
            placeholder={t`Search`}
          />
          <CommandList label={t`Tools`}>
            {visible.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-muted-foreground">
                <Trans>No matches</Trans>
              </p>
            ) : null}
            <CommandGroup>{visible.map(item)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The effects a rule can take, side by side, then remove. */
function RuleControls({
  rule,
  disabled,
  onEffect,
  onRemove,
}: {
  rule: ActionApprovalRule;
  disabled: boolean;
  onEffect: (effect: ActionApprovalRule["effect"]) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  const label = approvalRuleLabel(rule);
  const effects = approvalRuleEffectChoices(rule);
  const options: Record<ActionApprovalRule["effect"], string> = {
    always_allow: t`Allow`,
    require_approval: t`Ask`,
    deny: t`Block`,
  };
  return (
    <>
      {effects.length === 0 ? null : (
        <ToggleGroup
          aria-label={label}
          value={[rule.effect]}
          onValueChange={([next]) => {
            const effect = effects.find((option) => option === next);
            if (effect && effect !== rule.effect) onEffect(effect);
          }}
          disabled={disabled}
          spacing={1}
          className={segmented}
        >
          {effects.map((effect) => (
            <ToggleGroupItem key={effect} value={effect} className={segment}>
              {options[effect]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t`Remove ${label}`}
        className="text-destructive hover:text-destructive"
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </>
  );
}
