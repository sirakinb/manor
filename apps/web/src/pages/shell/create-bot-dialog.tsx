import { Trans, useLingui } from "@lingui/react/macro";
import type { BotAvatarSet, LocalComputerLiveSession } from "@rakazo/contracts";
import { BOT_NAME_MAX_LENGTH } from "@rakazo/contracts";
import {
  newBotLook,
  newBotLookInput,
  newBotPreviewIdentity,
  ORGANIC_PREVIEW_IDENTITIES,
} from "@rakazo/core";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from "@rakazo/ui-web";
import { useId, useRef, useState } from "react";
import { errorText } from "../../lib/user-error";
import { BotLookPicker } from "./avatar-studio-popover";

export interface CreateBotDialogInput {
  name: string;
  color: string;
  /** Reserve the logo preview's persistent seed through creation and retries. */
  id?: string;
  /** The organic family the preview drew; omitted when a studio shape is picked. */
  avatarFamily?: number;
  /** Manor: set when the bot should run on the shared "This Mac" computer. */
  computerMode?: "local";
}

/** Mounted only while open; the parent unmounts it from `onCancel` or after `onCreate`. */
export function CreateBotDialog({
  avatarSet,
  onCancel,
  onCreate,
  localComputer,
}: {
  /** The account's set: the server gives it to the new bot, so the preview draws it too. */
  avatarSet: BotAvatarSet;
  onCancel: () => void;
  onCreate: (input: CreateBotDialogInput) => Promise<void>;
  /** Manor: offers "This Mac" while the desktop app is sharing it. */
  localComputer?: LocalComputerLiveSession | null;
}) {
  const { t } = useLingui();
  const thisMacId = useId();
  const [onThisMac, setOnThisMac] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [look, setLook] = useState(newBotLook);
  const identity = newBotPreviewIdentity(avatarSet, look);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function create() {
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        name: trimmed,
        ...newBotLookInput(avatarSet, look),
        ...(onThisMac && localComputer?.connected ? { computerMode: "local" as const } : {}),
      });
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={nameRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        data-testid="create-bot-dialog"
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              <Trans>New bot</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <BotAvatar color={look.color} identity={identity} size={96} avatarSet={avatarSet} />
          </div>
          <Input
            ref={nameRef}
            aria-label={t`Name`}
            placeholder={t`Name your Bot`}
            value={name}
            maxLength={BOT_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            className="text-center"
          />
          {error ? (
            <p
              role="alert"
              data-testid="create-bot-error"
              className="text-body-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          <BotLookPicker
            value={look.color}
            identity={identity}
            organicIdentities={ORGANIC_PREVIEW_IDENTITIES}
            avatarSet={avatarSet}
            onChange={(color, picked) => {
              setLook((current) => ({ ...current, color, identity: picked ?? current.identity }));
            }}
          />
          {localComputer?.connected ? (
            <label
              htmlFor={thisMacId}
              className="flex items-center justify-between gap-3 text-body text-foreground"
            >
              <Trans>Run on This Mac</Trans>
              <Switch
                id={thisMacId}
                data-testid="create-bot-this-mac"
                checked={onThisMac}
                onCheckedChange={setOnThisMac}
              />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!trimmed || submitting}>
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
