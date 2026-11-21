import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackStates'
import { useToast } from '../components/useToast'

export default function OrderPage() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [searchParams] = useSearchParams()
  const shopId = searchParams.get('shop_id')
  const productFromUrl = searchParams.get('product_id')
  const [shop, setShop] = useState(null)
  const [shopError, setShopError] = useState('')
  const [shopLoading, setShopLoading] = useState(true)
  const [loadedShopId, setLoadedShopId] = useState(null)
  const [shopReloadKey, setShopReloadKey] = useState(0)
  const [productId, setProductId] = useState(productFromUrl ?? '')
  const [subscription, setSubscription] = useState(null)
  const [subscriptionError, setSubscriptionError] = useState(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(true)
  const [subscriptionReloadKey, setSubscriptionReloadKey] = useState(0)
  const [size, setSize] = useState('M')
  const [sugarLevel, setSugarLevel] = useState('0')
  const [milkPreference, setMilkPreference] = useState('')
  const [extraShot, setExtraShot] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!shopId) return undefined

    const controller = new AbortController()
    apiRequest(`/shops/${shopId}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setShop(result)
        setShopError('')
        const selectedProduct = result.menu.find(
          (product) => String(product.id) === productFromUrl,
        )
        if (selectedProduct) {
          setProductId(String(selectedProduct.id))
        } else if (!productFromUrl && result.menu.length > 0) {
          setProductId(String(result.menu[0].id))
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && requestError.name !== 'AbortError') {
          setShopError(requestError.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setShopLoading(false)
          setLoadedShopId(shopId)
        }
      })

    return () => controller.abort()
  }, [productFromUrl, shopId, shopReloadKey])

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/subscriptions/me', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSubscription(result)
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestError.name === 'AbortError') {
          return
        }
        if (requestError.status !== 404) setSubscriptionError(requestError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setSubscriptionLoading(false)
      })

    return () => controller.abort()
  }, [subscriptionReloadKey])

  function retryShop() {
    setShopLoading(true)
    setShopError('')
    setShopReloadKey((current) => current + 1)
  }

  function retrySubscription() {
    setSubscriptionLoading(true)
    setSubscriptionError(null)
    setSubscriptionReloadKey((current) => current + 1)
  }

  async function submitOrder(event) {
    event.preventDefault()
    setLoading(true)
    try {
      const order = await apiRequest('/orders', {
        method: 'POST',
        body: {
          shop_id: Number(shopId),
          product_id: Number(productId),
          size,
          sugar_level: Number(sugarLevel),
          milk_preference: milkPreference || null,
          extra_shot: extraShot,
        },
      })
      navigate(`/qr/${order.id}`)
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setLoading(false)
    }
  }

  if (!shopId) {
    return (
      <section className="panel">
        <h1>Sipariş</h1>
        <p>Önce ana sayfadan bir dükkân ve ürün seç.</p>
        <Link to="/">Dükkânları görüntüle</Link>
      </section>
    )
  }
  if (shopLoading || loadedShopId !== shopId) {
    return <LoadingState message="Dükkân menüsü yükleniyor..." />
  }
  if (shopError) {
    return (
      <ErrorState
        message={shopError}
        onRetry={retryShop}
      />
    )
  }
  if (!shop) {
    return (
      <EmptyState
        title="Dükkân bulunamadı"
        description="Sipariş vermek için dükkân listesinden bir yer seç."
        action={<Link className="button" to="/">Dükkânları keşfet</Link>}
      />
    )
  }

  const selectedProduct = shop.menu.find(
    (product) => String(product.id) === productId,
  )
  const hasActiveSubscription = subscription?.status === 'ACTIVE'
  const unlimitedCredits =
    hasActiveSubscription && subscription.remaining_credits === null
  const remainingCredits = subscription?.remaining_credits
  const hasCredits =
    unlimitedCredits || (Number.isInteger(remainingCredits) && remainingCredits > 0)
  const canOrder =
    !subscriptionLoading &&
    !subscriptionError &&
    hasActiveSubscription &&
    hasCredits &&
    selectedProduct
  const creditsAfterOrder = unlimitedCredits
    ? 'Sınırsız'
    : `${Math.max(remainingCredits - 1, 0)} kredi`
  const loginRequired = subscriptionError?.status === 401

  return (
    <div className="page-stack order-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">{shop.name}</p>
          <h1>Siparişini özelleştir</h1>
        </div>
      </section>

      <section className="order-panel">
        <div className="selected-product">
          <div>
            <p className="eyebrow">Seçtiğin ürün</p>
            <h2>{selectedProduct?.name ?? 'Ürün bulunamadı'}</h2>
            {selectedProduct?.description && <p>{selectedProduct.description}</p>}
          </div>
          {selectedProduct && (
            <strong>{Number(selectedProduct.price).toFixed(2)} TL</strong>
          )}
        </div>

        <form className="form-stack order-form" onSubmit={submitOrder}>
          <div className="order-options-grid">
            <div className="order-field">
              <label htmlFor="size">Boyut</label>
              <select
                id="size"
                value={size}
                onChange={(event) => setSize(event.target.value)}
              >
                <option value="S">S — Küçük</option>
                <option value="M">M — Orta</option>
                <option value="L">L — Büyük</option>
              </select>
            </div>

            <div className="order-field">
              <label htmlFor="milk">Süt tipi</label>
              <select
                id="milk"
                value={milkPreference}
                onChange={(event) => setMilkPreference(event.target.value)}
              >
                <option value="">Varsayılan / süt yok</option>
                <option value="WHOLE">Tam yağlı</option>
                <option value="OAT">Yulaf</option>
                <option value="ALMOND">Badem</option>
                <option value="SOY">Soya</option>
                <option value="LACTOSE_FREE">Laktozsuz</option>
              </select>
            </div>

            <div className="order-field">
              <label htmlFor="sugar">Şeker miktarı</label>
              <select
                id="sugar"
                value={sugarLevel}
                onChange={(event) => setSugarLevel(event.target.value)}
              >
                {[0, 1, 2, 3, 4, 5].map((amount) => (
                  <option key={amount} value={amount}>
                    {amount} şeker
                  </option>
                ))}
              </select>
            </div>

            <label className="extra-shot-option" htmlFor="extra-shot">
              <input
                id="extra-shot"
                type="checkbox"
                checked={extraShot}
                onChange={(event) => setExtraShot(event.target.checked)}
              />
              Ekstra shot ekle
            </label>
          </div>

          <section className="credit-summary" aria-live="polite">
            <div>
              <span>Kalan kahve kredin</span>
              <strong>
                {subscriptionLoading
                  ? 'Yükleniyor...'
                  : hasActiveSubscription
                    ? unlimitedCredits
                      ? 'Sınırsız'
                      : `${remainingCredits} kredi`
                    : 'Aktif abonelik yok'}
              </strong>
            </div>
            {hasActiveSubscription && hasCredits && (
              <p>Bu sipariş sonrası {creditsAfterOrder} kalacak.</p>
            )}
          </section>

          {subscriptionError && (
            <div>
              <ErrorState
                message={subscriptionError.message}
                onRetry={retrySubscription}
              />
              {loginRequired && <Link to="/login">Giriş yap</Link>}
            </div>
          )}
          {!subscriptionLoading &&
            !subscriptionError &&
            !hasActiveSubscription && (
              <div className="message subscription-warning">
                <p>Sipariş vermek için aktif bir abonelik paketi gerekli.</p>
                <Link className="button menu-button" to="/subscription">
                  Paketleri görüntüle
                </Link>
              </div>
            )}
          {!subscriptionLoading &&
            hasActiveSubscription &&
            !hasCredits && (
              <div className="message subscription-warning">
                <p>Kahve hakkın bitmiş. Sipariş için yeni bir paket seç.</p>
                <Link className="button menu-button" to="/subscription">
                  Paketleri görüntüle
                </Link>
              </div>
            )}
          {!selectedProduct && (
            <EmptyState
              title="Ürün bulunamadı"
              description="Bu dükkânın menüsünden başka bir ürün seçebilir veya dükkânlara dönebilirsin."
              action={<Link className="button" to={`/shops/${shop.id}`}>Menüyü aç</Link>}
            />
          )}

          <button className="button menu-button order-submit" disabled={!canOrder || loading}>
            {loading ? 'Sipariş veriliyor...' : 'Siparişi onayla'}
          </button>
        </form>
      </section>
    </div>
  )
}
