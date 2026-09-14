import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import * as Haptics from 'expo-haptics'
import { makeRedirectUri } from 'expo-auth-session'
import { useAuthStore } from '@/store/auth.store'
import { supabase } from '@/lib/supabase'
import { Brand, Light } from '@/constants/colors'

WebBrowser.maybeCompleteAuthSession()

// ─── OAuth helper ─────────────────────────────────────────────────────────────
const REDIRECT = () => makeRedirectUri({ scheme: 'slippy', path: 'auth/callback' })

async function extractAndSetSession(resultUrl: string): Promise<boolean> {
  const hash = resultUrl.split('#')[1]
  if (!hash) return false
  const params = new URLSearchParams(hash)
  const accessToken  = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return false
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  return !error
}

async function signInWithProvider(provider: 'google' | 'facebook' | 'apple') {
  const redirectUri = REDIRECT()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectUri, skipBrowserRedirect: true },
  })
  if (error || !data?.url) throw error ?? new Error('No URL')
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri)
  if (result.type === 'success') await extractAndSetSession(result.url)
  return result
}

async function signInWithLine() {
  const redirectUri = REDIRECT()
  // LINE is a custom OIDC provider — construct Supabase auth URL manually
  const supabaseUrl = 'https://ntzztcnkedcxfjvfxjrf.supabase.co'
  const url =
    `${supabaseUrl}/auth/v1/authorize` +
    `?provider=line` +
    `&redirect_to=${encodeURIComponent(redirectUri)}`
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUri)
  if (result.type === 'success') await extractAndSetSession(result.url)
  return result
}

