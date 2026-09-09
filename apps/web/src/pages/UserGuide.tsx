import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { BuiCard } from "../components/beautiful-ui/primitives";
import { brandName } from "../lib/brand";

export function UserGuide({ topic }: { topic: "start" | "agents" | "business" }) {
  if (topic === "agents") return <AgentGuide />;
  if (topic === "business") return <BusinessGuide />;
  return <FirstTaskGuide />;
}

function GuideTitle({ children, intro }: { children: ReactNode; intro: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="mb-3 text-2xl font-medium tracking-tight text-[#ECECEE]">{children}</h1>
      <p className="text-[14px] leading-7 text-[#A8A8AD]">{intro}</p>
    </header>
  );
}

function GuideSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-[15px] font-medium text-[#ECECEE]">{title}</h2>
      <div className="space-y-3 text-[14px] leading-7 text-[#A8A8AD]">{children}</div>
    </section>
  );
}

function FirstTaskGuide() {
  return (
    <>
      <GuideTitle
        intro={
          <Trans>
            {brandName} brings your agents, customer records, and business tools together. Start
            with one agent and one useful task. Build from a result you have checked.
          </Trans>
        }
      >
        <Trans>Your first useful task</Trans>
      </GuideTitle>
      <GuideSection title={<Trans>1. Choose an agent and connect a model</Trans>}>
        <p>
          <Trans>
            Open an existing bot from the sidebar, or choose New bot. Bots are your agents: give
            each one a clear job, such as preparing customer follow-ups or organizing inquiries. If
            you skipped model setup, open Models from the account menu and connect a provider before
            sending your first message.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>2. Give it a small, specific job</Trans>}>
        <p>
          <Trans>
            In the agent’s chat, say what you need, supply the relevant information, and describe
            the result you want. Try a task you can review before anything is sent or changed.
          </Trans>
        </p>
        <BuiCard className="p-5">
          <p className="mb-2 text-[12px] font-medium text-[#ECECEE]">
            <Trans>Try this with a few notes of your own</Trans>
          </p>
          <blockquote className="text-[#D4D4D8]">
            <Trans>
              Turn these inquiry notes into a follow-up plan. For each inquiry, list the request,
              missing information, and next step. Draft a short reply for me to review. Ask if
              anything is unclear, and don’t send any messages.
            </Trans>
          </blockquote>
        </BuiCard>
      </GuideSection>
      <GuideSection title={<Trans>3. Add tools when the task needs them</Trans>}>
        <p>
          <Trans>
            Pasted notes are enough for this first task. When the agent needs another app, open
            Integrations and connect it. For a website login, open that bot’s Settings → Sign-in
            credentials and add the site and sign-in information. The bot can use that saved login
            on its computer. You can also sign in yourself when prompted and hand control back.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>4. Review the result and refine it</Trans>}>
        <p>
          <Trans>
            Check names, dates, sources, and the proposed next steps. Reply with a specific
            correction, such as “Keep each reply under 80 words and ask for the preferred contact
            time.” Once the task works well, save its instructions as a skill or make it a routine.
          </Trans>
        </p>
      </GuideSection>
      <p className="border-t border-[#202023] pt-5 text-[13px] leading-6 text-[#85858A]">
        <Trans>
          Next, use Working with agents to make results more consistent, or Business data to
          organize customer records and understand your workspace.
        </Trans>
      </p>
    </>
  );
}

function AgentGuide() {
  return (
    <>
      <GuideTitle
        intro={
          <Trans>
            Give an agent enough context to act, a clear definition of done, and boundaries for
            decisions you want to review.
          </Trans>
        }
      >
        <Trans>Get better results from your agents</Trans>
      </GuideTitle>
      <GuideSection title={<Trans>Write a useful brief</Trans>}>
        <p>
          <Trans>
            Include the goal, the information to use, the output format, and what requires your
            approval. For example: “Compare these three proposals in a table, highlight missing
            fees, and recommend questions to ask. Don’t contact the vendors.”
          </Trans>
        </p>
        <p>
          <Trans>
            Use follow-up messages to correct the result or add context. Ask for the sources or
            files behind important claims so you can check the work.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>Give it access to the right tools</Trans>}>
        <p>
          <Trans>
            Integrations connect the apps an agent can use. Its computer lets it work with websites
            and files when that capability is available. Save website logins in the specific bot’s
            Settings → Sign-in credentials, then tell it which site or account to use. Complete any
            additional sign-in or authorization when requested.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>Keep context and instructions reusable</Trans>}>
        <p>
          <Trans>
            Open the bot’s Settings to review Memory and Skills. Memory holds context worth keeping;
            skills hold instructions for repeatable work. Correct outdated information and save the
            steps that produced a good result. Check what is shared before adding information
            intended for only one agent.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>Turn a proven task into a routine</Trans>}>
        <p>
          <Trans>
            Ask in chat to repeat the task, including the schedule and timezone. For example: “Every
            weekday at 9am America/New_York, review the connected inquiry list and draft a summary
            of items needing a reply. Leave the replies as drafts.” Review the saved task in
            Routines and check its first run before relying on it.
          </Trans>
        </p>
        <p>
          <Trans>
            Tasks can also start from an external event, such as a form submission. The external app
            must be connected to the routine separately; saving a routine does not connect the form.
            Test one submission and check the resulting work.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>When something gets stuck</Trans>}>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <Trans>
              No reply: check that the selected model is connected and look for an error in chat.
            </Trans>
          </li>
          <li>
            <Trans>
              Missing access: check Integrations or complete the requested sign-in on the agent’s
              computer.
            </Trans>
          </li>
          <li>
            <Trans>
              Unexpected result: provide the missing source or a concrete correction. Check whether
              an action already happened before asking the agent to repeat it.
            </Trans>
          </li>
        </ul>
      </GuideSection>
    </>
  );
}

function BusinessGuide() {
  return (
    <>
      <GuideTitle
        intro={
          <Trans>
            Use customer records to track relationships and your workspace to understand the
            business data available to your team.
          </Trans>
        }
      >
        <Trans>Keep your business context organized</Trans>
      </GuideTitle>
      <GuideSection title={<Trans>Start with contacts in CRM</Trans>}>
        <p>
          <Trans>
            Tell an agent to add a contact or lead, including the details you have. For example:
            “Add Jordan Ellis, jordan@example.com, to the CRM as a lead interested in a maintenance
            quote. Check for an existing contact first.” The agent can create or update the record
            from your conversation. Open CRM → Contacts to review it, add notes or tags, or edit
            records yourself.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>Track opportunities in Pipeline</Trans>}>
        <p>
          <Trans>
            Create a deal for an opportunity, link its contact, and choose the stage that reflects
            its current progress. Move the deal as the work advances and mark the outcome when it is
            won or lost. Use CRM Home to review your pipeline totals.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>Read your workspace with context</Trans>}>
        <p>
          <Trans>
            If Workspace appears in your sidebar, it contains the operational views enabled for your
            organization. Check the date range and source status before using its numbers. Available
            sections depend on your organization’s setup; connecting an app does not automatically
            populate every view.
          </Trans>
        </p>
      </GuideSection>
      <GuideSection title={<Trans>Ask agents questions you can verify</Trans>}>
        <p>
          <Trans>
            Name the records and time period you want reviewed. For example: “Review these open
            inquiries, group them by next step, and cite the record for each recommendation.”
            Confirm that the agent can access the source, then check its findings against the
            records before applying changes.
          </Trans>
        </p>
      </GuideSection>
    </>
  );
}
