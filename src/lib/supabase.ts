import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_ANON_KEY v .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (url, options = {}) => {
      // 15s timeout on all Supabase requests to prevent infinite hangs
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout))
    },
  },
})
