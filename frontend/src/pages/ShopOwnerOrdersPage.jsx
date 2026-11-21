import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackStates'
import OrderStatusBadge from '../components/OrderStatusBadge'
import { useToast } from '../components/useToast'

const ORDER_TABS = [
  { status: 'PENDING', label: 'Bekleyen' },
  { status: 'ACCEPTED', label: 'Kabul Edilen' },
  { status: 'PREPARING', label: 'Hazırlanıyor' },
  { status: 'READY', label: 'Hazır' },
]

const NEXT_STATUS = {
  PENDING: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
}

const MILK_LABELS = {
  WHOLE: 'Tam yağlı',
  OAT: 'Yulaf',
  ALMOND: 'Badem',
  SOY: 'Soya',
  LACTOSE_FREE: 'Laktozsuz',
}

function formatOrderDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatUpdateTime(value) {
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value)
}

function QrScannerModal({ onClose, onScan, verifying }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const verifyingRef = useRef(verifying)
  const [cameraError, setCameraError] = useState('')
  const [restartKey, setRestartKey] = useState(0)

  useEffect(() => {
    verifyingRef.current = verifying
  }, [verifying])

  useEffect(() => {
    let active = true
    let handled = false
    async function startScanner() {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        if (!active) return

        const reader = new BrowserQRCodeReader()
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result) => {
            if (!result || !active || handled || verifyingRef.current) return
            handled = true
            controlsRef.current?.stop()
            Promise.resolve(onScan(result.getText())).catch((scanError) => {
              if (active) setCameraError(scanError.message)
            })
          },
        )
        if (!active) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      } catch (cameraError) {
        if (active) setCameraError(cameraError.message)
      }
    }

    startScanner()

    return () => {
      active = false
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [onScan, restartKey])

  function retryScan() {
    setCameraError('')
    setRestartKey((current) => current + 1)
  }

  return (
    <div className="modal-backdrop">
      <section
        aria-labelledby="qr-scanner-title"
        aria-modal="true"
        className="qr-scanner-modal"
        role="dialog"
      >
        <div className="qr-scanner-heading">
          <div>
            <p className="eyebrow">Teslimat</p>
            <h2 id="qr-scanner-title">Sipariş QR kodunu okut</h2>
          </div>
          <button
            aria-label="Kamerayı kapat"
            className="button button-secondary"
            onClick={onClose}
            type="button"
          >
            Kapat
          </button>
        </div>
        <video
          autoPlay
          className="qr-scanner-video"
          muted
          playsInline
          ref={videoRef}
        />
        {verifying && <p role="status">QR kodu doğrulanıyor...</p>}
        {!cameraError && !verifying && (
          <p className="form-footnote">
            Kamerayı QR koduna doğru tut. Kod otomatik okunur.
          </p>
        )}
        {cameraError && (
          <div className="message message-error" role="alert">
            <p>{cameraError}</p>
            <button className="button button-secondary" onClick={retryScan}>
              Tekrar tara
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

export default function ShopOwnerOrdersPage() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [authorized, setAuthorized] = useState(false)
  const [accessLoading, setAccessLoading] = useState(true)
  const [accessError, setAccessError] = useState(null)
  const [accessReloadKey, setAccessReloadKey] = useState(0)
  const [orders, setOrders] = useState([])
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [selectedTab, setSelectedTab] = useState('PENDING')
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState('')
  const [ordersReloadKey, setOrdersReloadKey] = useState(0)
  const [busyOrderId, setBusyOrderId] = useState(null)
  const [scanOrder, setScanOrder] = useState(null)
  const [verifyingQr, setVerifyingQr] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/auth/me', { signal: controller.signal })
      .then((user) => {
        if (controller.signal.aborted) return
        if (user.role !== 'SHOP_OWNER') {
          navigate('/', { replace: true })
          return
        }
        setAuthorized(true)
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestError.name === 'AbortError') {
          return
        }
        if (requestError.status === 401) {
          navigate('/login', { replace: true })
        } else {
          setAccessError(requestError.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAccessLoading(false)
      })

    return () => controller.abort()
  }, [accessReloadKey, navigate])

  useEffect(() => {
    if (!authorized) return undefined

    let active = true
    let refreshTimeout
    const controller = new AbortController()

    async function refreshOrders() {
      try {
        const result = await apiRequest('/orders/shop-owner', {
          signal: controller.signal,
        })
        if (!active) return
        setOrders(result)
        setLastUpdatedAt(new Date())
        setOrdersError('')
        setOrdersLoading(false)
      } catch (requestError) {
        if (!active || requestError.name === 'AbortError') return
        if (requestError.status === 401) {
          navigate('/login', { replace: true })
          return
        }
        if (requestError.status === 403) {
          navigate('/', { replace: true })
          return
        }
        setOrdersError(requestError.message)
        setOrdersLoading(false)
      }

      if (active) {
        refreshTimeout = window.setTimeout(refreshOrders, 4000)
      }
    }

    refreshOrders()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(refreshTimeout)
    }
  }, [authorized, navigate, ordersReloadKey])

  const visibleOrders = useMemo(
    () => orders.filter((order) => order.status === selectedTab),
    [orders, selectedTab],
  )

  function retryAccessCheck() {
    setAccessLoading(true)
    setAccessError(null)
    setAccessReloadKey((current) => current + 1)
  }

  function retryOrders() {
    setOrdersLoading(true)
    setOrdersError('')
    setOrdersReloadKey((current) => current + 1)
  }

  async function updateStatus(order, nextStatus) {
    setBusyOrderId(order.id)
    setOrdersError('')
    try {
      const updatedOrder = await apiRequest(`/orders/${order.id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      })
      setOrders((currentOrders) =>
        currentOrders.map((currentOrder) =>
          currentOrder.id === updatedOrder.id
            ? { ...currentOrder, ...updatedOrder }
            : currentOrder,
        ),
      )
      showToast('success', 'Sipariş durumu güncellendi.')
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setBusyOrderId(null)
    }
  }

  const scanQrCode = useCallback(async (qrText) => {
    let payload
    try {
      payload = JSON.parse(qrText)
    } catch {
      throw new Error('QR kod okunamadı. Geçerli bir KahveCell sipariş kodu tara.')
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.order_id !== 'string' ||
      typeof payload.signature !== 'string'
    ) {
      throw new Error('QR kod beklenen sipariş bilgilerini içermiyor.')
    }

    setVerifyingQr(true)
    setOrdersError('')
    try {
      const result = await apiRequest('/orders/verify-qr', {
        method: 'POST',
        body: payload,
      })
      if (!result.valid) {
        throw new Error(result.message || 'QR kod doğrulanamadı.')
      }

      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.order_id === result.order_id
            ? {
                ...order,
                status: 'DELIVERED',
                status_label: result.status_label,
              }
            : order,
        ),
      )
      showToast('success', result.message)
      setScanOrder(null)
    } catch (requestError) {
      showToast('error', requestError.message)
      throw requestError
    } finally {
      setVerifyingQr(false)
    }
  }, [showToast])

  if (accessLoading) {
    return <LoadingState message="Dükkân sahibi yetkisi kontrol ediliyor..." />
  }
  if (accessError) {
    return (
      <ErrorState
        message={accessError}
        onRetry={retryAccessCheck}
      />
    )
  }
  if (!authorized) return null

  return (
    <div className="page-stack shop-owner-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Dükkân yönetimi</p>
          <h1>Siparişler</h1>
          <p>Siparişleri takip et ve hazırlık durumlarını güncelle.</p>
        </div>
        <div className="refresh-indicator" aria-live="polite">
          <span>
            Son güncelleme:{' '}
            {lastUpdatedAt ? (
              <time dateTime={lastUpdatedAt.toISOString()}>
                {formatUpdateTime(lastUpdatedAt)}
              </time>
            ) : (
              'bekleniyor'
            )}
          </span>
          <span>4 sn’de bir otomatik yenilenir</span>
        </div>
      </section>

      <div aria-label="Sipariş durumları" className="order-tabs" role="tablist">
        {ORDER_TABS.map((tab) => (
          <button
            aria-selected={selectedTab === tab.status}
            className={
              selectedTab === tab.status ? 'order-tab active' : 'order-tab'
            }
            key={tab.status}
            onClick={() => setSelectedTab(tab.status)}
            role="tab"
            type="button"
          >
            {tab.label}
            <span>
              {orders.filter((order) => order.status === tab.status).length}
            </span>
          </button>
        ))}
      </div>

      {ordersLoading && <LoadingState message="Siparişler yükleniyor..." />}
      {ordersError && (
        <ErrorState
          message={ordersError}
          onRetry={retryOrders}
        />
      )}
      {!ordersLoading && !ordersError && visibleOrders.length === 0 && (
        <EmptyState
          title="Bu sekmede sipariş yok"
          description="Yeni siparişler geldikçe burada görünecek; diğer durumları da sekmelerden kontrol edebilirsin."
        />
      )}
      {!ordersLoading && !ordersError && visibleOrders.length > 0 && (
        <div className="owner-order-list">
          {visibleOrders.map((order) => (
            <article className="owner-order-card" key={order.id}>
              <header className="owner-order-heading">
                <div>
                  <p className="eyebrow">Sipariş #{order.id}</p>
                  <h2>{order.customer_name}</h2>
                  <a href={`tel:${order.customer_phone}`}>
                    {order.customer_phone}
                  </a>
                </div>
                <OrderStatusBadge
                  fallbackLabel={order.status_label}
                  status={order.status}
                />
              </header>
              <div className="owner-order-details">
                <div>
                  <span>Ürün</span>
                  <strong>{order.product_name}</strong>
                </div>
                <div>
                  <span>Özelleştirmeler</span>
                  <strong>
                    {order.size} boy · {order.sugar_level} şeker ·{' '}
                    {order.milk_preference
                      ? MILK_LABELS[order.milk_preference] ??
                        order.milk_preference
                      : 'Süt yok / varsayılan'}
                    {order.extra_shot ? ' · Ekstra shot' : ''}
                  </strong>
                </div>
                <div>
                  <span>Sipariş zamanı</span>
                  <time dateTime={order.created_at}>
                    {formatOrderDate(order.created_at)}
                  </time>
                </div>
              </div>
              {NEXT_STATUS[order.status] ? (
                <button
                  className="button menu-button owner-order-action"
                  disabled={busyOrderId === order.id}
                  onClick={() =>
                    updateStatus(order, NEXT_STATUS[order.status])
                  }
                  type="button"
                >
                  {busyOrderId === order.id
                    ? 'Güncelleniyor...'
                    : {
                        PENDING: 'Kabul Et',
                        ACCEPTED: 'Hazırlamaya Başla',
                        PREPARING: 'Hazır',
                      }[order.status]}
                </button>
              ) : (
                <button
                  className="button menu-button owner-order-action"
                  onClick={() => {
                    setOrdersError('')
                    setScanOrder(order)
                  }}
                  type="button"
                >
                  QR Okut
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {scanOrder && (
        <QrScannerModal
          onClose={() => {
            if (!verifyingQr) setScanOrder(null)
          }}
          onScan={scanQrCode}
          verifying={verifyingQr}
        />
      )}
    </div>
  )
}
