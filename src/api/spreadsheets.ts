// src/api/spreadsheets.ts
import { supabase } from '../lib/supabase'
import type { CellMap } from '../lib/spreadsheet'

export interface SpreadsheetRow {
  id: string
  name: string
  data: CellMap
  created_at: string
  updated_at: string
}

export async function fetchSpreadsheets(): Promise<SpreadsheetRow[]> {
  const { data, error } = await supabase
    .from('spreadsheets')
    .select('id, name, data, created_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as SpreadsheetRow[]
}

export async function createSpreadsheet(name: string, data: CellMap): Promise<SpreadsheetRow> {
  const { data: session } = await supabase.auth.getUser()
  const ownerId = session.user?.id
  if (!ownerId) throw new Error('Not authenticated')
  const { data: row, error } = await supabase
    .from('spreadsheets')
    .insert({ name, data, owner_id: ownerId })
    .select('id, name, data, created_at, updated_at')
    .single()
  if (error) throw new Error(error.message)
  return row as SpreadsheetRow
}

export async function updateSpreadsheet(id: string, patch: { name?: string; data?: CellMap }): Promise<void> {
  const { error } = await supabase.from('spreadsheets').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteSpreadsheet(id: string): Promise<void> {
  const { error } = await supabase.from('spreadsheets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
