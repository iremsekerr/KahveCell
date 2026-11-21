import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiRequest, streamOrderEvents } from '../api/client'
import { ErrorState, LoadingState } from '../components/FeedbackStates'
import OrderStatusBadge from '../components/OrderStatusBadge'

const ORDER_STEPS = [
  { status: 'PENDING', label: 'Bekliyor' },
  { status: 'ACCEPTED', label: 'Kabul Edildi' },
  { status: 'PREPARING', label: 'Hazırlanıyor' },
  { status: 'READY', label: 'Hazır' },
  { status: 'DELIVERED', label: 'Teslim Edildi' },
]

export default function QrPage() {
  const { orderId } = useParams()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [isLive, setIsLive] = useState(false)
  const [statusChanged, setStatusChanged] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const previousStatus = useRef(null)
  const statusChangeTimeout = useRef(null)

  useEffect(() => {
    let active = true
    let reconnectTimeout
    let orderLoaded = false
    let terminalStatus = false
    const controller = new AbortController()
    previousStatus.current = null

    async function connectToOrderEvents() {
      try {
        if (!orderLoaded) {
          const latestOrder = await apiRequest(`/orders/${orderId}`, {
            signal: controller.signal,
          })
          if (!active) return
          orderLoaded = true
          previousStatus.current = latestOrder.status
          setOrder(latestOrder)
          setError('')
        }
        await streamOrderEvents(`/orders/${orderId}/events`, {
          signal: controller.signal,
          onOpen: () => {
            if (!active) return
            setIsLive(true)
            setError('')
          },
          onStatus: (event) => {
            if (!active) return
            if (
              previousStatus.current !== null &&
              previousStatus.current !== event.status
            ) {
              setStatusChanged(true)
              window.clearTimeout(statusChangeTimeout.current)
              statusChangeTimeout.current = window.setTimeout(
                () => setStatusChanged(false),
                1400,
              )
            }
            previousStatus.current = event.status
            setOrder((currentOrder) =>
              currentOrder
                ? {
                    ...currentOrder,
                    status: event.status,
                    status_label: event.status_label,
                  }
                : currentOrder,
            )
            setError('')
            if (['DELIVERED', 'CANCELLED'].includes(event.status)) {
              terminalStatus = true
              setIsLive(false)
              controller.abort()
            }
          },
        })
        if (active && !terminalStatus) {
          throw new Error('Gerçek zamanlı sipariş bağlantısı kapandı.')
        }
      } catch (requestError) {
        if (!active || terminalStatus || controller.signal.aborted) return
        setIsLive(false)
        setError(requestError.message)
        if (![401, 403, 404].includes(requestError.status)) {
          reconnectTimeout = window.setTimeout(connectToOrderEvents, 2000)
        }
      }
    }

    connectToOrderEvents()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(reconnectTimeout)
      window.clearTimeout(statusChangeTimeout.current)
    }
  }, [orderId, reloadKey])

  function retryLoading() {
    setError('')
    setIsLive(false)
    setOrder(null)
    setReloadKey((current) => current + 1)
  }

  if (error && !order) {
    return (
      <ErrorState
        message={error}
        onRetry={retryLoading}
      />
    )
  }
  if (!order) return <LoadingState message="Sipariş bilgileri yükleniyor..." />

  const currentStep = ORDER_STEPS.findIndex(
    (step) => step.status === order.status,
  )
  const delivered = order.status === 'DELIVERED'

  return (
    <section className="qr-live-panel">
      <p className="eyebrow">Sipariş takibi</p>
      <h1>{delivered ? 'Afiyet olsun!' : 'Sipariş QR kodun'}</h1>
      <p className="qr-order-summary">
        {order.shop_name} · {order.product_name}
      </p>

      <div
        className={`qr-status-area${statusChanged ? ' status-changed' : ''}`}
        aria-live="polite"
      >
        <span className="qr-status-caption">Sipariş durumu</span>
        <OrderStatusBadge
          status={order.status}
          fallbackLabel={order.status_label}
        />
      </div>

      {delivered ? (
        <div className="delivered-message">
          <span className="delivered-check" aria-hidden="true">
            ✓
          </span>
          <p>Kahven hazırlandı ve teslim edildi. Afiyet olsun!</p>
        </div>
      ) : (
        <>
          <ol className="order-progress">
            {ORDER_STEPS.map((step, index) => (
              <li
                className={
                  index < currentStep
                    ? 'progress-complete'
                    : index === currentStep
                      ? 'progress-current'
                      : ''
                }
                key={step.status}
              >
                <span aria-hidden="true">{index < currentStep ? '✓' : index + 1}</span>
                <small>{step.label}</small>
              </li>
            ))}
          </ol>
          <img
            className="qr-image qr-image-large"
            src={order.qr_code.image_data_url}
            alt="Sipariş teslim QR kodu"
          />
          <p className="qr-poll-note">
            {isLive
              ? 'Canlı takip aktif; durum değiştiğinde anında güncellenir.'
              : 'Sipariş durumu için gerçek zamanlı bağlantı kuruluyor.'}
          </p>
          {error && (
            <ErrorState message={error} onRetry={retryLoading} />
          )}
          <details>
            <summary>QR içeriğini görüntüle</summary>
            <pre>{JSON.stringify(order.qr_code.payload, null, 2)}</pre>
          </details>
        </>
      )}
      <Link to="/history">Sipariş geçmişine git</Link>
    </section>
  )
}
