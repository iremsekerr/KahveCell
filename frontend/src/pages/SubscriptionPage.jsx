import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackStates'
import { useToast } from '../components/useToast'

const TEST_CARD_NUMBER = '4242-4242-4242-4242'

function formatPrice(value) {
  return `${Number(value).toFixed(2).replace('.', ',')} TL`
}

function formatEndDate(value) {
  if (!value) return 'Süresiz'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tarih bilgisi yok'

  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function getPlanName(planType, plans) {
  return plans.find((plan) => plan.plan_type === planType)?.name ?? planType
}

export default function SubscriptionPage() {
  const showToast = useToast()
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState('')
  const [plansReloadKey, setPlansReloadKey] = useState(0)
  const [activeSubscription, setActiveSubscription] = useState(null)
  const [activeLoading, setActiveLoading] = useState(true)
  const [activeError, setActiveError] = useState(null)
  const [activeReloadKey, setActiveReloadKey] = useState(0)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [cardNumber, setCardNumber] = useState(TEST_CARD_NUMBER)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/subscriptions/plans', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setPlans(result)
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && requestError.name !== 'AbortError') {
          setPlansError(requestError.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlansLoading(false)
      })
    return () => controller.abort()
  }, [plansReloadKey])

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/subscriptions/me', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setActiveSubscription(result)
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestError.name === 'AbortError') {
          return
        }
        if (requestError.status !== 404) setActiveError(requestError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setActiveLoading(false)
      })
    return () => controller.abort()
  }, [activeReloadKey])

  function retryPlans() {
    setPlansLoading(true)
    setPlansError('')
    setPlansReloadKey((current) => current + 1)
  }

  function retryActiveSubscription() {
    setActiveLoading(true)
    setActiveError(null)
    setActiveReloadKey((current) => current + 1)
  }

  function openPurchaseModal(plan) {
    setSelectedPlan(plan)
    setCardNumber(TEST_CARD_NUMBER)
    setNotice(null)
  }

  function closePurchaseModal() {
    if (busy) return
    setSelectedPlan(null)
    setNotice(null)
  }

  async function purchase(event) {
    event.preventDefault()
    if (!selectedPlan) return

    setBusy(true)
    setNotice(null)
    try {
      const result = await apiRequest('/subscriptions', {
        method: 'POST',
        body: {
          plan_type: selectedPlan.plan_type,
          card_number: cardNumber,
        },
      })

      if (!result.success) {
        setNotice({ type: 'error', text: result.message })
        showToast('error', result.message)
        return
      }

      setActiveSubscription(result.subscription)
      setActiveError(null)
      setSelectedPlan(null)
      setNotice(null)
      showToast('success', result.message)
    } catch (requestError) {
      setNotice({ type: 'error', text: requestError.message })
      showToast('error', requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancelSubscription() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await apiRequest('/subscriptions/me', {
        method: 'DELETE',
      })
      setActiveSubscription(null)
      setActiveError(null)
      showToast('success', result.message)
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack subscription-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">KahveCell</p>
          <h1>Aboneliğin</h1>
        </div>
      </section>

      <section className="active-subscription">
        <h2>Aktif abonelik</h2>
        {activeLoading && (
          <LoadingState message="Abonelik bilgisi yükleniyor..." />
        )}
        {!activeLoading && activeError && (
          <div>
            <ErrorState
              message={activeError.message}
              onRetry={retryActiveSubscription}
            />
            {activeError.status === 401 && <Link to="/login">Giriş yap</Link>}
          </div>
        )}
        {!activeLoading && !activeError && !activeSubscription && (
          <EmptyState
            title="Aktif aboneliğin yok"
            description="Sipariş verebilmek için aşağıdan sana uygun bir paket seç."
            action={<a className="button" href="#subscription-plans">Paketleri gör</a>}
          />
        )}
        {!activeLoading && activeSubscription && (
          <div className="active-subscription-details">
            <div className="active-plan-name">
              <span>Paket</span>
              <strong>
                {getPlanName(activeSubscription.plan_type, plans)}
              </strong>
            </div>
            <div>
              <span>Kalan kredi</span>
              <strong>
                {activeSubscription.remaining_credits == null
                  ? 'Sınırsız'
                  : `${activeSubscription.remaining_credits} kahve`}
              </strong>
            </div>
            <div>
              <span>Bitiş tarihi</span>
              <strong>{formatEndDate(activeSubscription.expires_at)}</strong>
            </div>
            <button
              className="button cancel-subscription-button"
              disabled={busy}
              onClick={cancelSubscription}
              type="button"
            >
              {busy ? 'İşleniyor...' : 'İptal Et'}
            </button>
          </div>
        )}
      </section>

      <section className="subscription-plans-section" id="subscription-plans">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Sana uygun paketi seç</p>
            <h2>Paketler</h2>
          </div>
        </div>
        {plansLoading && <LoadingState message="Paketler yükleniyor..." />}
        {plansError && (
          <ErrorState
            message={plansError}
            onRetry={retryPlans}
          />
        )}
        {!plansLoading && !plansError && plans.length === 0 && (
          <EmptyState
            title="Şu anda paket bulunmuyor"
            description="Paketleri yüklemek için tekrar deneyebilirsin."
            action={
              <button
                className="button"
                onClick={retryPlans}
                type="button"
              >
                Yeniden dene
              </button>
            }
          />
        )}
        {!plansLoading && !plansError && plans.length > 0 && (
          <div className="plan-list">
            {plans.map((plan) => (
              <article
                className={`panel plan-card subscription-plan-card plan-${plan.plan_type.toLowerCase()}`}
                key={plan.plan_type}
              >
                <h3>{plan.name}</h3>
                <p className="plan-price">
                  {formatPrice(plan.monthly_price)}
                  <span> / ay</span>
                </p>
                <ul className="plan-features">
                  <li>
                    {plan.monthly_coffee_limit == null
                      ? 'Sınırsız kahve'
                      : `Ayda ${plan.monthly_coffee_limit} kahve`}
                  </li>
                  {plan.guest_credits > 0 && (
                    <li>{plan.guest_credits} misafir kahve hakkı</li>
                  )}
                  {plan.priority_access && <li>Öncelikli hizmet</li>}
                </ul>
                <button
                  className="button menu-button"
                  disabled={busy}
                  onClick={() => openPurchaseModal(plan)}
                  type="button"
                >
                  Satın Al
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedPlan && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="purchase-modal-title"
            aria-modal="true"
            className="purchase-modal"
            role="dialog"
          >
            <p className="eyebrow">Güvenli test ödemesi</p>
            <h2 id="purchase-modal-title">{selectedPlan.name} paketi</h2>
            <p className="modal-plan-price">
              {formatPrice(selectedPlan.monthly_price)} / ay
            </p>
            <form className="form-stack" onSubmit={purchase}>
              <label htmlFor="subscription-card-number">Kart numarası</label>
              <input
                autoComplete="cc-number"
                id="subscription-card-number"
                inputMode="numeric"
                maxLength={19}
                onChange={(event) => setCardNumber(event.target.value)}
                required
                value={cardNumber}
              />
              <p className="test-card-note">Test kartı, değiştirmeyin.</p>
              {notice?.type === 'error' && (
                <p className="message message-error" role="alert">
                  {notice.text}
                </p>
              )}
              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={closePurchaseModal}
                  type="button"
                >
                  Vazgeç
                </button>
                <button className="button menu-button" disabled={busy}>
                  {busy ? 'Ödeme yapılıyor...' : 'Ödemeyi Onayla'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
