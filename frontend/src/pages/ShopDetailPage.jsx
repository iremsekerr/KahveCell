import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackStates'

const DEFAULT_LOCATION = { latitude: 39.9208, longitude: 32.8541 }

const MENU_GROUPS = [
  { title: 'Espresso Bazlı', products: [] },
  { title: 'Filtre Kahveler', products: [] },
  { title: 'Soğuk İçecekler', products: [] },
  { title: 'Diğer', products: [] },
]

function getMenuGroup(product) {
  const category = (product.category ?? '').toLocaleLowerCase('tr-TR')
  const name = product.name.toLocaleLowerCase('tr-TR')
  if (
    category.includes('soğuk') ||
    category.includes('cold') ||
    name.includes('soğuk') ||
    name.includes('iced')
  ) {
    return 'Soğuk İçecekler'
  }
  if (category.includes('filtre')) return 'Filtre Kahveler'
  if (
    category.includes('espresso') ||
    category.includes('sütlü') ||
    ['espresso', 'cappuccino', 'latte', 'flat white'].some((item) =>
      name.includes(item),
    )
  ) {
    return 'Espresso Bazlı'
  }
  return 'Diğer'
}

function calculateDistanceKm(origin, shop) {
  const radians = (degrees) => (degrees * Math.PI) / 180
  const latitudeDelta = radians(shop.latitude - origin.latitude)
  const longitudeDelta = radians(shop.longitude - origin.longitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(origin.latitude)) *
      Math.cos(radians(shop.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2
  return (
    6371.0088 *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  )
}

export default function ShopDetailPage() {
  const { shopId } = useParams()
  const { state } = useLocation()
  const supportsGeolocation =
    typeof navigator !== 'undefined' && 'geolocation' in navigator
  const [shop, setShop] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadedShopId, setLoadedShopId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [distanceOrigin, setDistanceOrigin] = useState(DEFAULT_LOCATION)
  const [distanceStatus, setDistanceStatus] = useState(
    supportsGeolocation ? 'requesting' : 'fallback',
  )

  useEffect(() => {
    const controller = new AbortController()
    apiRequest(`/shops/${shopId}`, { signal: controller.signal })
      .then((result) => {
        setShop(result)
        setError('')
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
          setLoadedShopId(shopId)
        }
      })
    return () => controller.abort()
  }, [shopId, reloadKey])

  useEffect(() => {
    if (state?.distanceKm != null || !supportsGeolocation) return

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setDistanceOrigin({
          latitude: coords.latitude,
          longitude: coords.longitude,
        })
        setDistanceStatus('located')
      },
      () => setDistanceStatus('fallback'),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    )
  }, [state?.distanceKm, supportsGeolocation])

  function retryLoading() {
    setLoading(true)
    setError('')
    setReloadKey((current) => current + 1)
  }

  if (loading || loadedShopId !== shopId) {
    return <LoadingState message="Dükkân bilgileri yükleniyor..." />
  }
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={retryLoading}
      />
    )
  }
  if (!shop) {
    return (
      <EmptyState
        title="Dükkân bulunamadı"
        description="Dükkân listesinden başka bir yer seçebilirsin."
        action={<Link className="button" to="/">Dükkânlara dön</Link>}
      />
    )
  }

  const calculatedDistance = calculateDistanceKm(distanceOrigin, shop)
  const distance =
    state?.distanceKm != null
      ? `${state.distanceKm} km`
      : distanceStatus === 'requesting'
        ? 'Konum hesaplanıyor...'
        : `${calculatedDistance.toFixed(2)} km${
            distanceStatus === 'fallback' ? ' (Kızılay varsayılanına göre)' : ''
          }`
  const groupedMenu = MENU_GROUPS.map(({ title }) => ({
    title,
    products: shop.menu.filter((product) => getMenuGroup(product) === title),
  }))
  const workingHours = Object.entries(shop.working_hours ?? {})
  const workingHourLabels = {
    weekdays: 'Hafta içi',
    weekends: 'Hafta sonu',
  }

  return (
    <div className="page-stack shop-detail-page">
      <section className="shop-info-card">
        <p className="eyebrow">Dükkân bilgileri</p>
        <h1>{shop.name}</h1>
        <p className="shop-detail-address">{shop.address}</p>
        <div className="shop-detail-meta">
          <span>
            <strong>Puan:</strong>{' '}
            {shop.rating == null ? 'Henüz değerlendirilmemiş' : shop.rating}
          </span>
          <span>
            <strong>Mesafe:</strong>{' '}
            {distance}
          </span>
        </div>
        <div className="working-hours">
          <h2>Çalışma saatleri</h2>
          {workingHours.length > 0 ? (
            <ul>
              {workingHours.map(([day, hours]) => (
                <li key={day}>
                  <span>{workingHourLabels[day] ?? day}</span>
                  <span>{hours}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Çalışma saatleri belirtilmemiş.</p>
          )}
        </div>
      </section>

      <section className="shop-menu">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Kahve molan için</p>
            <h2>Menü</h2>
          </div>
        </div>
        {shop.menu.length === 0 ? (
          <EmptyState
            title="Menü henüz hazır değil"
            description="Bu dükkân ürünlerini eklediğinde menüsü burada görünecek."
          />
        ) : (
          groupedMenu.map((group) => (
            <section className="menu-category" key={group.title}>
              <h3>{group.title}</h3>
              {group.products.length > 0 ? (
                <div className="menu-products">
                  {group.products.map((product) => (
                    <article className="menu-product-card" key={product.id}>
                      <div className="menu-product-info">
                        <h4>{product.name}</h4>
                        {product.description && <p>{product.description}</p>}
                      </div>
                      <span className="menu-product-price">
                        {Number(product.price).toFixed(2)} TL
                      </span>
                      <Link
                        className="button menu-button"
                        to={`/orders/new?shop_id=${shop.id}&product_id=${product.id}`}
                      >
                        Sipariş Ver
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="menu-empty">Bu kategoride ürün bulunmuyor.</p>
              )}
            </section>
          ))
        )}
      </section>
      <Link className="back-link" to="/">
        Dükkân listesine dön
      </Link>
    </div>
  )
}
