import assert from "node:assert/strict";

async function run(): Promise<void> {
  const {
    detectGooglePersonalContextIntent,
    inferGoogleEmailSinceDays,
    resolveCalendarTimeRange,
    resolveGoogleContextTimeZone,
  } = await import("../server/google-integration.ts");

  const calendarPrompt = "what do i have on my calendar today?";
  const emailPrompt = "can you summarize my unread emails from last day";
  const combinedPrompt =
    "any key emails or events i should have on mind this week?";

  const calendarIntent = detectGooglePersonalContextIntent(calendarPrompt);
  assert.equal(calendarIntent.calendarIntent, true, "calendar prompt should set calendarIntent");
  assert.equal(calendarIntent.emailIntent, false, "calendar prompt should not set emailIntent");
  assert.equal(calendarIntent.timeRange, "today", "calendar prompt should infer today");

  const emailIntent = detectGooglePersonalContextIntent(emailPrompt);
  assert.equal(emailIntent.calendarIntent, false, "email prompt should not set calendarIntent");
  assert.equal(emailIntent.emailIntent, true, "email prompt should set emailIntent");
  assert.equal(emailIntent.emailUnreadOnly, true, "unread email prompt should set unreadOnly");
  assert.equal(emailIntent.emailSinceDays, 1, "last day email prompt should set sinceDays=1");
  assert.equal(emailIntent.timeRange, "today", "email prompt should default to today");

  const combinedIntent = detectGooglePersonalContextIntent(combinedPrompt);
  assert.equal(combinedIntent.calendarIntent, true, "combined prompt should set calendarIntent");
  assert.equal(combinedIntent.emailIntent, true, "combined prompt should set emailIntent");
  assert.equal(combinedIntent.emailUnreadOnly, false, "combined prompt should not force unreadOnly");
  assert.equal(combinedIntent.emailSinceDays, 3, "combined prompt should default email lookback");
  assert.equal(combinedIntent.timeRange, "this_week", "combined prompt should infer this_week");

  assert.equal(
    detectGooglePersonalContextIntent("let's just chat").calendarIntent,
    false,
    "casual prompt should not trigger calendar intent",
  );
  assert.equal(
    detectGooglePersonalContextIntent("let's just chat").emailIntent,
    false,
    "casual prompt should not trigger email intent",
  );

  assert.equal(
    inferGoogleEmailSinceDays("summarize unread emails from last day"),
    1,
    "last day should map to sinceDays=1",
  );
  assert.equal(
    inferGoogleEmailSinceDays("anything from yesterday in my inbox?"),
    1,
    "yesterday should map to sinceDays=1",
  );
  assert.equal(
    inferGoogleEmailSinceDays("show my key emails from the past week"),
    7,
    "past week should map to sinceDays=7",
  );
  assert.equal(
    inferGoogleEmailSinceDays("summarize my unread emails"),
    3,
    "default lookback should be 3 days",
  );

  const timezone = resolveGoogleContextTimeZone("America/New_York");
  assert.equal(timezone, "America/New_York", "valid timezone should be preserved");
  const fallbackTimezone = resolveGoogleContextTimeZone("Invalid/Timezone");
  assert.ok(fallbackTimezone.length > 0, "fallback timezone should always resolve");

  const ranges = ["today", "tomorrow", "this_week", "next_7_days"] as const;
  for (const timeRange of ranges) {
    const { timeMin, timeMax } = resolveCalendarTimeRange({
      timeRange,
      timezone: "America/New_York",
    });

    const start = Date.parse(timeMin);
    const end = Date.parse(timeMax);
    assert.ok(Number.isFinite(start), `${timeRange} timeMin should be valid ISO`);
    assert.ok(Number.isFinite(end), `${timeRange} timeMax should be valid ISO`);
    assert.ok(end > start, `${timeRange} timeMax should be after timeMin`);

    const hours = (end - start) / (1000 * 60 * 60);
    if (timeRange === "today" || timeRange === "tomorrow") {
      assert.ok(hours >= 23 && hours <= 25, `${timeRange} should span approximately one day`);
    }
    if (timeRange === "this_week") {
      assert.ok(hours > 0 && hours <= 7 * 25, "this_week should stay within week boundary");
    }
    if (timeRange === "next_7_days") {
      assert.ok(hours >= 6 * 23 && hours <= 8 * 25, "next_7_days should span about seven days");
    }
  }

  const todayRange = resolveCalendarTimeRange({
    timeRange: "today",
    timezone: "America/New_York",
  });
  const tomorrowRange = resolveCalendarTimeRange({
    timeRange: "tomorrow",
    timezone: "America/New_York",
  });
  assert.ok(
    Date.parse(tomorrowRange.timeMin) > Date.parse(todayRange.timeMin),
    "tomorrow range should start after today range",
  );

  console.log("google-personal-context smoke checks passed");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
