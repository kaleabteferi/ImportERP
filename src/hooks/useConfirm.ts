import { useState, useCallback } from 'react'

interface ConfirmOptions {
  title: string
  message: string
  danger?: boolean
  onConfirm: () => void
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

const INITIAL_STATE: ConfirmState = {
  open: false,
  title: '',
  message: '',
  danger: true,
  onConfirm: () => {},
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(INITIAL_STATE)

  const confirm = useCallback((options: ConfirmOptions) => {
    setState({
      open: true,
      title: options.title,
      message: options.message,
      danger: options.danger ?? true,
      onConfirm: options.onConfirm,
    })
  }, [])

  const close = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return { state, confirm, close }
}