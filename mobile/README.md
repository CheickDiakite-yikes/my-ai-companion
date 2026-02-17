# ZeeMe Expo Wrapper

This is a native shell for ZeeMe using Expo + `react-native-webview`.
It is currently Phase 1 in the migration plan at `docs/MOBILE_APP_MIGRATION_PLAN.md`.

## Run

1. Install dependencies:

```bash
npm run mobile:install
```

2. Start the existing web app API/UI:

```bash
npm run dev
```

3. In another terminal, start Expo:

```bash
npm run mobile:start
```

## URL configuration

Set the URL the wrapper should load:

```bash
cp mobile/.env.example mobile/.env
```

Then update `mobile/.env`:

```
EXPO_PUBLIC_WEB_APP_URL=http://localhost:5000
```

Notes:

- Android emulator should usually use `http://10.0.2.2:5000`.
- Physical devices should use your machine's LAN IP, for example `http://192.168.1.20:5000`.
- If you want a hosted URL instead, use `https://zeeme.replit.app`.
