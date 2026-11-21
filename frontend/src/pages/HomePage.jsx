import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackStates'
import ShopMap from '../components/ShopMap'

const DEFAULT_LOCATION = { latitude: 39.9208, longitude: 32.8541 }

function normalizeSearchText(value) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export default function HomePage() {
  const [userLocation, setUserLocation] = useState(null)
  const supportsGeolocation =
    typeof navigator !== 'undefined' && 'geolocation' in navigator
  const [locationStatus, setLocationStatus] = useState(
    supportsGeolocation ? 'requesting' : 'fallback',
  )
  const [shops, setShops] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!supportsGeolocation) return

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const currentLocation = {
          latitude: coords.latitude,
          longitude: coords.longitude,
        }
        setLoading(true)
        setError('')
        setUserLocation(currentLocation)
        setLocationStatus('located')
      },
      () => setLocationStatus('fallback'),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    )
  }, [supportsGeolocation])

  const location = userLocation ?? DEFAULT_LOCATION

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      lat: String(location.latitude),
      lng: String(location.longitude),
    })

    apiRequest(`/shops?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setShops(result)
        setError('')
        setLoading(false)
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && requestError.name !== 'AbortError') {
          setError(requestError.message)
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [location, reloadKey])

  function retryLoading() {
    setLoading(true)
    setError('')
    setReloadKey((current) => current + 1)
  }

  const locationMessage =
    locationStatus === 'located'
      ? 'Dükkânlar konumuna göre sıralandı.'
      : locationStatus === 'requesting'
        ? 'Konum izni bekleniyor; izin verilmezse Ankara Kızılay kullanılacak.'
        : 'Ankara Kızılay varsayılan konum olarak kullanılıyor.'

  const filteredShops = useMemo(() => {
    const searchTerm = normalizeSearchText(query.trim())
    if (!searchTerm) return shops

    return shops.filter((shop) =>
      normalizeSearchText(`${shop.name} ${shop.address}`).includes(searchTerm),
    )
  }, [query, shops])

  const mapCenter = useMemo(
    () => [location.latitude, location.longitude],
    [location.latitude, location.longitude],
  )

  return (
    <div className="home-discovery">
      <header className="home-heading">
        <div>
          <p className="eyebrow">KahveCell</p>
          <h1>Yakınındaki kahve dükkânları</h1>
          <p>Haritada keşfet, menüsüne göz at ve kahveni seç.</p>
        </div>
        <label className="home-search">
          <span className="visually-hidden">Dükkân veya adres ara</span>
          <span className="home-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Dükkân veya adres ara"
          />
        </label>
      </header>

      {locationMessage && (
        <p className="location-message" role="status">
          {locationMessage}
        </p>
      )}

      <div className="home-discovery-grid">
        <section className="shop-results" aria-labelledby="shop-results-title">
          <div className="shop-results-heading">
            <h2 id="shop-results-title">Dükkânlar</h2>
            {!loading && (
              <span className="shop-count">
                {filteredShops.length} dükkân
              </span>
            )}
          </div>
          {loading && <LoadingState message="Dükkânlar yükleniyor..." />}
          {error && <ErrorState message={error} onRetry={retryLoading} />}
          {!loading && !error && filteredShops.length === 0 && (
            shops.length ? (
              <EmptyState
                title="Aramana uygun dükkân yok"
                description="Arama kelimeni değiştirebilir veya aramayı temizleyebilirsin."
                action={
                  <button
                    className="button button-secondary"
                    onClick={() => setQuery('')}
                    type="button"
                  >
                    Aramayı temizle
                  </button>
                }
              />
            ) : (
              <EmptyState
                title="Henüz dükkân yok"
                description="Dükkânlar eklendiğinde burada görünecek. Biraz sonra tekrar deneyebilirsin."
                action={
                  <button className="button" onClick={retryLoading} type="button">
                    Yeniden dene
                  </button>
                }
              />
            )
          )}
          {!loading && !error && filteredShops.length > 0 && (
            <div className="shop-cards">
              {filteredShops.map((shop) => (
                <article className="shop-card" key={shop.id}>
                  <div className="shop-card-heading">
                    <h3>{shop.name}</h3>
                    <span className="shop-rating">
                      <span aria-hidden="true">★</span>{' '}
                      {shop.rating == null
                        ? 'Puan yok'
                        : Number(shop.rating).toFixed(1)}
                    </span>
                  </div>
                  <p className="shop-address">{shop.address}</p>
                  <div className="shop-card-footer">
                    <span className="shop-distance">
                      {shop.distance_km == null
                        ? 'Mesafe bilgisi yok'
                        : `${shop.distance_km} km`}
                    </span>
                    <Link
                      className="button menu-button"
                      to={`/shops/${shop.id}`}
                      state={{ distanceKm: shop.distance_km }}
                    >
                      Menüyü Gör
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="home-map-column" aria-label="Dükkân haritası">
          <ShopMap
            shops={shops}
            center={mapCenter}
            userLocation={userLocation}
          />
        </section>
      </div>
    </div>
  )
}
