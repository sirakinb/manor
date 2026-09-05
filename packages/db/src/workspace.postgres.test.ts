import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";
import { createWorkspaceRepos, type WorkspaceRepos } from "./workspace.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

// Pinned at test start (not a fixed date) because default `updatedAt` columns
// carry the wall clock, and the pipe rollup compares the two.
const NOW = new Date();
const dayOf = (value: Date) => value.toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const dayAfter = (days: number) =>
  new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + days));
const MONTH_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));

describePostgres("createWorkspaceRepos (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `ws-test-org-${suffix}`;
  const otherOrganizationId = `ws-test-other-${suffix}`;
  const workspaceId = `ws-test-workspace-${suffix}`;
  const actor = { organizationId };
  const stranger = { organizationId: otherOrganizationId };
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let repos: WorkspaceRepos;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    repos = createWorkspaceRepos(prisma, { now: () => NOW });

    for (const id of [organizationId, otherOrganizationId]) {
      await prisma.organization.create({
        data: { id, name: `Workspace test ${id}`, slug: id, createdAt: NOW },
      });
    }
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        organizationId,
        name: "Test Rentals",
        slug: `test-rentals-${suffix}`,
        channels: ["voice", "email", "social", "leasing", "utilities"],
      },
    });

    await prisma.workspaceSource.create({
      data: { workspaceId, name: "zoho", sourceType: "crm", status: "connected" },
    });

    // Voice: four calls in the 30-day window across both agent types, one in the prior window.
    const calls = [
      { sourceCallId: "c1", agentType: "tenant", at: daysAgo(1), ai: true, cb: false },
      { sourceCallId: "c2", agentType: "tenant", at: daysAgo(2), ai: true, cb: true },
      { sourceCallId: "c3", agentType: "tenant", at: daysAgo(10), ai: false, cb: false },
      { sourceCallId: "c4", agentType: "landlord", at: daysAgo(3), ai: false, cb: false },
      { sourceCallId: "c5", agentType: "tenant", at: daysAgo(45), ai: true, cb: false },
    ];
    for (const call of calls) {
      await prisma.workspaceVoiceCall.create({
        data: {
          workspaceId,
          sourceCallId: call.sourceCallId,
          agentType: call.agentType,
          callerName: `Caller ${call.sourceCallId}`,
          callStartedAt: call.at,
          aiResolved: call.ai,
          callbackRequested: call.cb,
          analysis: { create: { workspaceId, summary: `Summary for ${call.sourceCallId}` } },
        },
      });
    }

    // Email: one campaign with links and a device split.
    await prisma.workspaceEmailCampaign.create({
      data: {
        workspaceId,
        sourceCampaignId: "camp-1",
        name: "September newsletter",
        sentAt: daysAgo(10),
        emailsSent: 100,
        delivered: 90,
        opens: 45,
        uniqueClicks: 9,
        bounces: 10,
        hardBounces: 6,
        softBounces: 4,
        unsubscribes: 1,
        spam: 0,
        forwards: 2,
        useragentStats: { device: { computer: 30, mobile: 15, tablet: 0 } },
        statsSyncedAt: daysAgo(1),
      },
    });
    await prisma.workspaceEmailCampaignLink.createMany({
      data: [
        {
          workspaceId,
          sourceCampaignId: "camp-1",
          url: "https://a.test",
          uniqueClickers: 4,
          totalClicks: 5,
        },
        {
          workspaceId,
          sourceCampaignId: "camp-1",
          url: "https://b.test",
          uniqueClickers: 2,
          totalClicks: 3,
        },
      ],
    });

    // Leasing: one property with two active leases, two listings.
    await prisma.workspaceBuildiumProperty.create({
      data: { workspaceId, propertyId: 1001, addressLine: "12 Test St" },
    });
    await prisma.workspaceBuildiumLease.createMany({
      data: [
        {
          workspaceId,
          leaseId: 1,
          propertyId: 1001,
          unitNumber: "A",
          status: "Active",
          rent: 1000,
          leaseTo: dayAfter(30),
        },
        {
          workspaceId,
          leaseId: 2,
          propertyId: 1001,
          unitNumber: "B",
          status: "Active",
          rent: 1200,
          leaseTo: dayAfter(200),
        },
        {
          workspaceId,
          leaseId: 3,
          propertyId: 1002,
          unitNumber: "C",
          status: "Past",
          rent: 900,
          leaseTo: daysAgo(400),
        },
      ],
    });
    await prisma.workspaceBuildiumListing.createMany({
      data: [
        { workspaceId, unitId: 11, propertyId: 1002, rent: 1500, isSection8: true },
        { workspaceId, unitId: 12, propertyId: 1003, rent: 1700, isSection8: false },
      ],
    });

    // Utilities: the two-lease property is split evenly; one bill matches it, one matches nothing.
    await prisma.workspaceUtilityProperty.create({
      data: {
        workspaceId,
        address: "12 Test St",
        addressNorm: "12 test street",
        propertyId: 1001,
        splitEvenly: true,
      },
    });
    await prisma.workspaceWaterBill.createMany({
      data: [
        {
          workspaceId,
          gmailMessageId: "m1",
          serviceAddress: "12 TEST ST",
          serviceAddressNorm: "12 test street",
          accountBalance: 100.5,
          dueDate: dayAfter(20),
          billingMonth: MONTH_START,
        },
        {
          workspaceId,
          gmailMessageId: "m2",
          serviceAddress: "99 NOWHERE RD",
          serviceAddressNorm: "99 nowhere road",
          accountBalance: 40,
          dueDate: dayAfter(5),
          billingMonth: MONTH_START,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
    await close();
  });

  it("reports the workspace from status", async () => {
    await expect(repos.status(actor)).resolves.toEqual({
      workspace: {
        id: workspaceId,
        name: "Test Rentals",
        slug: `test-rentals-${suffix}`,
        channels: ["voice", "email", "social", "leasing", "utilities"],
        activityApproval: "manual",
      },
    });
  });

  it("builds the overview from every channel", async () => {
    const overview = await repos.overview(actor);
    expect(overview.voice).toEqual({
      calls30d: 4,
      aiHandled30d: 2,
      callbacks30d: 1,
      byAgentType: { tenant: 3, landlord: 1 },
    });
    expect(overview.email).toEqual({
      campaignsTotal: 1,
      lastCampaignAt: daysAgo(10).toISOString(),
      lifetimeOpenRatePct: 50,
    });
    expect(overview.social).toEqual({
      instagramUsername: null,
      followers: null,
      reach28d: null,
      accountsEngaged28d: null,
    });
    expect(overview.leasing).toEqual({
      availableListings: 2,
      section8Listings: 1,
      activeLeases: 2,
      monthlyRentRoll: 2200,
    });
    expect(overview.utilities).toEqual({
      billsThisMonth: 2,
      billsNeedingReview: 1,
      chargesPending: 0,
      chargesPosted: 0,
    });
    expect(overview.sources).toHaveLength(1);
    const zoho = overview.sources[0]!;
    const byPipe = Object.fromEntries(
      overview.pipes.map((pipe) => [pipe.key, [pipe.sourceId, pipe.internal]]),
    );
    expect(byPipe).toEqual({
      voice: [zoho.id, false],
      email: [null, false],
      instagram: [null, false],
      buildium: [null, false],
      listings: [null, false],
      water: [null, false],
      recap: [null, true],
    });
    expect(overview.recentActivity).toEqual([]);

    const byKey = Object.fromEntries(overview.pipes.map((pipe) => [pipe.key, pipe.status]));
    expect(byKey).toMatchObject({ email: "flowing", instagram: "idle", recap: "idle" });
    // Rows touched by this run read "working"; the email stats synced a day ago read "fresh".
    expect(overview.team.map((worker) => [worker.key, worker.status])).toEqual([
      ["call-logger", "working"],
      ["email-tracker", "fresh"],
      ["social-monitor", "setting_up"],
      ["leasing-sync", "working"],
      ["water-clerk", "working"],
    ]);
  });

  it("computes voice stats against the previous window and fills every day", async () => {
    const stats = await repos.voiceStats(actor, { days: 30 });
    expect(stats).toMatchObject({
      agentType: "all",
      windowDays: 30,
      totalCalls: 4,
      aiHandled: 2,
      aiHandledRatePct: 50,
      callbacksRequested: 1,
      previousPeriod: { totalCalls: 1, aiHandled: 1, callbacksRequested: 0 },
      deltaPct: { totalCalls: 300, aiHandled: 100, callbacksRequested: null },
    });
    expect(stats.daily).toHaveLength(31);
    expect(stats.daily[0]!.day).toBe(dayOf(daysAgo(30)));
    expect(stats.daily.at(-1)!.day).toBe(dayOf(NOW));
    expect(stats.daily.reduce((total, row) => total + row.calls, 0)).toBe(4);
    expect(stats.daily.find((row) => row.day === dayOf(daysAgo(2)))).toEqual({
      day: dayOf(daysAgo(2)),
      calls: 1,
      aiHandled: 1,
    });

    const tenant = await repos.voiceStats(actor, { days: 30, agentType: "tenant" });
    expect(tenant.totalCalls).toBe(3);
    expect(tenant.agentType).toBe("tenant");
  });

  it("lists and searches calls with their summaries", async () => {
    const { calls } = await repos.voiceCalls(actor, {
      days: 30,
      search: "summary for c2",
      callbackOnly: true,
      limit: 10,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ callerName: "Caller c2", summary: "Summary for c2" });
    const detail = await repos.voiceCall(actor, calls[0]!.id);
    expect(detail.transcript).toBeNull();
    expect(detail.tags).toEqual([]);
  });

  it("aggregates email performance with device split and top links", async () => {
    const performance = await repos.emailPerformance(actor, { window: "12m" });
    expect(performance).toMatchObject({
      campaignsTotal: 1,
      emailsSent: 100,
      delivered: 90,
      opens: 45,
      openRatePct: 50,
      clickRatePct: 10,
      listHealth: {
        hardBounces: 6,
        softBounces: 4,
        spamComplaints: 0,
        forwards: 2,
        bounceRatePct: 10,
        unsubRatePct: 1.111,
      },
      deviceSplit: { computer: 30, mobile: 15, tablet: 0 },
    });
    expect(performance.topLinks).toEqual([
      { url: "https://a.test", uniqueClickers: 4, totalClicks: 5, campaigns: 1 },
      { url: "https://b.test", uniqueClickers: 2, totalClicks: 3, campaigns: 1 },
    ]);
    expect(performance.recentCampaigns).toHaveLength(1);
  });

  it("resolves utility targets and splits bills across leases", async () => {
    const utilities = await repos.utilitiesOverview(actor);
    expect(utilities.targets).toHaveLength(1);
    expect(utilities.targets[0]).toMatchObject({
      address: "12 Test St",
      buildiumAddress: "12 Test St",
      propertyId: 1001,
      activeLeaseCount: 2,
      targetStatus: "resolved",
    });
    expect(utilities.targets[0]!.leases.map((lease) => [lease.leaseId, lease.chargeShare])).toEqual(
      [
        [1, 0.5],
        [2, 0.5],
      ],
    );

    expect(utilities.bills.map((bill) => bill.serviceAddress)).toEqual([
      "12 TEST ST",
      "99 NOWHERE RD",
    ]);
    const [matched, unmatched] = utilities.bills;
    expect(matched).toMatchObject({
      memo: `${MONTH_START.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${MONTH_START.getUTCFullYear()} water`,
      billAmount: 100.5,
      resolutionStatus: "resolved",
      billingMode: "pass_through",
    });
    expect(matched!.charges).toEqual([
      expect.objectContaining({
        leaseId: 1,
        unitNumber: "A",
        chargeShare: 0.5,
        chargeAmount: 50.25,
        postStatus: "pending",
      }),
      expect.objectContaining({
        leaseId: 2,
        unitNumber: "B",
        chargeShare: 0.5,
        chargeAmount: 50.25,
        postStatus: "pending",
      }),
    ]);
    expect(unmatched).toMatchObject({
      resolutionStatus: "unmatched",
      billingMode: null,
      charges: [],
    });
  });

  it("summarizes leasing", async () => {
    const snapshot = await repos.leasingSnapshot(actor);
    expect(snapshot.leases).toMatchObject({
      active: 2,
      monthlyRentRoll: 2200,
      avgRent: 1100,
      holdover: 0,
      expiringNext90d: 1,
    });
    expect(snapshot.leases.upcomingExpirations).toEqual([
      {
        leaseId: 1,
        propertyAddress: "12 Test St",
        unitNumber: "A",
        leaseTo: dayOf(dayAfter(30)),
        rent: 1000,
      },
    ]);
    expect(snapshot.applications).toEqual({
      last30d: 0,
      deltaPctVsPrior30d: null,
      approvalRatePct: null,
      funnel: [],
      monthlySubmissions12m: [],
    });
    const rentals = await repos.availableRentals(actor, { filter: "section8" });
    expect(rentals).toMatchObject({ count: 1, section8Count: 1, avgRent: 1500 });
  });

  it("buckets days and months by UTC wall clock even on a non-UTC session", async () => {
    // A pool whose every connection runs in New York: 01:30Z is the previous
    // local day and, on the 1st, the previous local month.
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c TimeZone=America/New_York");
    const local = createDb(url.toString());
    const localRepos = createWorkspaceRepos(local.prisma, { now: () => NOW });
    const at = new Date(
      Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - 4, 1, 30),
    );
    const firstOfMonth = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1, 1, 30));
    const call = await prisma.workspaceVoiceCall.create({
      data: { workspaceId, sourceCallId: "tz-call", agentType: "tenant", callStartedAt: at },
    });
    const application = await prisma.workspaceBuildiumApplication.create({
      data: { workspaceId, applicantId: 9001, applicationStatus: "New", submittedAt: firstOfMonth },
    });
    try {
      const [session] = await local.prisma.$queryRaw<{ TimeZone: string }[]>`show TimeZone`;
      expect(session?.TimeZone).toBe("America/New_York");

      for (const target of [repos, localRepos]) {
        const stats = await target.voiceStats(actor, { days: 30 });
        expect(stats.daily.find((row) => row.day === dayOf(at))).toMatchObject({ calls: 1 });
        const snapshot = await target.leasingSnapshot(actor);
        expect(snapshot.applications.monthlySubmissions12m).toEqual([
          { month: dayOf(firstOfMonth).slice(0, 7), applications: 1 },
        ]);
      }
    } finally {
      await prisma.workspaceVoiceCall.delete({ where: { id: call.id } });
      await prisma.workspaceBuildiumApplication.delete({ where: { id: application.id } });
      await local.prisma.$disconnect();
      await local.pool.end();
    }
  });

  it("keeps another organization out", async () => {
    await expect(repos.status(stranger)).resolves.toEqual({ workspace: null });
    await expect(repos.overview(stranger)).rejects.toBeInstanceOf(IsolationError);
    await expect(repos.getSkill(actor, { name: "missing" })).rejects.toBeInstanceOf(IsolationError);
  });
});
