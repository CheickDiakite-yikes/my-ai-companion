# TestFlight Runbook

## 1) Preflight
- Run full release gates.
- Confirm environment variables and secrets are configured for production.
- Confirm bundle identifier, app name, and versioning strategy.

## 2) Build Path
If Expo/EAS is configured:
- `npx expo whoami` (or login)
- `npx eas build:configure` (if first-time)
- `npx eas build -p ios --profile preview`

If native iOS project exists without EAS:
- Build/archive with Xcode.
- Upload via Xcode Organizer or Transporter.

## 3) Submission Path
With EAS:
- `npx eas submit -p ios --latest`

Manual:
- Upload `.ipa` to App Store Connect.

## 4) Beta Release Hygiene
- Include test notes for QA (onboarding, chat stream, live voice, quota edge cases).
- Record build number, commit SHA, and release timestamp.

## 5) Failure Handling
- If build fails: capture full logs and stop rollout.
- If submission fails: keep build artifact, fix metadata/credentials, retry submission only.
