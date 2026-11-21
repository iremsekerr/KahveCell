import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { ToastContext } from './toastContext'

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)
  const timers = useRef(new Map())

  const dismissToast = useCallback((id) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (type, message) => {
      const id = nextId.current + 1
      nextId.current = id
      setToasts((current) => [...current, { id, type, message }])
      timers.current.set(
        id,
        window.setTimeout(() => dismissToast(id), 5000),
      )
    },
    [dismissToast],
  )

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current.clear()
    },
    [],
  )

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <section
            className={`toast toast-${toast.type}`}
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
          >
            <p>{toast.message}</p>
            <button
              aria-label="Bildirimi kapat"
              onClick={() => dismissToast(toast.id)}
              type="button"
            >
              ×
            </button>
          </section>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
