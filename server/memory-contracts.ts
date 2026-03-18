function normalizeMemoryWorkflowText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const DURABLE_GOOGLE_PREFERENCE_PATTERNS = [
  /\bprefer(?:s|red)?\b/i,
  /\busually\b/i,
  /\boften\b/i,
  /\bevery\b/i,
  /\bweekly\b/i,
  /\bdaily\b/i,
  /\brecurring\b/i,
  /\btends to\b/i,
  /\bhabit\b/i,
  /\btone\b/i,
  /\bstyle\b/i,
  /\bcasual\b/i,
  /\bformal\b/i,
  /\bwarm\b/i,
  /\bshort\b/i,
  /\bbrief\b/i,
];

const TRANSIENT_GOOGLE_ACTION_PATTERNS = [
  /\bneeds approval\b/i,
  /\bapproval required\b/i,
  /\bapproval (?:is )?still pending\b/i,
  /\bwaiting for approval\b/i,
  /\bawait(?:ing)? approval\b/i,
  /\bdraft saved\b/i,
  /\bsaved to (?:your )?gmail\b/i,
  /\bready to send\b/i,
  /\bsend approval ready\b/i,
  /\bemail sent to\b/i,
  /\bmessage sent to\b/i,
  /\ball set for\b/i,
  /\ball set on\b/i,
  /\bsent successfully\b/i,
  /\bsaved successfully\b/i,
  /\bevent created\b/i,
  /\bevent updated\b/i,
  /\bcalendar invite sent\b/i,
  /\bcreated [^.]+(?:meeting|event)\b/i,
  /\bupdated [^.]+(?:meeting|event)\b/i,
  /\bmove(?:d)? [^.]+(?:meeting|event)\b/i,
  /\bgoogle action\b/i,
  /\bcompose session\b/i,
  /\bcalendar session\b/i,
];

const GOOGLE_WORKFLOW_SIGNAL_PATTERN =
  /\b(?:gmail|calendar|email|draft|recipient|subject|approval|event|meeting|send|save)\b/i;

export function isTransientGoogleActionMemorySummary(value: string): boolean {
  const normalized = normalizeMemoryWorkflowText(value);
  if (!normalized) return false;

  if (DURABLE_GOOGLE_PREFERENCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (TRANSIENT_GOOGLE_ACTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return (
    GOOGLE_WORKFLOW_SIGNAL_PATTERN.test(normalized) &&
    /\b(?:pending|approved|saved|sent|created|updated|awaiting|ready)\b/i.test(
      normalized,
    )
  );
}

export function shouldPersistDurableMemorySummary(value: string): boolean {
  return !isTransientGoogleActionMemorySummary(value);
}
