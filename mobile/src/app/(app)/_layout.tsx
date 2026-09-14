import { useEffect }        from 'react'
import { Tabs }             from 'expo-router'
import { useRouter }        from 'expo-router'
import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient }   from 'expo-linear-gradient'
import { useAuthStore }     from '@/store/auth.store'
import { Brand, Light }     from '@/constants/colors'

function TabIcon({ name, focused, emoji }: { name: string; focused: boolean; emoji: string }) {
  return (
    <View style={[ti.wrap, focused && ti.active]}>
      <Text style={ti.emoji}>{emoji}</Text>
    </View>
  )
}
const ti = StyleSheet.create({
  wrap:   { alignItems: 'center', justifyContent: 'center', width: 40, height: 32, borderRadius: 10 },
  active: { backgroundColor: Brand[500] + '18' },
  emoji:  { fontSize: 19 },
})

export default function AppLayout() {
  const { session, initialized } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (initialized && !session) router.replace('/(auth)/login')
  }, [session, initialized, router])

  return (
    <Tabs
      screenOptions={{
        headerShown:        false,
        tabBarStyle:        { backgroundColor: Light.tabBar, borderTopColor: Light.tabBarBorder, paddingBottom: 4 },
        tabBarActiveTintColor:   Brand[500],
        tabBarInactiveTintColor: '#94a3b8',
        tabBarLabelStyle:  { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'แดชบอร์ด', tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} emoji="🏠" /> }}
      />
      <Tabs.Screen
        name="documents/index"
        options={{ title: 'เอกสาร', tabBarIcon: ({ focused }) => <TabIcon name="docs" focused={focused} emoji="📄" /> }}
      />
      <Tabs.Screen
        name="documents/camera"
        options={{ title: 'สแกน', tabBarIcon: () => (
          <LinearGradient
            colors={[Brand[400], Brand[600]]}
            style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={{ fontSize: 22 }}>📷</Text>
          </LinearGradient>
        )}}
      />
      <Tabs.Screen
        name="analytics"
        options={{ title: 'รายงาน', tabBarIcon: ({ focused }) => <TabIcon name="analytics" focused={focused} emoji="📊" /> }}
      />
      <Tabs.Screen
        name="friends/index"
        options={{ title: 'เพื่อน', tabBarIcon: ({ focused }) => <TabIcon name="friends" focused={focused} emoji="👥" /> }}
      />
      <Tabs.Screen
        name="messages/index"
        options={{ title: 'ข้อความ', tabBarIcon: ({ focused }) => <TabIcon name="messages" focused={focused} emoji="💬" /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'โปรไฟล์', tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} emoji="👤" /> }}
      />
      <Tabs.Screen name="journey-prototype" options={{ href: null }} />
    </Tabs>
  )
}
