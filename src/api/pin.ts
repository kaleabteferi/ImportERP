// src/api/pin.ts — the PIN hash never reaches the client. Every operation
// goes through a SECURITY DEFINER RPC scoped to auth.uid() server-side.
import { supabase } from '../lib/supabase'

export async function hasPin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_pin')
  if (error) throw new Error(error.message)
  return !!data
}

export async function setPin(pin: string): Promise<void> {
  const { error } = await supabase.rpc('set_pin', { p_pin: pin })
  if (error) throw new Error(error.message)
}

export async function verifyPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_pin', { p_pin: pin })
  if (error) throw new Error(error.message)
  return !!data
}

export async function clearPin(): Promise<void> {
  const { error } = await supabase.rpc('clear_pin')
  if (error) throw new Error(error.message)
}
