import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackStates'
import OrderStatusBadge from '../components/OrderStatusBadge'
import { useToast } from '../components/useToast'

const ADMIN_TABS = [
  { id: 'shops', label: 'Dükkânlar' },
  { id: 'orders', label: 'Siparişler' },
  { id: 'billing', label: 'Abonelik ve ödemeler' },
]

const NEXT_ORDER_STATUS = {
  PENDING: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tarih bilgisi yok'

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatPrice(value) {
  return `${Number(value).toFixed(2).replace('.', ',')} TL`
}

function AdminMetric({ label, value }) {
  return (
    <article className="admin-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [authorized, setAuthorized] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [authReloadKey, setAuthReloadKey] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [activeTab, setActiveTab] = useState('shops')
  const [shopOwners, setShopOwners] = useState([])
  const [shops, setShops] = useState([])
  const [ownerDrafts, setOwnerDrafts] = useState({})
  const [orders, setOrders] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [payments, setPayments] = useState([])
  const [busyShopId, setBusyShopId] = useState(null)
  const [busyOrderId, setBusyOrderId] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/auth/me', { signal: controller.signal })
      .then((user) => {
        if (controller.signal.aborted) return
        if (user.role !== 'ADMIN') {
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
          setAuthError(requestError.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthLoading(false)
      })

    return () => controller.abort()
  }, [authReloadKey, navigate])

  useEffect(() => {
    if (!authorized) return undefined

    const controller = new AbortController()
    Promise.all([
      apiRequest('/admin/shop-owners', { signal: controller.signal }),
      apiRequest('/admin/shops', { signal: controller.signal }),
      apiRequest('/admin/orders', { signal: controller.signal }),
      apiRequest('/admin/subscriptions', { signal: controller.signal }),
      apiRequest('/admin/payments', { signal: controller.signal }),
    ])
      .then(([owners, shopList, orderList, subscriptionList, paymentList]) => {
        if (controller.signal.aborted) return
        setShopOwners(owners)
        setShops(shopList)
        setOwnerDrafts(
          Object.fromEntries(
            shopList.map((shop) => [shop.id, shop.owner_id ?? '']),
          ),
        )
        setOrders(orderList)
        setSubscriptions(subscriptionList)
        setPayments(paymentList)
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestError.name === 'AbortError') {
          return
        }
        if (requestError.status === 401) {
          navigate('/login', { replace: true })
        } else if (requestError.status === 403) {
          navigate('/', { replace: true })
        } else {
          setLoadError(requestError.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [authorized, navigate, reloadKey])

  function retryAuthorization() {
    setAuthLoading(true)
    setAuthError('')
    setAuthReloadKey((current) => current + 1)
  }

  function refreshData() {
    setLoading(true)
    setLoadError('')
    setReloadKey((current) => current + 1)
  }

  const openOrders = useMemo(
    () =>
      orders.filter(
        (order) => !['DELIVERED', 'CANCELLED'].includes(order.status),
      ).length,
    [orders],
  )
  const activeSubscriptions = useMemo(
    () =>
      subscriptions.filter((subscription) => subscription.status === 'ACTIVE')
        .length,
    [subscriptions],
  )

  async function assignOwner(shop) {
    const selectedOwner = ownerDrafts[shop.id]
    setBusyShopId(shop.id)
    try {
      const updatedShop = await apiRequest(`/admin/shops/${shop.id}/owner`, {
        method: 'PATCH',
        body: { owner_id: selectedOwner === '' ? null : Number(selectedOwner) },
      })
      setShops((current) =>
        current.map((item) => (item.id === shop.id ? updatedShop : item)),
      )
      showToast('success', `${shop.name} için dükkân sahibi güncellendi.`)
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setBusyShopId(null)
    }
  }

  async function advanceOrder(order) {
    const nextStatus = NEXT_ORDER_STATUS[order.status]
    if (!nextStatus) return

    setBusyOrderId(order.id)
    try {
      const updatedOrder = await apiRequest(`/orders/${order.id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      })
      setOrders((current) =>
        current.map((item) =>
          item.id === order.id ? { ...item, status: updatedOrder.status } : item,
        ),
      )
      showToast('success', 'Sipariş durumu güncellendi.')
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setBusyOrderId(null)
    }
  }

  if (authLoading) {
    return <LoadingState message="Admin yetkisi kontrol ediliyor..." />
  }
  if (authError) {
    return (
      <ErrorState
        message={authError}
        onRetry={retryAuthorization}
      />
    )
  }
  if (!authorized) return null

  return (
    <div className="page-stack admin-page">
      <header className="page-heading admin-heading">
        <div>
          <p className="eyebrow">KahveCell yönetim merkezi</p>
          <h1>Admin paneli</h1>
          <p>Dükkânları, siparişleri ve abonelik hareketlerini buradan yönet.</p>
        </div>
        <button
          className="button button-secondary"
          disabled={loading}
          onClick={refreshData}
          type="button"
        >
          {loading ? 'Yenileniyor...' : 'Verileri yenile'}
        </button>
      </header>

      <section className="admin-metrics" aria-label="Genel durum">
        <AdminMetric label="Dükkân" value={shops.length} />
        <AdminMetric label="Açık sipariş" value={openOrders} />
        <AdminMetric label="Aktif abonelik" value={activeSubscriptions} />
        <AdminMetric label="Ödeme kaydı" value={payments.length} />
      </section>

      <nav className="admin-tabs" aria-label="Yönetim bölümleri" role="tablist">
        {ADMIN_TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'admin-tab active' : 'admin-tab'}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {loading && <LoadingState message="Yönetim verileri yükleniyor..." />}
      {loadError && (
        <ErrorState
          message={loadError}
          onRetry={refreshData}
        />
      )}

      {!loading && !loadError && activeTab === 'shops' && (
        <section className="admin-section" aria-label="Dükkân yönetimi">
          <div className="admin-section-heading">
            <div>
              <h2>Dükkânlar ve sahipleri</h2>
              <p>Her dükkân için sorumlu dükkân sahibini ata.</p>
            </div>
          </div>
          {shops.length === 0 ? (
            <EmptyState
              title="Henüz dükkân yok"
              description="Dükkânlar eklendiğinde sahiplerini bu bölümden atayabilirsin."
            />
          ) : (
            <div className="admin-record-list">
              {shops.map((shop) => (
                <article className="admin-record-card" key={shop.id}>
                  <div className="admin-record-main">
                    <p className="eyebrow">{shop.address}</p>
                    <h3>{shop.name}</h3>
                    <p>
                      {shop.owner_name
                        ? `${shop.owner_name} · ${shop.owner_phone_number}`
                        : 'Henüz sahibi atanmamış'}
                    </p>
                  </div>
                  <div className="admin-owner-form">
                    {shopOwners.length === 0 ? (
                      <p className="admin-no-owners">
                        Dükkân sahibi rolünde hesap yok. Önce bir kullanıcıyı
                        dükkân sahibi olarak tanımla.
                      </p>
                    ) : (
                      <>
                        <label htmlFor={`owner-${shop.id}`}>Dükkân sahibi</label>
                        <select
                          id={`owner-${shop.id}`}
                          onChange={(event) =>
                            setOwnerDrafts((current) => ({
                              ...current,
                              [shop.id]: event.target.value,
                            }))
                          }
                          value={ownerDrafts[shop.id] ?? ''}
                        >
                          <option value="">Sahip atanmamış</option>
                          {shopOwners.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {owner.first_name} {owner.last_name} ·{' '}
                              {owner.phone_number}
                            </option>
                          ))}
                        </select>
                        <button
                          className="button"
                          disabled={busyShopId === shop.id}
                          onClick={() => assignOwner(shop)}
                          type="button"
                        >
                          {busyShopId === shop.id ? 'Kaydediliyor...' : 'Kaydet'}
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && !loadError && activeTab === 'orders' && (
        <section className="admin-section" aria-label="Sipariş takibi">
          <div className="admin-section-heading">
            <div>
              <h2>Tüm siparişler</h2>
              <p>En yeni siparişler önce listelenir; açık siparişlerin durumunu ilerletebilirsin.</p>
            </div>
          </div>
          {orders.length === 0 ? (
            <EmptyState
              title="Henüz sipariş yok"
              description="Müşteriler sipariş verdiğinde kayıtlar burada görünecek."
            />
          ) : (
            <div className="admin-record-list">
              {orders.map((order) => (
                <article className="admin-record-card" key={order.id}>
                  <div className="admin-record-main">
                    <p className="eyebrow">Sipariş #{order.id} · {formatDate(order.created_at)}</p>
                    <h3>{order.product_name} · {order.shop_name}</h3>
                    <p>{order.customer_name} · {order.customer_phone}</p>
                    <p>
                      {order.size} boy · {order.sugar_level} şeker
                      {order.extra_shot ? ' · Ekstra shot' : ''}
                    </p>
                  </div>
                  <div className="admin-order-action">
                    <OrderStatusBadge status={order.status} />
                    {NEXT_ORDER_STATUS[order.status] && (
                      <button
                        className="button"
                        disabled={busyOrderId === order.id}
                        onClick={() => advanceOrder(order)}
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
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && !loadError && activeTab === 'billing' && (
        <section className="admin-billing-grid" aria-label="Abonelik ve ödeme kayıtları">
          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <h2>Abonelikler</h2>
                <p>Durum, paket ve kalan kullanım hakları.</p>
              </div>
            </div>
            {subscriptions.length === 0 ? (
              <EmptyState
                title="Abonelik kaydı yok"
                description="Satın alınan abonelikler burada listelenir."
              />
            ) : (
              <div className="admin-record-list">
                {subscriptions.map((subscription) => (
                  <article className="admin-record-card" key={subscription.id}>
                    <div className="admin-record-main">
                      <p className="eyebrow">{subscription.customer_name} · {subscription.customer_phone}</p>
                      <h3>{subscription.plan_type} · {subscription.status}</h3>
                      <p>
                        Kalan kredi:{' '}
                        {subscription.remaining_credits == null
                          ? 'Sınırsız'
                          : subscription.remaining_credits}
                        {' · '}{formatPrice(subscription.monthly_price)}
                      </p>
                      <p>Bitiş: {subscription.expires_at ? formatDate(subscription.expires_at) : 'Süresiz'}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <h2>Ödemeler</h2>
                <p>İşlem sonucu, tutar ve test kartının son dört hanesi.</p>
              </div>
            </div>
            {payments.length === 0 ? (
              <EmptyState
                title="Ödeme kaydı yok"
                description="Abonelik ödemeleri gerçekleştikçe burada listelenir."
              />
            ) : (
              <div className="admin-record-list">
                {payments.map((payment) => (
                  <article className="admin-record-card" key={payment.transaction_id}>
                    <div className="admin-record-main">
                      <p className="eyebrow">{formatDate(payment.created_at)}</p>
                      <h3>{payment.customer_name} · {payment.customer_phone}</h3>
                      <p>
                        {payment.plan_type} · {formatPrice(payment.amount)} ·{' '}
                        {payment.status === 'SUCCEEDED' ? 'Başarılı' : 'Başarısız'}
                      </p>
                      <p>Kart son dört hane: •••• {payment.card_last_four}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      )}
    </div>
  )
}
