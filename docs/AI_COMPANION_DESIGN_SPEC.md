# AI Companion Design Spec

Source mockup: `ai-companion-design-notes.png`

## Core Experience
Multimodal companion where users can talk live in voice mode, switch into text mode without losing context, and manage account/settings from a profile panel.

## Primary Flow
1. Enter voice mode with selected persona (default Maya).
2. Start call and interact through voice (camera + microphone available in-call).
3. Transition from voice to text via upward swipe/drag motion.
4. Continue same conversation in text mode with preserved transcript context.
5. Open profile page from top-right avatar and manage account/settings.

## Screen Behavior

## Voice Mode View 1 (Idle)
- Persona selector at top-left.
- Profile button at top-right.
- Large primary voice CTA in center.
- Footer with camera, attachment, and "Let us text instead..." style input action.

## Voice Mode View 2 (Active Call)
- Shows live timer at top.
- In-call controls include end call, mute/mic, and camera.
- Same persona/profile controls remain accessible.

## Voice To Text Transition
- Motion intent is a sliding drape/sheet reveal.
- Transition should feel continuous, not a hard scene cut.
- Existing spoken conversation should continue as text history.

## Text Mode View
- Chat bubbles for user and companion.
- Input composer remains anchored at bottom.
- Persona remains visible and switchable.
- Same conversation identity as voice mode.

## Profile Page
- Hero/banner area with quote/tagline.
- Account block (email/identity).
- Settings rows for privacy, permissions, and app settings.
- Accessed from top-right profile button, with clear back navigation.

## Product Notes From Mockup
- Multimodal AI companion with live realtime voice chat and text chat.
- Companion should have camera access in voice mode and in chat where relevant.
- Voice and text must share the same "brain": spoken content should become text context.
- Multiple personality/voice options beyond Maya.

## Design Tokens
- Deep Teal: `#10383A`
- Sage Green: `#809276`
- Olive: `#666E51`
- Mustard: `#DAA112`
- Gray: `#768886`

## Design Vs Current Implementation
- Implemented: Auth flow, onboarding, persona selector, voice/text shell UI, profile shell, message persistence, preference persistence.
- Partially implemented: Voice/text transition (gesture exists, but not full drape choreography + transcript unification).
- Not implemented: AI assistant response generation, realtime voice intelligence, speech-to-text pipeline, camera-aware AI behavior.

