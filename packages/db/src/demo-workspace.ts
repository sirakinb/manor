import { randomUUID } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { WORKSPACE_AUTOMATIONS } from "./workspace-automations.js";

/** Create a fictional, disconnected demo. Refuses to overwrite any existing organization. */
export async function createDemoWorkspace(prisma: PrismaClient, now = new Date()) {
  return prisma.$transaction(
    async (tx) => {
      if (await tx.organization.findUnique({ where: { brandId: "meridian" } }))
        throw new Error("The demo organization already exists.");
      const organizationId = randomUUID();
      const spaceId = randomUUID();
      await tx.organization.create({
        data: {
          id: organizationId,
          name: "Meridian Properties",
          slug: "meridian-properties",
          brandId: "meridian",
          metadata: JSON.stringify({ demo: true }),
          createdAt: now,
        },
      });
      await tx.space.create({
        data: { id: spaceId, organizationId, name: "Meridian Properties", isDefault: true },
      });
      const workspace = await tx.workspace.create({
        data: {
          organizationId,
          name: "Meridian Properties",
          slug: "meridian-properties",
          channels: ["voice", "email", "social", "leasing", "utilities"],
          activityApproval: "manual",
        },
      });
      const workspaceId = workspace.id;
      const ago = (days: number) => new Date(now.getTime() - days * 86400000);
      const sources = [
        ["Zoho CRM", "voice"],
        ["Zoho Campaigns", "email"],
        ["Instagram", "social"],
        ["Buildium", "leasing"],
        ["Listings", "leasing"],
        ["Gmail", "utilities"],
      ];
      for (const [name, sourceType] of sources) {
        const source = await tx.workspaceSource.create({
          data: {
            workspaceId,
            name: name!,
            sourceType,
            status: "connected",
            connectionMethod: "Demo snapshot",
            lastSyncedAt: now,
            config: { demo: true },
          },
        });
        await tx.workspaceSyncRun.create({
          data: {
            workspaceId,
            sourceId: source.id,
            status: "success",
            startedAt: ago(0.02),
            finishedAt: now,
            recordsLoaded: 120,
            metadata: { demo: true },
          },
        });
      }
      await tx.workspaceAutomation.createMany({
        data: WORKSPACE_AUTOMATIONS.map((spec) => ({
          workspaceId,
          key: spec.key,
          label: spec.label,
          pipeline: spec.pipeline,
          crons: [...spec.crons],
          enabled: false,
          timezone: "America/New_York",
        })),
      });
      const names = [
        "Avery Morgan",
        "Casey Ellis",
        "Jordan Blake",
        "Riley Chen",
        "Taylor Reed",
        "Alex Rivera",
      ];
      const reasons = [
        "Available rentals",
        "Maintenance request",
        "Lease renewal",
        "Rent payment",
        "Tour scheduling",
      ];
      for (let i = 0; i < 270; i++) {
        const reason = reasons[i % reasons.length]!;
        const followUp = i % 7 === 0;
        const call = await tx.workspaceVoiceCall.create({
          data: {
            workspaceId,
            sourceCallId: `demo-call-${i}`,
            sourceSystem: "demo",
            agentType: i % 4 === 0 ? "landlord" : "tenant",
            callerName: names[i % names.length],
            callerPhone: `+120255501${String(i % 100).padStart(2, "0")}`,
            callStartedAt: ago(i / 3 + 0.01),
            durationSeconds: 65 + ((i * 37) % 380),
            callbackRequested: followUp,
            aiResolved: !followUp,
            aiResolutionNotes: followUp
              ? "Prepared a follow-up task for the property team."
              : "Answered the caller's question using the property guide.",
          },
        });
        await tx.workspaceVoiceTranscript.create({
          data: {
            workspaceId,
            voiceCallId: call.id,
            transcriptText: `Agent: Thank you for calling Meridian Properties. How can I help?\nCaller: I have a question about ${reason.toLowerCase()}.\nAgent: Let me check the property guide for you.\nCaller: Thank you, that is helpful.\nAgent: ${followUp ? "The team will review your request during office hours." : "You are all set. Have a great day!"}`,
          },
        });
        await tx.workspaceVoiceCallAnalysis.create({
          data: {
            workspaceId,
            voiceCallId: call.id,
            summary: `Helped a sample caller with ${reason.toLowerCase()}.`,
            callReason: reason,
            sentiment: i % 9 === 0 ? "neutral" : "positive",
            followUpRequired: followUp,
            tags: ["demo", reason.toLowerCase()],
          },
        });
      }
      for (let i = 0; i < 24; i++) {
        const delivered = 2840 + i * 13;
        const opens = 980 + i * 8;
        const clicks = 117 + i * 3;
        const sourceCampaignId = `demo-campaign-${i}`;
        await tx.workspaceEmailCampaign.create({
          data: {
            workspaceId,
            sourceCampaignId,
            name:
              ["Open doors", "Neighborhood notes", "Your next home"][i % 3] +
              ` · ${ago(i * 3)
                .toISOString()
                .slice(0, 10)}`,
            subject: [
              "Find your next home this week",
              "A little more room to grow",
              "Fresh listings, welcoming neighborhoods",
            ][i % 3],
            preheader: "Explore this week's Meridian Properties rental update.",
            topic: "Available rentals",
            senderName: "Meridian Properties",
            fromEmail: "hello@meridian.example",
            status: "sent",
            sentAt: ago(i * 3 + 0.1),
            emailsSent: delivered + 18,
            delivered,
            opens,
            uniqueClicks: clicks,
            unopened: delivered - opens,
            bounces: 18,
            unsubscribes: 2,
            deliveredPercent: (delivered / (delivered + 18)) * 100,
            openPercent: (opens / delivered) * 100,
            clickPercent: (clicks / delivered) * 100,
            clicksPerOpen: (clicks / opens) * 100,
            statsSyncedAt: now,
          },
        });
        await tx.workspaceEmailCampaignLink.create({
          data: {
            workspaceId,
            sourceCampaignId,
            url: "https://meridian.example/available-homes",
            uniqueClickers: clicks,
            totalClicks: clicks + 24,
          },
        });
      }
      await tx.workspaceInstagramStats.create({
        data: {
          workspaceId,
          igUserId: "demo-instagram",
          username: "meridianproperties_demo",
          name: "Meridian Properties",
          biography:
            "Find your place in a welcoming neighborhood. Fictional demonstration account.",
          followers: 3428,
          follows: 218,
          mediaCount: 86,
          reach28d: 24680,
          profileViews28d: 1824,
          accountsEngaged28d: 1340,
          totalInteractions28d: 2160,
        },
      });
      await tx.workspaceInstagramDaily.createMany({
        data: Array.from({ length: 90 }, (_, i) => ({
          workspaceId,
          igUserId: "demo-instagram",
          date: ago(i),
          followers: 3428 - i * 8,
          follows: 218,
          mediaCount: 86 - Math.floor(i / 3),
          reach: 500 + ((i * 137) % 1200),
          newFollowers: 4 + (i % 9),
        })),
      });
      await tx.workspaceInstagramMedia.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({
          workspaceId,
          igUserId: "demo-instagram",
          mediaId: `demo-post-${i}`,
          mediaType: i % 3 ? "IMAGE" : "VIDEO",
          caption: [
            "Sunlit rooms and space to settle in. Your next chapter starts here.",
            "A neighborhood guide to your weekend.",
            "Step inside: a fresh look at our newest available home.",
          ][i % 3],
          postedAt: ago(i * 3),
          likeCount: 78 + i * 3,
          commentsCount: 6 + (i % 12),
          reach: 1400 + i * 87,
          views: 1750 + i * 93,
          saved: 12 + (i % 7),
          shares: 8 + (i % 5),
          totalInteractions: 104 + i * 3,
        })),
      });
      for (let p = 0; p < 18; p++) {
        const propertyId = 9000 + p;
        const address = `${100 + p * 10} ${["Sunrise Lane", "Meadow Way", "Cedar Walk"][p % 3]}`;
        const name = `${["Sunrise Court", "Meadow Terrace", "Cedar Gardens"][p % 3]} ${p + 1}`;
        await tx.workspaceBuildiumProperty.create({
          data: {
            workspaceId,
            propertyId,
            name,
            addressLine: address,
            city: "Sampleton",
            state: "PA",
            postalCode: "00000",
            isActive: true,
            numberUnits: 4,
            rentalType: "Residential",
            rentalSubType: "MultiFamily",
            yearBuilt: 1998 + p,
            rentalManager: "Meridian Demo Team",
          },
        });
        await tx.workspaceUtilityProperty.create({
          data: {
            workspaceId,
            propertyId,
            address,
            addressNorm: address.toLowerCase(),
            splitEvenly: true,
          },
        });
        for (let u = 0; u < 4; u++) {
          const unitId = propertyId * 10 + u;
          const occupied = u !== 3 || p % 3 !== 0;
          const rent = 1250 + p * 35 + u * 100;
          await tx.workspaceBuildiumUnit.create({
            data: {
              workspaceId,
              unitId,
              propertyId,
              unitNumber: `${u + 1}`,
              buildingName: name,
              addressLine: address,
              city: "Sampleton",
              state: "PA",
              marketRent: rent,
              bedrooms: String(1 + (u % 3)),
              bathrooms: "1",
              unitSize: 750 + u * 200,
              isOccupied: occupied,
              isListed: !occupied,
            },
          });
          if (occupied)
            await tx.workspaceBuildiumLease.create({
              data: {
                workspaceId,
                leaseId: unitId,
                propertyId,
                unitId,
                unitNumber: `${u + 1}`,
                status: "Active",
                termType: "Fixed",
                leaseType: "Standard",
                leaseFrom: ago(270),
                leaseTo: ago(-95 - p * 8),
                rent,
                securityDeposit: rent,
                numberOfOccupants: 1 + u,
                sourceCreatedAt: ago(270),
              },
            });
          else {
            await tx.workspaceBuildiumListing.create({
              data: {
                workspaceId,
                unitId,
                propertyId,
                propertyName: name,
                addressLine: address,
                unitNumber: `${u + 1}`,
                city: "Sampleton",
                state: "PA",
                bedrooms: String(1 + (u % 3)),
                bathrooms: "1",
                rent,
                deposit: rent,
                availableDate: ago(-7),
                listingDate: ago(10 + p),
                unitSize: 750 + u * 200,
                leaseTerms: "12 months",
                isSection8: p % 2 === 0,
              },
            });
            await tx.workspaceRemaListing.create({
              data: {
                workspaceId,
                listableUid: `demo-listing-${unitId}`,
                title: name,
                streetAddress: address,
                streetNorm: address.toLowerCase(),
                fullAddress: `${address}, Unit ${u + 1}, Sampleton`,
                unit: `${u + 1}`,
                rent,
                bedBath: "1 bed / 1 bath",
                detailUrl: "https://meridian.example/available-homes",
                isSection8: p % 2 === 0,
              },
            });
            await tx.workspaceSheetListing.create({
              data: {
                workspaceId,
                rawName: `${address} Unit ${u + 1}`,
                streetAddress: address,
                streetNorm: address.toLowerCase(),
                unitNote: `${u + 1}`,
                rent,
                rentText: String(rent),
                beds: "1",
                baths: "1",
                isSection8: p % 2 === 0,
              },
            });
          }
        }
        const bill = await tx.workspaceWaterBill.create({
          data: {
            workspaceId,
            gmailMessageId: `demo-bill-${p}`,
            receivedAt: ago(2 + p / 3),
            serviceAddress: address,
            serviceAddressNorm: address.toLowerCase(),
            sourceSender: "water@utility.example",
            amountDue: 145 + p * 7,
            accountBalance: 145 + p * 7,
            dueDate: ago(-14),
            billingMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
            parseStatus: p % 7 === 0 ? "needs_review" : "parsed",
          },
        });
        if (p > 5)
          await tx.workspaceWaterBillChargePost.create({
            data: {
              workspaceId,
              waterBillId: bill.id,
              leaseId: propertyId * 10,
              amount: (145 + p * 7) / 4,
              status: "posted",
              postedAt: ago(1),
              memo: "Sample water charge",
              postedBy: "demo",
            },
          });
      }
      await tx.workspaceBuildiumApplication.createMany({
        data: Array.from({ length: 36 }, (_, i) => ({
          workspaceId,
          applicantId: 5000 + i,
          applicationId: 6000 + i,
          applicationNumber: `DEMO-${100 + i}`,
          status: ["Approved", "Pending", "Submitted"][i % 3],
          applicationStatus: ["Approved", "Pending", "Submitted"][i % 3],
          propertyId: 9000 + (i % 18),
          unitId: (9000 + (i % 18)) * 10 + 3,
          submittedAt: ago(i * 2),
        })),
      });
      for (let i = 0; i < 6; i++)
        await tx.workspaceReport.create({
          data: {
            workspaceId,
            reportType: i % 2 ? "email" : "voice",
            title: `${i % 2 ? "Weekly email recap" : "Voice operations review"} · Meridian`,
            status: "draft",
            dateRangeStart: ago(7 + i * 7),
            dateRangeEnd: ago(i * 7),
            generatedAt: ago(i * 7),
            generatedBy: "demo",
            summary:
              "Strong engagement and timely follow-up across the portfolio. Sample report for demonstration.",
            report: {
              stats:
                i % 2
                  ? { campaigns: 3, delivered: 8600, open_rate: 35.9, clicks: 420 }
                  : { calls: 63, resolved: 54, follow_ups: 9 },
              synthesis: {
                summary:
                  "The team handled routine questions promptly and surfaced requests needing a personal follow-up.",
                what_worked: [
                  {
                    title: "Clear next steps",
                    detail: "Tour requests and rental questions received a useful first response.",
                  },
                ],
                what_underperformed: [
                  {
                    title: "After-hours callbacks",
                    detail: "A small queue carried into the next business day.",
                  },
                ],
                recommended_actions: [
                  {
                    title: "Review callback queue",
                    detail: "Prioritize requests before the next property tour window.",
                  },
                ],
              },
            },
          },
        });
      await tx.workspaceActivity.createMany({
        data: Array.from({ length: 40 }, (_, i) => ({
          workspaceId,
          channel: ["voice", "email", "social", "leasing", "utilities"][i % 5]!,
          kind: "demo",
          title: [
            "Rental inquiry resolved",
            "Campaign performance reviewed",
            "Social insights updated",
            "Available homes refreshed",
            "Water bill matched",
          ][i % 5]!,
          summary: "Sample activity from the Meridian demonstration workspace.",
          actor: "Meridian team",
          verification: "approved",
          createdAt: ago(i / 4),
        })),
      });
      await tx.workspaceContext.createMany({
        data: [
          {
            key: "brand_voice",
            content: "Warm, clear, and welcoming. Help people find a place to call home.",
          },
          {
            key: "constraints",
            content:
              "This workspace is a fictional demonstration. All records are synthetic. Never contact anyone, send a campaign, or post a charge. Explain simulated actions clearly.",
          },
          {
            key: "revenue_model",
            content:
              "Residential property management with a fictional 72-unit portfolio. Fees are illustrative.",
          },
          {
            key: "data_conventions",
            content:
              "All names, addresses, accounts, and metrics are sample data. example domains are placeholders.",
          },
          { key: "office-hours", content: "Monday through Friday, 9 AM to 5 PM Eastern." },
        ].map((row) => ({ ...row, workspaceId, updatedBy: "demo" })),
      });
      await tx.workspaceSkill.createMany({
        data: [
          {
            name: "available-properties-refresh",
            content:
              "# Available properties\nCompare leasing units, listings, and the property sheet. Summarize vacancies and mismatches. Demo only: do not publish or call external services.",
          },
          {
            name: "email-campaign-pipeline",
            content:
              "# Email campaign review\nReview engagement, draft a clear rental update, and propose a subject line. Demo only: save drafts for review and do not send.",
          },
        ].map((row) => ({ ...row, workspaceId, createdBy: "demo" })),
      });
      return { organizationId, spaceId, workspaceId };
    },
    { timeout: 60000 },
  );
}
