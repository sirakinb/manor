import { Trans, useLingui } from "@lingui/react/macro";
import type { Space } from "@rakazo/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu";
import { PageLoading } from "../components/PageLoading";
import { SignupSurvey } from "../components/SignupSurvey";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { initialMe, rpc } from "../lib/rpc";
import { useSignOut } from "../lib/sign-out";
import { errorText } from "../lib/user-error";
import { ensureFirstBot, FirstBotRetry } from "./onboarding/first-bot";
import { ModelStep } from "./onboarding/model-step";
import { useOnboardingModel } from "./onboarding/use-onboarding-model";

export function OnboardingPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  // The URL holds the survey and model steps, so /onboarding/survey and /onboarding/model open directly.
  const { step: routeStep } = useParams();
  const linkedStep = routeStep === "survey" || routeStep === "model" ? routeStep : undefined;
  const [creatingBot, setCreatingBot] = useState(false);
  const [surveyDone, setSurveyDone] = useState(false);
  const step = creatingBot ? "bot" : surveyDone ? "loading" : (linkedStep ?? "loading");
  const [billingEnabled, setBillingEnabled] = useState(false);
  // The step after the survey; null until me loads.
  const [afterSurvey, setAfterSurvey] = useState<"model" | "bot" | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [space, setSpace] = useState<Space | null>(null);
  const model = useOnboardingModel({
    catalog,
    billingEnabled,
    onConnected: () => goTo("bot"),
  });
  const { error, modelProbe, setError } = model;
  const createStartedRef = useRef(false);
  // Manor: a bot the space already has; a step opened by its URL finishes there instead of making one.
  const existingBotRef = useRef<string | null>(null);
  const { signingOut, logOut } = useSignOut("/sign-in", setError);

  useEffect(() => {
    const leaving = new AbortController();
    const { signal } = leaving;
    void initialMe()
      .then(async (me) => {
        if (signal.aborted) return;
        const [models, navigation] = await Promise.all([
          rpc.models.list(undefined, { signal }).catch(() => []),
          rpc.spaces.list(undefined, { signal }),
        ]);
        if (signal.aborted) return;
        setSpace(navigation.spaces.find((entry) => entry.id === me.spaceId) ?? null);
        // A teammate may already have completed the shared setup.
        const existingBot = navigation.current.bots[0];
        if (existingBot && !linkedStep) {
          navigate(`/app/${existingBot.id}`, { replace: true });
          return;
        }
        existingBotRef.current = existingBot?.id ?? null;
        setBillingEnabled(me.billingEnabled);
        setCatalog(models);
        const next = me.needsModel ? "model" : "bot";
        setAfterSurvey(next);
        if (!linkedStep) goTo(me.needsSignupSurvey ? "survey" : next);
      })
      .catch(() => {
        // Manor: a failed load says so instead of creating a first bot a teammate may already have.
        if (!signal.aborted) setError(t`Could not load setup. Reload to try again.`);
      });
    return () => {
      leaving.abort();
      modelProbe.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!surveyDone || !afterSurvey) return;
    setSurveyDone(false);
    goTo(afterSurvey);
  }, [surveyDone, afterSurvey]);

  function goTo(next: "survey" | "model" | "bot") {
    if (next === "bot") setCreatingBot(true);
    navigate(next === "bot" ? "/onboarding" : `/onboarding/${next}`, { replace: true });
  }

  async function createFirstBot() {
    if (createStartedRef.current) return;
    createStartedRef.current = true;
    setError(null);
    if (existingBotRef.current) {
      navigate(`/app/${existingBotRef.current}`, { replace: true });
      return;
    }
    try {
      const bot = await ensureFirstBot();
      // Onboarding continues conversationally in the thread: greeting first,
      // then the focus choice (immediate for the first bot).
      const started = await rpc.onboarding
        .start({ botId: bot.id })
        .then(() => true)
        .catch(() => false);
      if (started) {
        await rpc.onboarding.promptFocus({ botId: bot.id }).catch(() => undefined);
      }
      navigate(`/app/${bot.id}`);
    } catch (err) {
      createStartedRef.current = false;
      setError(errorText(err, t`Could not create your bot`));
    }
  }

  useEffect(() => {
    if (step !== "bot") return;
    void createFirstBot();
  }, [step]);

  // Loading, and creating the first bot, both wait on one spinner until the chat opens.
  // Manor: a shared space keeps its sharing notice on screen while its first bot is made.
  if ((step === "loading" || (step === "bot" && !space?.shared)) && !error) return <PageLoading />;

  return (
    <div className="min-h-full bg-background px-6 py-12" data-rakazo-surface="onboarding">
      <AccountMenu signingOut={signingOut} onLogOut={() => void logOut()} />
      <div className="mx-auto w-full max-w-[560px]">
        {step !== "loading" && space?.shared ? (
          <div className="mb-6 text-body text-muted-foreground">
            <p className="font-medium text-foreground">{space.name}</p>
            <p className="mt-1">
              <Trans>Agents, conversations, files, and connected accounts are shared.</Trans>
            </p>
          </div>
        ) : null}
        {step === "loading" ? <p className="text-muted-foreground">{error}</p> : null}
        {step === "survey" ? <SignupSurvey onDone={() => setSurveyDone(true)} /> : null}
        {step === "model" ? <ModelStep model={model} fieldId={fieldId} /> : null}
        {step === "bot" && error ? (
          <FirstBotRetry error={error} onRetry={() => void createFirstBot()} />
        ) : null}
      </div>
    </div>
  );
}