// ─── Reusable social button ───────────────────────────────────────────────────
function SocialBtn({
  label, bgColor, textColor = '#fff', icon,
  onPress, loading,
}: {
  label: string; bgColor: string; textColor?: string
  icon: string; onPress: () => void; loading?: boolean
}) {
  return (
    <TouchableOpacity
      style={[sb.btn, { backgroundColor: bgColor }]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.82}
    >
      {loading
        ? <ActivityIndicator color={textColor} size="small" />
        : <>
            <Text style={sb.icon}>{icon}</Text>
            <Text style={[sb.label, { color: textColor }]}>{label}</Text>
          </>
      }
    </TouchableOpacity>
  )
}
const sb = StyleSheet.create({
  btn:   { flex: 1, height: 46, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  icon:  { fontSize: 15 },
  label: { fontSize: 12, fontWeight: '700' },
})

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const router = useRouter()
  const signIn = useAuthStore(s => s.signIn)

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPw,       setShowPw]       = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [oauthKey,     setOAuthKey]     = useState<string | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  // Handle OAuth redirect back
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        router.replace('/(app)')
      }
    })
    return () => data.subscription.unsubscribe()
  }, [router])

  const handleEmailLogin = async () => {
    if (!email || !password) { setError('กรุณากรอกอีเมลและรหัสผ่าน'); return }
    setLoading(true); setError(null)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const { error: err } = await signIn(email.trim(), password)
    setLoading(false)
    if (err) setError(err)
    else router.replace('/(app)')
  }

  const runOAuth = async (key: string, fn: () => Promise<any>) => {
    setOAuthKey(key); setError(null)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try { await fn() }
    catch (e: any) { setError(`เข้าสู่ระบบด้วย ${key} ไม่สำเร็จ`) }
    finally { setOAuthKey(null) }
  }

  const busy = loading || oauthKey !== null

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={s.logoWrap} testID="logo-wrap">
          <View style={s.logoBox}>
            <Text style={s.logoEmoji}>🧾</Text>
          </View>
          <Text style={s.appName}>Slippy</Text>
          <Text style={s.tagline}>ระบบจัดการเอกสารบัญชีอัจฉริยะ</Text>
        </View>

        {/* ── Social login ── */}
        <View style={s.socialWrap}>
          {/* Google — full width, most important */}
          <TouchableOpacity
            style={s.googleBtn}
            onPress={() => runOAuth('Google', () => signInWithProvider('google'))}
            disabled={busy}
            activeOpacity={0.82}
            testID="btn-google"
          >
            {oauthKey === 'Google'
              ? <ActivityIndicator color={Light.foreground} />
              : <>
                  <View style={s.googleBadge}>
                    <Text style={s.googleG}>G</Text>
                  </View>
                  <Text style={s.googleText}>เข้าสู่ระบบด้วย Google</Text>
                </>
            }
          </TouchableOpacity>

          {/* Facebook · LINE · Apple  */}
          <View style={s.socialRow}>
            <SocialBtn label="Facebook" bgColor="#1877F2" icon="f"
              onPress={() => runOAuth('Facebook', () => signInWithProvider('facebook'))}
              loading={oauthKey === 'Facebook'} />
            <SocialBtn label="LINE" bgColor="#06C755" icon="💬"
              onPress={() => runOAuth('LINE', signInWithLine)}
              loading={oauthKey === 'LINE'} />
            <SocialBtn label="Apple" bgColor="#000" icon="🍎"
              onPress={() => runOAuth('Apple', () => signInWithProvider('apple'))}
              loading={oauthKey === 'Apple'} />
          </View>
        </View>

        {/* Divider */}
        <View style={s.divider}>
          <View style={s.divLine} />
          <Text style={s.divText}>หรือใช้อีเมล</Text>
          <View style={s.divLine} />
        </View>

        {/* Email / password form */}
        <View style={s.card}>
          <Text style={s.cardTitle}>เข้าสู่ระบบ</Text>

          {!!error && (
            <View style={s.errorBox} testID="error-box">
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <View style={s.field}>
            <Text style={s.label}>อีเมล</Text>
            <TextInput
              style={s.input} value={email} onChangeText={setEmail}
              placeholder="your@email.com" placeholderTextColor="#94a3b8"
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              testID="email-input"
            />
          </View>

          <View style={s.field}>
            <View style={s.labelRow}>
              <Text style={s.label}>รหัสผ่าน</Text>
              <TouchableOpacity onPress={() => setShowPw(v => !v)}>
                <Text style={s.showToggle}>{showPw ? 'ซ่อน' : 'แสดง'}</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.input} value={password} onChangeText={setPassword}
              placeholder="••••••••" placeholderTextColor="#94a3b8"
              secureTextEntry={!showPw}
              testID="password-input"
            />
          </View>

          <TouchableOpacity
            style={[s.btn, busy && s.btnOff]}
            onPress={handleEmailLogin}
            disabled={busy}
            testID="login-btn"
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnTxt}>เข้าสู่ระบบ</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.forgotRow}
            onPress={() => Alert.alert('ลืมรหัสผ่าน', 'ไปที่ app.slippy.app เพื่อรีเซ็ตรหัสผ่านของคุณ')}>
            <Text style={s.forgotTxt}>ลืมรหัสผ่าน?</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerTxt}>ยังไม่มีบัญชี? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register' as any)}>
            <Text style={[s.footerTxt, { color: Brand[500], fontWeight: '600' }]}>สมัครสมาชิก</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: Light.background },
  scroll:     { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 44 },

  logoWrap:   { alignItems: 'center', marginBottom: 28 },
  logoBox:    { width: 68, height: 68, borderRadius: 20, backgroundColor: Brand[500], alignItems: 'center', justifyContent: 'center', marginBottom: 10, shadowColor: Brand[500], shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  logoEmoji:  { fontSize: 30 },
  appName:    { fontSize: 26, fontWeight: '800', color: Brand[900] ?? '#312e81', letterSpacing: -0.5 },
  tagline:    { fontSize: 12, color: Light.mutedFg, marginTop: 3 },

  socialWrap: { gap: 9 },
  googleBtn:  { height: 50, borderRadius: 14, backgroundColor: Light.card, borderWidth: 1, borderColor: Light.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  googleBadge:{ width: 22, height: 22, borderRadius: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  googleG:    { fontSize: 13, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 14, fontWeight: '600', color: Light.foreground },
  socialRow:  { flexDirection: 'row', gap: 8 },

  divider:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 18 },
  divLine:    { flex: 1, height: 1, backgroundColor: Light.border },
  divText:    { fontSize: 11, color: Light.mutedFg, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },

  card:       { backgroundColor: Light.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: Light.border },
  cardTitle:  { fontSize: 17, fontWeight: '700', color: Light.foreground, marginBottom: 14 },
  errorBox:   { backgroundColor: '#fef2f2', borderRadius: 10, padding: 11, marginBottom: 12, borderWidth: 1, borderColor: '#fecaca' },
  errorText:  { color: '#dc2626', fontSize: 13 },
  field:      { marginBottom: 12 },
  label:      { fontSize: 12.5, fontWeight: '600', color: Light.mutedFg, marginBottom: 5 },
  labelRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  showToggle: { fontSize: 12, color: Brand[500], fontWeight: '500' },
  input:      { backgroundColor: Light.muted, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Light.foreground, borderWidth: 1, borderColor: Light.border },
  btn:        { backgroundColor: Brand[500], borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4, shadowColor: Brand[500], shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  btnOff:     { opacity: 0.55 },
  btnTxt:     { color: '#fff', fontSize: 15, fontWeight: '700' },
  forgotRow:  { alignItems: 'center', marginTop: 12 },
  forgotTxt:  { color: Brand[500], fontSize: 13, fontWeight: '500' },

  footer:     { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  footerTxt:  { fontSize: 14, color: Light.mutedFg },
})
