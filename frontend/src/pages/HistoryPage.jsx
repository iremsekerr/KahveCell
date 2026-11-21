import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackStates'
import OrderStatusBadge from '../components/OrderStatusBadge'

function formatOrderDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function HistoryPage() {
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/orders/history', { signal: controller.signal })
      .then((result) =>
        setOrders(
          [...result].sort(
            (first, second) =>
              new Date(second.created_at).getTime() -
              new Date(first.created_at).getTime(),
          ),
        ),
      )
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reloadKey])

  function retryLoading() {
    setLoading(true)
    setError('')
    setReloadKey((current) => current + 1)
  }

  return (
    <section className="history-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">KahveCell</p>
          <h1>Sipariş geçmişi</h1>
        </div>
      </div>
      {loading && <LoadingState message="Sipariş geçmişin yükleniyor..." />}
      {error && (
        <ErrorState
          message={error}
          onRetry={retryLoading}
        />
      )}
      {!loading && !error && orders.length === 0 && (
        <EmptyState
          title="Henüz siparişin yok"
          description="Yakınındaki dükkânları keşfedip ilk kahve siparişini verebilirsin."
          action={<Link className="button" to="/">Dükkânları keşfet</Link>}
        />
      )}
      <ul className="history-list">
        {orders.map((order) => (
          <li key={order.id}>
            <div className="history-order">
              <time dateTime={order.created_at}>
                {formatOrderDate(order.created_at)}
              </time>
              <strong>{order.shop_name}</strong>
              <span>{order.product_name}</span>
            </div>
            <OrderStatusBadge
              status={order.status}
              fallbackLabel={order.status_label}
            />
            <Link className="history-order-link" to={`/qr/${order.id}`}>
              Sipariş detayı
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
