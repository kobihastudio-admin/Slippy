import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { supabase } from '@/lib/supabase'
import { Brand } from '@/constants/colors'

/**
 * Handles the deep link redirect after OAuth login.
 * URL pattern: slippy://auth/callback#access_token=...&refresh_token=...
 */
export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const url = Linking.getLinkingURL()
    if (url) handleUrl(url)

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url))
    return () => sub.remove()
  }, [])

  async function handleUrl(url: string) {
    try {
      const hash = url.split('#')[1]
      if (!hash) { router.replace('/(auth)/login'); return }

      const params = new URLSearchParams(hash)
      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token')

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (!error) { router.replace('/(app)'); return }
      }
    } catch (_) {}
    router.replace('/(auth)/login')
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={Brand[500]} />
    </View>
  )
}
