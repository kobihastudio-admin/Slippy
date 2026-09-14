import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

const supabaseUrl  = Constants.expoConfig?.extra?.supabaseUrl  ?? ''
const supabaseAnon = Constants.expoConfig?.extra?.supabaseAnon ?? ''
export const apiBase: string = Constants.expoConfig?.extra?.apiBase ?? 'https://api-staging.slippyai.app'

/** Expo-compatible SecureStore adapter for Supabase session persistence */
const ExpoSecureStoreAdapter = {
  getItem:    (key: string) => SecureStore.getItemAsync(key),
  setItem:    (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    storage:           ExpoSecureStoreAdapter,
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: false,
  },
})

/** Type-safe table helpers */
export type Tables = {
  documents: {
    id:                 string
    organization_id:    string
    vendor_name:        string | null
    invoice_number:     string | null
    doc_date:           string | null
    total_amount:       number | null
    vat_amount:         number | null
    net_amount:         number | null
    status:             string
    source:             string
    doc_type:           string | null
    overall_confidence: number | null
    category:           string | null
    file_name:          string
    file_path:          string
    created_at:         string
  }
  organizations: {
    id:        string
    name:      string
    plan:      string
    doc_quota: number
    doc_used:  number
  }
  users: {
    id:         string
    email:      string
    full_name:  string | null
    avatar_url: string | null
  }
  organization_members: {
    id:              string
    organization_id: string
    user_id:         string
    role:            string
    joined_at:       string
  }
}
