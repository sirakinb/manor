import type { BackgroundJob } from "@rakazo/adapter-kit";
import {
  EmailEmulator,
  EncryptedSecretStore,
  FakePropertyLedger,
  runWorkspaceReport,
} from "@rakazo/adapters";
import { createDb, IsolationError, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceActions,
  WorkspaceActionError,
  type WorkspaceActions,
} from "./workspace-actions.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const NOW = new Date("2026-09-05T15:00:00Z");
const dayAfter = (days: number) =>
  new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + days));
const MONTH_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));

describePostgres("workspace write paths (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `wa-org-${suffix}`;
  const workspaceId = `wa-workspace-${suffix}`;
  const ownerId = `wa-owner-${suffix}`;
  const staffId = `wa-staff-${suffix}`;
  const owner = { organizationId, userId: ownerId, email: `${ownerId}@rakazo.test` };
  const staff = { organizationId, userId: staffId, email: `${staffId}@rakazo.test` };
  const splitBillId = `wa-bill-split-${suffix}`;
  const singleBillId = `wa-bill-single-${suffix}`;
  const unmatchedBillId = `wa-bill-unmatched-${suffix}`;
  const draftReportId = `wa-report-draft-${suffix}`;
  const approvedReportId = `wa-report-approved-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let secrets: EncryptedSecretStore;
  let ledger: FakePropertyLedger;
  let email: EmailEmulator;
  let actions: WorkspaceActions;
  let actionsWithoutEmail: WorkspaceActions;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    secrets = new EncryptedSecretStore("workspace-actions-test-key");
    ledger = new FakePropertyLedger();
    email = new EmailEmulator();
    const base = { prisma, secrets, propertyLedger: () => ledger, now: () => NOW };
    actions = createWorkspaceActions({ ...base, email });
    actionsWithoutEmail = createWorkspaceActions(base);

    for (const [id, role] of [
      [ownerId, "owner"],
      [staffId, "member"],
    ] as const) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@rakazo.test`, emailVerified: false },
      });
      await prisma.organization.upsert({
        where: { id: organizationId },
        create: {
          id: organizationId,
          name: "Write Paths Org",
          slug: organizationId,
          createdAt: NOW,
        },
        update: {},
      });
      await prisma.member.create({
        data: { id: `wa-member-${id}`, organizationId, userId: id, role, createdAt: NOW },
      });
    }
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        organizationId,
        name: "Write Paths Rentals",
        slug: `write-paths-${suffix}`,
        channels: ["utilities", "email", "voice"],
      },
    });

    // Utilities: a split-evenly duplex with two leases, a single-lease house, and a stray bill.
    await prisma.workspaceBuildiumProperty.createMany({
      data: [
        { workspaceId, propertyId: 101, addressLine: "10 Split St" },
        { workspaceId, propertyId: 102, addressLine: "20 Single Rd" },
      ],
    });
    await prisma.workspaceBuildiumLease.createMany({
      data: [
        {
          workspaceId,
          leaseId: 1,
          propertyId: 101,
          unitNumber: "A",
          status: "Active",
          rent: 1000,
          leaseTo: dayAfter(100),
        },
        {
          workspaceId,
          leaseId: 2,
          propertyId: 101,
          unitNumber: "B",
          status: "Active",
          rent: 1200,
          leaseTo: dayAfter(200),
        },
        {
          workspaceId,
          leaseId: 3,
          propertyId: 102,
          unitNumber: "House",
          status: "Active",
          rent: 1500,
          leaseTo: dayAfter(300),
        },
      ],
    });
    await prisma.workspaceUtilityProperty.createMany({
      data: [
        {
          workspaceId,
          address: "10 Split St",
          addressNorm: "10 split street",
          propertyId: 101,
          splitEvenly: true,
        },
        { workspaceId, address: "20 Single Rd", addressNorm: "20 single road", propertyId: 102 },
      ],
    });
    await prisma.workspaceWaterBill.createMany({
      data: [
        {
          id: splitBillId,
          workspaceId,
          gmailMessageId: "m-split",
          serviceAddress: "10 SPLIT ST",
          serviceAddressNorm: "10 split street",
          accountBalance: 100.5,
          dueDate: dayAfter(10),
          billingMonth: MONTH_START,
        },
        {
          id: singleBillId,
          workspaceId,
          gmailMessageId: "m-single",
          serviceAddress: "20 SINGLE RD",
          serviceAddressNorm: "20 single road",
          accountBalance: 80,
          dueDate: dayAfter(20),
          billingMonth: MONTH_START,
        },
        {
          id: unmatchedBillId,
          workspaceId,
          gmailMessageId: "m-stray",
          serviceAddress: "99 NOWHERE",
          serviceAddressNorm: "99 nowhere",
          accountBalance: 40,
          dueDate: dayAfter(5),
          billingMonth: MONTH_START,
        },
      ],
    });

    // Reports: one draft with editable prose, one already approved.
    await prisma.workspaceReport.createMany({
      data: [
        {
          id: draftReportId,
          workspaceId,
          reportType: "email",
          title: "Weekly Email Recap",
          status: "draft",
          summary: "Two campaigns.",
          dateRangeStart: dayAfter(-7),
          dateRangeEnd: NOW,
          report: {
            agg: {
              campaigns: 2,
              delivered: 100,
              opens: 10,
              clicks: 2,
              openRate: 10,
              ctor: 20,
              deliveredRate: 99,
            },
            top_links: [],
            synthesis: { what_worked: [{ title: "Old", detail: "old" }], recommended_actions: [] },
          },
        },
        {
          id: approvedReportId,
          workspaceId,
          reportType: "voice_monthly",
          title: "Voice AI Recap · August 2026",
          status: "final",
          approvedAt: dayAfter(-1),
          approvedBy: "someone@rakazo.test",
          report: {
            metrics: { period: { month_name: "August", year: 2026 }, headline: { total_calls: 8 } },
          },
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await close();
  });

  // ── Settings ──────────────────────────────────────────────────────────

  it("reads and updates settings, owners only", async () => {
    await expect(actions.getSettings(owner)).resolves.toMatchObject({
      activityApproval: "manual",
      waterGlAccountId: null,
      buildiumChargeDescription: "Water bill",
    });
    await expect(actions.updateSettings(staff, { waterGlAccountId: 1 })).rejects.toBeInstanceOf(
      WorkspaceActionError,
    );
    const updated = await actions.updateSettings(owner, {
      waterGlAccountId: 52199,
      reportRecipient: "client@rakazo.test",
      weeklyEmailReportsEnabled: true,
    });
    expect(updated).toMatchObject({
      waterGlAccountId: 52199,
      reportRecipient: "client@rakazo.test",
      weeklyEmailReportsEnabled: true,
      buildiumChargeDescription: "Water bill",
    });
  });

  it("reports the active delivery adapter without exposing configuration", async () => {
    const delivery = {
      describe: () => ({
        id: "smtp",
        displayName: "Resend",
        contractVersion: "1",
        adapterVersion: "1",
        capabilities: { transactional: true },
      }),
      send: vi.fn(),
    };
    const configured = createWorkspaceActions({ prisma, secrets, email: delivery });
    expect((await configured.getSettings(owner)).emailDelivery).toEqual({
      provider: "Resend",
      connected: true,
    });
    expect((await actionsWithoutEmail.getSettings(owner)).emailDelivery).toBeNull();
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it("excludes blocked and direct billing modes from individual and batch charges", async () => {
    const property = await prisma.workspaceUtilityProperty.findFirstOrThrow({
      where: { workspaceId, propertyId: 102 },
    });
    try {
      for (const billingMode of ["blocked", "tenant_direct", "owner_sends_bill"]) {
        await prisma.workspaceUtilityProperty.update({
          where: { id: property.id },
          data: { billingMode },
        });
        await expect(
          actions.postCharge(owner, { waterBillId: singleBillId, leaseId: 3, dryRun: true }),
        ).rejects.toThrow(/does not allow pass-through/);
        const batch = await actions.postAllPending(owner, { dryRun: true });
        expect(batch.results.some((result) => result.waterBillId === singleBillId)).toBe(false);
        expect(batch.results.filter((result) => result.waterBillId === splitBillId)).toHaveLength(
          2,
        );
      }
      expect(ledger.charges).toHaveLength(0);
    } finally {
      await prisma.workspaceUtilityProperty.update({
        where: { id: property.id },
        data: { billingMode: "pass_through" },
      });
    }
  });

  // ── Credentials ───────────────────────────────────────────────────────

  it("stores provider credentials sealed and lists only field names", async () => {
    await expect(
      actions.setCredential(staff, { provider: "buildium", fields: { clientId: "x" } }),
    ).rejects.toBeInstanceOf(WorkspaceActionError);

    const saved = await actions.setCredential(owner, {
      provider: "buildium",
      label: "Buildium (prod)",
      fields: { clientId: "client-123", clientSecret: "hunter2" },
    });
    expect(saved).toMatchObject({
      provider: "buildium",
      label: "Buildium (prod)",
      fields: ["clientId", "clientSecret"],
    });

    const listed = await actions.listCredentials(owner);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("hunter2");
    expect(JSON.stringify(listed)).not.toContain("client-123");

    // Merge: a new field is added, an empty string clears one, values stay sealed at rest.
    const merged = await actions.setCredential(owner, {
      provider: "buildium",
      fields: { clientSecret: "", accountId: "77" },
    });
    expect(merged.fields).toEqual(["accountId", "clientId"]);
    const secretRows = await prisma.secret.findMany({
      where: { kind: "workspace-credential", userId: ownerId },
    });
    expect(secretRows).toHaveLength(1);
    expect(secretRows[0]!.ciphertext).not.toContain("client-123");

    // Restore the secret so posting can proceed below.
    await actions.setCredential(owner, {
      provider: "buildium",
      fields: { clientSecret: "hunter2", accountId: "" },
    });
    await actions.setCredential(owner, {
      provider: "twilio",
      fields: { accountSid: "AC1", authToken: "t" },
    });
    expect((await actions.listCredentials(owner)).map((row) => row.provider)).toEqual([
      "buildium",
      "twilio",
    ]);
    await actions.removeCredential(owner, "twilio");
    expect((await actions.listCredentials(owner)).map((row) => row.provider)).toEqual(["buildium"]);
    expect(
      await prisma.secret.count({ where: { kind: "workspace-credential", userId: ownerId } }),
    ).toBe(1);
  });

  // ── Charges ───────────────────────────────────────────────────────────

  it("refuses to touch charges on an unresolved bill or a lease without a share", async () => {
    await expect(
      actions.saveCharge(owner, { waterBillId: unmatchedBillId, leaseId: 1 }),
    ).rejects.toThrow(/unmatched/);
    await expect(
      actions.skipCharge(owner, { waterBillId: splitBillId, leaseId: 3 }),
    ).rejects.toThrow(/does not carry a share/);
    await expect(
      actions.postCharge(owner, { waterBillId: `nope-${suffix}`, leaseId: 1, dryRun: true }),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("saves an edited amount and memo, skips, and brings a skipped charge back to pending", async () => {
    let overview = await actions.saveCharge(owner, {
      waterBillId: splitBillId,
      leaseId: 1,
      amount: 45,
      memo: "Sept water (A)",
    });
    let charge = overview.bills
      .find((bill) => bill.waterBillId === splitBillId)!
      .charges.find((row) => row.leaseId === 1)!;
    expect(charge).toMatchObject({
      postStatus: "pending",
      postedAmount: 45,
      postedMemo: "Sept water (A)",
      chargeAmount: 50.25,
    });

    overview = await actions.skipCharge(owner, { waterBillId: splitBillId, leaseId: 2 });
    charge = overview.bills
      .find((bill) => bill.waterBillId === splitBillId)!
      .charges.find((row) => row.leaseId === 2)!;
    expect(charge.postStatus).toBe("skipped");

    overview = await actions.saveCharge(owner, { waterBillId: splitBillId, leaseId: 2 });
    charge = overview.bills
      .find((bill) => bill.waterBillId === splitBillId)!
      .charges.find((row) => row.leaseId === 2)!;
    expect(charge).toMatchObject({ postStatus: "pending", postedAmount: 50.25 });
  });

  it("dry-runs the exact ledger payload without touching the ledger or the row", async () => {
    const result = await actions.postCharge(owner, {
      waterBillId: splitBillId,
      leaseId: 1,
      dryRun: true,
      chargeDate: "2026-09-06",
    });
    expect(result).toEqual({
      waterBillId: splitBillId,
      leaseId: 1,
      status: "dry_run",
      amount: 45,
      memo: "Sept water (A)",
      buildiumChargeId: null,
      error: null,
      payload: {
        Date: "2026-09-06",
        Memo: "Sept water (A)",
        Lines: [{ GLAccountId: 52199, Amount: 45, Description: "Water bill" }],
      },
    });
    expect(ledger.charges).toHaveLength(0);
    expect(await prisma.workspaceActivity.count({ where: { workspaceId } })).toBe(0);
  });

  it("refuses to post without a GL account or a Buildium credential", async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { waterGlAccountId: null } });
    await expect(
      actions.postCharge(owner, { waterBillId: splitBillId, leaseId: 1, dryRun: false }),
    ).rejects.toThrow(/water GL account/);
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { waterGlAccountId: 52199 },
    });

    await actions.removeCredential(owner, "buildium");
    await expect(
      actions.postCharge(owner, { waterBillId: splitBillId, leaseId: 1, dryRun: false }),
    ).rejects.toThrow(/Buildium credential/);
    await actions.setCredential(owner, {
      provider: "buildium",
      fields: { clientId: "client-123", clientSecret: "hunter2" },
    });
  });

  it("posts one charge, records the ledger id, and logs an approved activity", async () => {
    const result = await actions.postCharge(owner, {
      waterBillId: splitBillId,
      leaseId: 1,
      dryRun: false,
    });
    expect(result).toMatchObject({
      status: "posted",
      amount: 45,
      memo: "Sept water (A)",
      buildiumChargeId: 9001,
      error: null,
    });
    expect(ledger.charges).toEqual([
      {
        leaseId: 1,
        charge: {
          date: "2026-09-05",
          memo: "Sept water (A)",
          amount: 45,
          accountId: 52199,
          description: "Water bill",
        },
      },
    ]);

    const post = await prisma.workspaceWaterBillChargePost.findUniqueOrThrow({
      where: { waterBillId_leaseId: { waterBillId: splitBillId, leaseId: 1 } },
    });
    expect(post).toMatchObject({
      status: "posted",
      buildiumChargeId: 9001,
      glAccountId: 52199,
      postedBy: owner.email,
      postedAt: NOW,
    });

    const activities = await prisma.workspaceActivity.findMany({ where: { workspaceId } });
    expect(activities).toEqual([
      expect.objectContaining({
        channel: "utilities",
        kind: "charge_posted",
        actor: owner.email,
        verification: "approved",
        verifiedBy: owner.email,
      }),
    ]);
    expect(activities[0]!.payload).toMatchObject({
      waterBillId: splitBillId,
      leaseId: 1,
      amount: 45,
      buildiumChargeId: 9001,
    });

    // Posted charges are final.
    await expect(
      actions.postCharge(owner, { waterBillId: splitBillId, leaseId: 1, dryRun: false }),
    ).rejects.toThrow(/already posted/);
    await expect(
      actions.saveCharge(owner, { waterBillId: splitBillId, leaseId: 1, amount: 1 }),
    ).rejects.toThrow(/already posted/);
    await expect(
      actions.skipCharge(owner, { waterBillId: splitBillId, leaseId: 1 }),
    ).rejects.toThrow(/already posted/);
  });

  it("posts every pending resolved charge, keeps going past a failure, and logs one batch entry", async () => {
    ledger.failLeaseIds.add(3);
    const batch = await actions.postAllPending(owner, { dryRun: false });
    expect(batch.dryRun).toBe(false);
    // Lease 2 (split bill, pending again) and lease 3 (single bill); lease 1 is already posted, the stray bill is unmatched.
    expect(batch.results.map((row) => [row.waterBillId, row.leaseId, row.status])).toEqual([
      [splitBillId, 2, "posted"],
      [singleBillId, 3, "error"],
    ]);
    expect(batch.posted).toBe(1);
    expect(batch.failed).toBe(1);
    expect(batch.results[1]!.error).toContain("422 lease is closed");

    const failed = await prisma.workspaceWaterBillChargePost.findUniqueOrThrow({
      where: { waterBillId_leaseId: { waterBillId: singleBillId, leaseId: 3 } },
    });
    expect(failed).toMatchObject({
      status: "error",
      error: "422 lease is closed",
      buildiumChargeId: null,
    });

    const activities = await prisma.workspaceActivity.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    expect(activities).toHaveLength(2);
    expect(activities[1]!.title).toBe("Posted 1 of 2 pending water charges");
    expect(activities[1]!.payload).toMatchObject({ batch: true, posted: 1, failed: 1 });

    // Nothing pending is left, so a second batch is a no-op and logs nothing.
    const again = await actions.postAllPending(owner, { dryRun: true });
    expect(again.results).toEqual([]);
    expect(await prisma.workspaceActivity.count({ where: { workspaceId } })).toBe(2);
  });

  // ── Reports ───────────────────────────────────────────────────────────

  it("edits a draft's prose within the caps and refuses an approved report", async () => {
    const updated = await actions.updateReport(owner, {
      reportId: draftReportId,
      title: "Weekly Email Recap (edited)",
      summary: "Edited summary.",
      sections: {
        what_worked: [{ title: "New", detail: "x".repeat(2000) }],
        recommended_actions: [{ title: "Do", description: "it" }],
      },
    });
    expect(updated.title).toBe("Weekly Email Recap (edited)");
    expect(updated.summary).toBe("Edited summary.");
    const synthesis = (updated.report as { synthesis: Record<string, unknown[]> }).synthesis;
    expect(synthesis.what_worked).toEqual([{ title: "New", detail: "x".repeat(1200) }]);
    expect(synthesis.recommended_actions).toEqual([
      { title: "Do", description: "it", priority: "medium", action_type: "follow_up" },
    ]);
    const row = await prisma.workspaceReport.findUniqueOrThrow({ where: { id: draftReportId } });
    expect(row).toMatchObject({ editedBy: owner.email, editedAt: NOW });
    expect((row.report as { agg: { campaigns: number } }).agg.campaigns).toBe(2);

    await expect(
      actions.updateReport(owner, { reportId: draftReportId, sections: { agg: [] } }),
    ).rejects.toThrow(/Unknown section/);
    await expect(
      actions.updateReport(owner, { reportId: approvedReportId, title: "Nope" }),
    ).rejects.toThrow(/already approved/);
    await expect(actions.removeReport(owner, approvedReportId)).rejects.toThrow(
      /Only draft reports/,
    );
  });

  it("refuses to send when email is not configured and reports a partial failure", async () => {
    await expect(
      actionsWithoutEmail.sendReport(owner, { reportId: draftReportId, to: ["a@rakazo.test"] }),
    ).rejects.toThrow(/Email sending is not configured/);

    email.sent.length = 0;
    const failing = createWorkspaceActions({
      prisma,
      secrets,
      propertyLedger: () => ledger,
      now: () => NOW,
      email: new EmailEmulator((message) => {
        if (message.to === "bad@rakazo.test") throw new Error("mailbox unavailable");
      }),
    });
    const partial = await failing.sendReport(owner, {
      reportId: draftReportId,
      to: ["ok@rakazo.test", "bad@rakazo.test", "never@rakazo.test"],
    });
    expect(partial.sent).toEqual(["ok@rakazo.test"]);
    expect(partial.error).toContain("bad@rakazo.test");
    expect(partial.report).toMatchObject({
      status: "final",
      approvedAt: NOW.toISOString(),
      sentAt: NOW.toISOString(),
      sentTo: "ok@rakazo.test",
    });
  });

  it("sends the rendered report, merges recipients, and logs the send", async () => {
    const result = await actions.sendReport(owner, {
      reportId: draftReportId,
      to: ["ok@rakazo.test", "two@rakazo.test"],
    });
    expect(result.error).toBeNull();
    expect(result.sent).toEqual(["ok@rakazo.test", "two@rakazo.test"]);
    expect(result.report.sentTo).toBe("ok@rakazo.test, two@rakazo.test");
    expect(email.sent.map((message) => message.to)).toEqual(["ok@rakazo.test", "two@rakazo.test"]);
    expect(email.sent[0]!.subject).toBe("Write Paths Rentals — Weekly Email Recap (edited)");
    expect(email.sent[0]!.html).toContain("Edited summary.");
    expect(email.sent[0]!.html).toContain("Write Paths Rentals · Email Campaign Report");
    expect(email.sent[0]!.text).toContain("Weekly Email Recap (edited)");

    const activities = await prisma.workspaceActivity.findMany({
      where: { workspaceId, kind: "report_sent" },
    });
    expect(activities).toHaveLength(2);
    expect(activities.at(-1)).toMatchObject({
      channel: "email",
      actor: owner.email,
      verification: "approved",
    });

    // Once sent it is approved, so edits and deletion are refused; approve is idempotent.
    await expect(
      actions.updateReport(owner, { reportId: draftReportId, title: "x" }),
    ).rejects.toThrow(/already approved/);
    const approved = await actions.approveReport(owner, draftReportId);
    expect(approved.approvedAt).toBe(NOW.toISOString());
  });

  it("approves and deletes drafts", async () => {
    const draft = await prisma.workspaceReport.create({
      data: { workspaceId, reportType: "voice", title: "Ad hoc", status: "draft", report: {} },
    });
    const approved = await actions.approveReport(owner, draft.id);
    expect(approved).toMatchObject({ approvedAt: NOW.toISOString() });
    await expect(actions.removeReport(owner, draft.id)).rejects.toThrow(/Only draft reports/);

    const another = await prisma.workspaceReport.create({
      data: { workspaceId, reportType: "voice", title: "Scratch", status: "draft", report: {} },
    });
    await actions.removeReport(owner, another.id);
    expect(await prisma.workspaceReport.findUnique({ where: { id: another.id } })).toBeNull();

    // A final report with no approval (the imported monthly recaps) is not a draft.
    const final = await prisma.workspaceReport.create({
      data: {
        workspaceId,
        reportType: "voice_monthly",
        title: "Recap",
        status: "final",
        report: {},
      },
    });
    await expect(actions.removeReport(owner, final.id)).rejects.toThrow(/Only draft reports/);
    expect(await prisma.workspaceReport.findUnique({ where: { id: final.id } })).not.toBeNull();
  });

  it("keeps another organization out", async () => {
    const stranger = {
      organizationId: `wa-stranger-${suffix}`,
      userId: ownerId,
      email: owner.email,
    };
    await expect(actions.getSettings(stranger)).rejects.toBeInstanceOf(IsolationError);
    await expect(actions.listCredentials(stranger)).rejects.toBeInstanceOf(IsolationError);
  });

  it("sends a test copy only to its explicit recipient without approving or marking sent", async () => {
    const row = await prisma.workspaceReport.create({
      data: {
        workspaceId,
        reportType: "email",
        title: "Test preview",
        status: "draft",
        report: { agg: { campaigns: 3 } },
      },
    });
    email.sent.length = 0;
    await expect(
      actions.testReportEmail(staff, { reportId: row.id, to: "tester@rakazo.test" }),
    ).rejects.toThrow(/owners and admins/);
    await actions.testReportEmail(owner, { reportId: row.id, to: "tester@rakazo.test" });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      to: "tester@rakazo.test",
      subject: "[Test] Write Paths Rentals — Test preview",
    });
    expect(await prisma.workspaceReport.findUnique({ where: { id: row.id } })).toEqual(row);
    email.failNextSends();
    await expect(
      actions.testReportEmail(owner, { reportId: row.id, to: "tester@rakazo.test" }),
    ).rejects.toThrow();
    expect(await prisma.workspaceReport.findUnique({ where: { id: row.id } })).toEqual(row);
  });

  it("queues a scoped report, protects unfinished reports, and replays a finished job safely", async () => {
    await actions.setCredential(owner, {
      provider: "openai",
      fields: { apiKey: "fake-report-key" },
    });
    const queued: BackgroundJob[] = [];
    const enqueue = vi.fn(async (job: BackgroundJob) => {
      queued.push(job);
    });
    const queuedActions = createWorkspaceActions({
      prisma,
      secrets,
      email,
      jobs: { enqueue, cancel: async () => {} },
    });
    const input = {
      kind: "voice" as const,
      agentType: "tenant" as const,
      from: "2026-08-01",
      to: "2026-08-31",
    };
    await expect(queuedActions.generateReport(staff, input)).rejects.toThrow(/owners and admins/);
    await expect(
      queuedActions.generateReport(owner, { ...input, from: "2026-02-30" }),
    ).rejects.toThrow(/valid/);
    const row = await queuedActions.generateReport(owner, input);
    expect(row.status).toBe("queued");
    expect(queued[0]).toMatchObject({
      name: "workspace.report.generate",
      payload: { reportId: row.id },
    });
    await expect(
      queuedActions.sendReport(owner, { reportId: row.id, to: ["tester@rakazo.test"] }),
    ).rejects.toThrow(/not ready/);
    await expect(queuedActions.approveReport(owner, row.id)).rejects.toThrow(/not ready/);
    await expect(
      queuedActions.testReportEmail(owner, { reportId: row.id, to: "tester@rakazo.test" }),
    ).rejects.toThrow(/finished/);
    const run = vi.fn(async () => {
      await prisma.workspaceReport.update({
        where: { id: row.id },
        data: { status: "draft", report: { stats: { total_calls: 5 } }, generatedAt: NOW },
      });
      return { ok: true, recordsLoaded: 1 };
    });
    const runner = { prisma, secrets, ingestion: { run } };
    await runWorkspaceReport(runner, row.id);
    await runWorkspaceReport(runner, row.id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, pipeline: "reports" }));
    enqueue.mockRejectedValueOnce(new Error("queue down"));
    await expect(queuedActions.generateReport(owner, input)).rejects.toThrow(/Could not queue/);
    const errors = await prisma.workspaceReport.findMany({
      where: { workspaceId, status: "error" },
    });
    expect(errors.some((entry) => entry.summary?.includes("Could not queue"))).toBe(true);
    const unavailable = await queuedActions.generateReport(owner, input);
    await runWorkspaceReport({ prisma, secrets }, unavailable.id);
    expect(
      await prisma.workspaceReport.findUnique({ where: { id: unavailable.id } }),
    ).toMatchObject({ status: "error", approvedAt: null, sentAt: null });
  });
});
