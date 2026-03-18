import assert from "node:assert/strict";
import {
  isTransientGoogleActionMemorySummary,
  shouldPersistDurableMemorySummary,
} from "../server/memory-contracts";
import {
  extractMemoryKeywords,
  planMemoryQueries,
  type StructuredGoogleActionMemoryHints,
} from "../server/memory-query-planner";

function planKinds(plan: ReturnType<typeof planMemoryQueries>): string[] {
  return plan.map((entry) => entry.kind);
}

function main(): void {
  assert.equal(
    isTransientGoogleActionMemorySummary("Draft saved to your Gmail and ready to send."),
    true,
  );
  assert.equal(
    isTransientGoogleActionMemorySummary("The event is all set for tomorrow at 3 PM."),
    true,
  );
  assert.equal(
    isTransientGoogleActionMemorySummary("Calendar action is still waiting for approval."),
    true,
  );
  assert.equal(
    isTransientGoogleActionMemorySummary("User prefers short, warm check-in emails."),
    false,
  );
  assert.equal(
    isTransientGoogleActionMemorySummary(
      "The user usually keeps weekly meditation invites brief.",
    ),
    false,
  );

  assert.equal(
    shouldPersistDurableMemorySummary("User prefers short, warm check-in emails."),
    true,
  );
  assert.equal(
    shouldPersistDurableMemorySummary("Needs approval before sending the message."),
    false,
  );
  assert.equal(
    shouldPersistDurableMemorySummary("Event created for tomorrow afternoon."),
    false,
  );

  assert.deepEqual(
    extractMemoryKeywords(
      "Please draft an email to contact@cheickdiakite.com and keep it short, warm, and casual.",
    ),
    ["please", "draft", "email", "contact", "cheickdiakite", "keep", "short", "warm", "casual"],
  );

  const gmailHints: StructuredGoogleActionMemoryHints = {
    activeConnector: "gmail",
    hasPendingApproval: true,
    hasComposeSession: false,
    hasCalendarSession: false,
    hasActionAmbiguity: false,
    entityHints: ["contact@cheickdiakite.com", "Checking in for the 15th"],
  };

  const gmailPlan = planMemoryQueries({
    activeHistory: [
      {
        sender: "user",
        text: "Can you draft an email to contact@cheickdiakite.com about dinner plans for the 15th and keep it short and warm?",
        createdAt: new Date("2026-03-18T12:00:00.000Z"),
      },
      {
        sender: "assistant",
        text: "Sure. I can draft that. Do you want it casual or more formal?",
        createdAt: new Date("2026-03-18T12:00:05.000Z"),
      },
      {
        sender: "user",
        text: "Casual is good. Sounds good, save it.",
        createdAt: new Date("2026-03-18T12:00:10.000Z"),
      },
    ],
    googleHints: gmailHints,
  });

  assert.equal(gmailPlan[0]?.kind, "general_continuity");
  assert.ok(planKinds(gmailPlan).includes("people_relationships"));
  assert.ok(planKinds(gmailPlan).includes("preferences_style"));
  assert.ok(planKinds(gmailPlan).includes("open_loops_commitments"));
  assert.ok(gmailPlan.length <= 4);

  const calendarPlan = planMemoryQueries({
    activeHistory: [
      {
        sender: "user",
        text: "Please move my meditation event tomorrow to 3 PM and keep it on my calendar.",
        createdAt: new Date("2026-03-18T14:00:00.000Z"),
      },
    ],
    googleHints: {
      activeConnector: "calendar",
      hasPendingApproval: true,
      hasComposeSession: false,
      hasCalendarSession: true,
      hasActionAmbiguity: false,
      entityHints: ["meditation"],
    },
  });

  assert.equal(calendarPlan[0]?.kind, "general_continuity");
  assert.ok(planKinds(calendarPlan).includes("plans_schedule"));
  assert.ok(planKinds(calendarPlan).includes("open_loops_commitments"));

  const emptyPlan = planMemoryQueries({
    activeHistory: [
      {
        sender: "user",
        text: "ok",
        createdAt: new Date("2026-03-18T14:00:00.000Z"),
      },
    ],
    googleHints: null,
  });
  assert.deepEqual(emptyPlan, []);

  console.log("memory-v2 smoke checks passed");
}

main();
