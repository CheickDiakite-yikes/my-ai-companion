import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { resolveWebAppUrl } from "@zeeme/app-core";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const sourceUrl = useMemo(
    () =>
      resolveWebAppUrl({
        explicitUrl: process.env.EXPO_PUBLIC_WEB_APP_URL,
        platform: (Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web"),
      }),
    []
  );

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.title}>Unable to load ZeeMe</Text>
          <Text style={styles.body}>{loadError}</Text>
          <Text style={styles.body}>Current URL: {sourceUrl}</Text>
          <Pressable onPress={() => setReloadKey((v) => v + 1)} style={styles.button}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#9cb4ff" />
          <Text style={styles.loadingText}>Loading ZeeMe...</Text>
        </View>
      ) : null}
      <WebView
        key={reloadKey}
        source={{ uri: sourceUrl }}
        onLoadStart={() => {
          setLoading(true);
          setLoadError(null);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={(event) => {
          setLoading(false);
          setLoadError(event.nativeEvent.description || "Unknown load error");
        }}
        allowsBackForwardNavigationGestures
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        style={{ backgroundColor: "#070b14" }}
        bounces={false}
        overScrollMode="never"
        scrollEnabled={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#070b14",
  },
  loadingOverlay: {
    position: "absolute",
    zIndex: 2,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#070b14",
  },
  loadingText: {
    color: "#f5f8ff",
    fontSize: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    color: "#f5f8ff",
    fontWeight: "700",
    fontSize: 22,
    textAlign: "center",
  },
  body: {
    color: "#c0cae0",
    fontSize: 15,
    textAlign: "center",
  },
  button: {
    marginTop: 8,
    backgroundColor: "#3455c5",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
