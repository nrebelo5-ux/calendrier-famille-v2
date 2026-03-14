import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://eafriqbwtwvbwetpjwiz.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_S-Yf6zWZw9_QxHZeJpGFyA_KJMxskIr'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)