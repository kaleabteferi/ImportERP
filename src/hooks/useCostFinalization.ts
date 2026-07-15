// src/hooks/useCostFinalization.ts

import { useState, useEffect, useCallback } from 'react'
import {
  fetchFinalizationData,
  updateExpenseAmount,
  calculateCostPreview,
  runFinalization,
  type ExpenseForReview,
  type ItemForReview,
  type CostImpact,
  type FinalizationResult,
} from '../api/finalization'

export type AllocationMethod = 'QUANTITY' | 'WEIGHT' | 'VOLUME' | 'VALUE'
export type Step = 1 | 2 | 3 | 4

interface LocalExpense extends ExpenseForReview {
  finalAmount: number   // user-edited amount
  isFinal:     boolean  // user has confirmed this one
}

export function useCostFinalization(shipmentId: string) {
  const [step, setStep]               = useState<Step>(1)
  const [expenses, setExpenses]       = useState<LocalExpense[]>([])
  const [items, setItems]             = useState<ItemForReview[]>([])
  const [fxRate, setFxRate]           = useState(131.20)
  const [method, setMethod]           = useState<AllocationMethod>('QUANTITY')
  const [preview, setPreview]         = useState<CostImpact[]>([])
  const [result, setResult]           = useState<FinalizationResult | null>(null)
  const [isLoading, setLoading]       = useState(true)
  const [isSaving, setSaving]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // ── Load data ────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const data = await fetchFinalizationData(shipmentId)
        setExpenses(data.expenses.map(e => ({
          ...e,
          finalAmount: e.amount_etb ?? e.amount,
          isFinal:     e.cost_status === 'FINAL',
        })))
        setItems(data.items)
        setFxRate(data.latestFxRate)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [shipmentId])

  // ── Recalculate preview whenever inputs change ────────────

  useEffect(() => {
    if (items.length === 0) return
    const totalOverhead = expenses.reduce((s, e) => s + e.finalAmount, 0)
    setPreview(calculateCostPreview(items, totalOverhead, fxRate, method))
  }, [expenses, items, fxRate, method])

  // ── Expense mutations ─────────────────────────────────────

  const updateAmount = useCallback((id: string, amount: number) => {
    setExpenses(prev => prev.map(e =>
      e.id === id ? { ...e, finalAmount: amount } : e
    ))
  }, [])

  const toggleFinal = useCallback((id: string) => {
    setExpenses(prev => prev.map(e =>
      e.id === id ? { ...e, isFinal: !e.isFinal } : e
    ))
  }, [])

  const markAllFinal = useCallback(() => {
    setExpenses(prev => prev.map(e => ({ ...e, isFinal: true })))
  }, [])

  // ── Step navigation ───────────────────────────────────────

  const goToStep = useCallback(async (next: Step) => {
    // When moving from step 1 to step 2, persist any amount changes to DB
    if (next === 2 && step === 1) {
      try {
        await Promise.all(
          expenses
            .filter(e => e.cost_status === 'PROVISIONAL')
            .map(e => updateExpenseAmount(e.id, e.finalAmount))
        )
      } catch (e: any) {
        setError(e.message)
        return
      }
    }
    setStep(next)
    setError(null)
  }, [step, expenses, fxRate])

  // ── Run finalization ──────────────────────────────────────

  const finalize = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await runFinalization(shipmentId, fxRate, method)
      setResult(res)
      setStep(4)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [shipmentId, fxRate, method])

  // ── Derived ───────────────────────────────────────────────

  const provisionalTotal = expenses.reduce((s, e) => s + (e.amount_etb ?? e.amount), 0)
  const finalTotal       = expenses.reduce((s, e) => s + e.finalAmount, 0)
  const allConfirmed     = expenses.length > 0 && expenses.every(e => e.isFinal)
  const confirmedCount   = expenses.filter(e => e.isFinal).length
  const overheadDelta    = finalTotal - provisionalTotal
  const hasProvisional   = items.length > 0

  return {
    step, goToStep,
    expenses, updateAmount, toggleFinal, markAllFinal,
    items,
    fxRate, setFxRate,
    method, setMethod,
    preview,
    result,
    isLoading, isSaving, error,
    provisionalTotal, finalTotal,
    allConfirmed, confirmedCount,
    overheadDelta, hasProvisional,
    finalize,
  }
}