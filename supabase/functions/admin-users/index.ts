// supabase/functions/admin-users/index.ts — admin-only user actions that
// need the service role key (resetting someone else's password, reading
// auth.users.email) and therefore can't run in the browser with the anon
// key. Every request is re-verified server-side against the caller's own
// JWT + profiles.role — the client being an admin is a UI convenience, not
// something this function trusts blindly.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Caller's own client (anon key + their JWT) — under RLS this can only
    // ever read the caller's own profiles row, which is exactly the check
    // needed: are they full_access or hr_system?
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'Not authenticated.' }, 401)

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles').select('role').eq('id', caller.id).single()
    if (profileErr || !callerProfile || !['full_access', 'hr_system'].includes(callerProfile.role)) {
      return json({ error: 'Only Full access or HR & System can manage users.' }, 403)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const body = await req.json().catch(() => ({}))

    if (body.action === 'reset_password') {
      const { userId, newPassword } = body
      if (!userId || typeof newPassword !== 'string' || newPassword.length < 6) {
        return json({ error: 'A user and a password of at least 6 characters are required.' }, 400)
      }
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (body.action === 'list_emails') {
      // Paginated — fine for a small team; revisit if the user list ever
      // grows past a few hundred logins.
      const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (error) return json({ error: error.message }, 400)
      return json({ users: data.users.map(u => ({ id: u.id, email: u.email ?? null })) })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error.' }, 500)
  }
})
