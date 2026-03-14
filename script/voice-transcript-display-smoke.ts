import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createVoiceTranscriptMessageInput,
  formatConversationMessageTextForDisplay,
  formatVoiceTranscriptDisplayText,
  resolveMessageSource,
} from "../shared/message-text.ts";

async function run(): Promise<void> {
  assert.equal(
    formatVoiceTranscriptDisplayText("Ha ppy Fri day , hap py Fri day ."),
    "Happy Friday, happy Friday.",
  );
  assert.equal(formatVoiceTranscriptDisplayText("Ni ce , ni ce."), "Nice, nice.");
  assert.equal(formatVoiceTranscriptDisplayText("pi zza"), "pizza");
  assert.equal(formatVoiceTranscriptDisplayText("go ing"), "going");
  assert.equal(formatVoiceTranscriptDisplayText("rea lly"), "really");
  assert.equal(formatVoiceTranscriptDisplayText("Sor ry"), "Sorry");
  assert.equal(formatVoiceTranscriptDisplayText("caugh t"), "caught");
  assert.equal(formatVoiceTranscriptDisplayText("ear lier"), "earlier");
  assert.equal(formatVoiceTranscriptDisplayText("tel ling"), "telling");
  assert.equal(formatVoiceTranscriptDisplayText("star ted"), "started");
  assert.equal(formatVoiceTranscriptDisplayText("I ' m"), "I'm");
  assert.equal(
    formatVoiceTranscriptDisplayText("list. < noise >"),
    "list.",
  );
  assert.equal(
    formatVoiceTranscriptDisplayText("bar becue chicken."),
    "barbecue chicken.",
  );
  assert.equal(
    formatVoiceTranscriptDisplayText("Um ,   pretty good ."),
    "Um, pretty good.",
  );

  assert.equal(
    formatConversationMessageTextForDisplay({
      sender: "user",
      text: "Ha ppy Fri day , hap py Fri day .",
      messageSource: "voice_transcript",
    }),
    "Happy Friday, happy Friday.",
  );
  assert.equal(
    formatConversationMessageTextForDisplay({
      sender: "user",
      text: "Ha ppy Fri day , hap py Fri day .",
      messageSource: "chat",
    }),
    "Ha ppy Fri day , hap py Fri day .",
  );
  assert.equal(
    formatConversationMessageTextForDisplay({
      sender: "assistant",
      text: "Hi[[ZEE_SPLIT]]there",
      messageSource: "chat",
    }),
    "Hi there",
  );

  for (const sample of [
    "East Village",
    "gonna go",
    "pretty good",
    "chill out",
    "not much",
    "to you",
  ]) {
    assert.equal(formatVoiceTranscriptDisplayText(sample), sample);
  }

  assert.equal(resolveMessageSource(undefined), "chat");
  assert.equal(resolveMessageSource("chat"), "chat");
  assert.equal(resolveMessageSource("voice_transcript"), "voice_transcript");

  const voiceInsert = createVoiceTranscriptMessageInput({
    conversationId: "conversation-123",
    sender: "user",
    text: "Hello there",
  });
  assert.deepEqual(voiceInsert, {
    conversationId: "conversation-123",
    sender: "user",
    text: "Hello there",
    messageSource: "voice_transcript",
  });

  const appSource = await readFile(path.resolve("client/src/App.tsx"), "utf8");
  const liveSource = await readFile(path.resolve("client/src/lib/gemini-live.ts"), "utf8");
  const routesSource = await readFile(path.resolve("server/routes.ts"), "utf8");
  const storageSource = await readFile(path.resolve("server/storage.ts"), "utf8");

  for (const marker of [
    "formatConversationMessageTextForDisplay({",
    "messageSource: msg.messageSource,",
  ]) {
    assert.ok(
      appSource.includes(marker),
      `chat transcript render is missing marker: ${marker}`,
    );
  }

  for (const marker of [
    'messageSource: "chat" as const,',
    "createVoiceTranscriptMessageInput({",
  ]) {
    assert.ok(
      routesSource.includes(marker),
      `message route wiring is missing marker: ${marker}`,
    );
  }

  assert.ok(
    storageSource.includes("messageSource: resolveMessageSource(data.messageSource),"),
    "storage.createMessage must normalize messageSource defaults",
  );

  assert.ok(
    liveSource.includes('live.transcript.user_flush_scheduled_on_assistant_output'),
    "gemini-live should schedule user transcript flush when assistant output begins",
  );

  console.log("voice transcript display checks passed");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
