// src/api/admin.ts — thin client for the admin-users Edge Function.
// Resetting someone else's password (or reading their email out of
// auth.users) needs the Supabase service role key, which must never reach
// the browser — the Edge Function holds it server-side and re-checks the
// caller is full_access/hr_system on every call.
import { supabase } from '../lib/supabase'

interface AdminUserMetadata { id: string; email: string | null; createdAt: string; lastSignInAt: string | null }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    const context = (error as { context?: Response }).context
    const detail = context ? await context.clone().json().catch(() => null) as { error?: string } | null : null
    throw new Error(detail?.error ?? `${error.message}. Redeploy the admin-users Edge Function if this is a CORS error.`)
  }
  const result = data as T & { error?: string }
  if (result?.error) throw new Error(result.error)
  return result
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  await invoke({ action: 'reset_password', userId, newPassword })
}

export async function fetchUserEmails(): Promise<Record<string, string>> {
  const data = await invoke<{ users: Array<{ id: string; email: string | null }> }>({ action: 'list_emails' })
  const map: Record<string, string> = {}
  for (const u of data.users ?? []) if (u.email) map[u.id] = u.email
  return map
}

export async function fetchAdminUsers(): Promise<Record<string, AdminUserMetadata>> {
  const data = await invoke<{ users: AdminUserMetadata[] }>({ action: 'list_users' })
  return Object.fromEntries((data.users ?? []).map(user => [user.id, user]))
}

export async function updateUserAuthority(userId: string, role: string, employeeId: string | null): Promise<void> {
  await invoke({ action: 'update_authority', userId, role, employeeId })
}

export async function deleteUser(userId: string): Promise<void> {
  await invoke({ action: 'delete_user', userId })
}
