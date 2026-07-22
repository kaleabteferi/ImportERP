// src/api/admin.ts — thin client for the admin-users Edge Function.
// Resetting someone else's password (or reading their email out of
// auth.users) needs the Supabase service role key, which must never reach
// the browser — the Edge Function holds it server-side and re-checks the
// caller is full_access/hr_system on every call.
import { supabase } from '../lib/supabase'

async function invoke(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    const detail = await (error as any)?.context?.json?.().catch(() => null)
    throw new Error(detail?.error ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  await invoke({ action: 'reset_password', userId, newPassword })
}

export async function fetchUserEmails(): Promise<Record<string, string>> {
  const data = await invoke({ action: 'list_emails' })
  const map: Record<string, string> = {}
  for (const u of data.users ?? []) if (u.email) map[u.id] = u.email
  return map
}
