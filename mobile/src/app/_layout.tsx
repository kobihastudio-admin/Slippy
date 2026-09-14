import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '@/store/auth.store'

export default function RootLayout() {
  const initialize = useAuthStore(s => s.initialize)
  useEffect(() => { initialize() }, [initialize])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)"              options={{ animation: 'fade' }} />
          <Stack.Screen name="(app)"               options={{ animation: 'fade' }} />
          <Stack.Screen name="auth/callback"       options={{ animation: 'none' }} />
          <Stack.Screen name="(app)/messages/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
          <Stack.Screen name="(app)/pay/[id]"      options={{ headerShown: false, animation: 'slide_from_bottom' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
