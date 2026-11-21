import { useCallback, useEffect, useMemo, useState } from 'react'
import { divIcon, latLngBounds } from 'leaflet'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import { Link } from 'react-router-dom'
import { ErrorState } from './FeedbackStates'

const defaultCenter = [39.9208, 32.8541]

function MapViewport({ center, shops, userLocation }) {
  const map = useMap()

  useEffect(() => {
    const points = shops.map((shop) => [shop.latitude, shop.longitude])
    if (userLocation) {
      points.push([userLocation.latitude, userLocation.longitude])
    }

    if (points.length > 1) {
      map.fitBounds(latLngBounds(points), {
        maxZoom: 14,
        padding: [28, 28],
      })
    } else {
      map.setView(points[0] ?? center, 12)
    }
  }, [center, map, shops, userLocation])

  return null
}

export default function ShopMap({
  shops,
  center = defaultCenter,
  userLocation = null,
}) {
  const [tileError, setTileError] = useState(false)
  const [tileRetryKey, setTileRetryKey] = useState(0)
  const shopMarkerIcon = useMemo(
    () =>
      divIcon({
        className: 'shop-map-marker',
        html: '<span></span>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    [],
  )
  const userMarkerIcon = useMemo(
    () =>
      divIcon({
        className: 'user-location-marker',
        html: '<span></span>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    [],
  )
  const tileEventHandlers = useMemo(
    () => ({
      tileerror: () => setTileError(true),
    }),
    [],
  )

  const retryTiles = useCallback(() => {
    setTileError(false)
    setTileRetryKey((current) => current + 1)
  }, [])

  return (
    <div className="map-frame">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={false}
        className="shop-map"
      >
        <MapViewport
          center={center}
          shops={shops}
          userLocation={userLocation}
        />
        <TileLayer
          eventHandlers={tileEventHandlers}
          key={tileRetryKey}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {shops.map((shop) => (
          <Marker
            key={shop.id}
            position={[shop.latitude, shop.longitude]}
            icon={shopMarkerIcon}
          >
            <Popup>
              <strong>{shop.name}</strong>
              <br />
              {shop.address}
              <br />
              <Link
                to={`/shops/${shop.id}`}
                state={{ distanceKm: shop.distance_km }}
              >
                Dükkânı görüntüle
              </Link>
            </Popup>
          </Marker>
        ))}
        {userLocation && (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={userMarkerIcon}
          >
            <Popup>Senin konumun</Popup>
          </Marker>
        )}
      </MapContainer>
      {tileError && (
        <div className="map-error-overlay">
          <ErrorState
            message="Harita görüntüsü yüklenemedi. Dükkân listesi kullanılabilir."
            onRetry={retryTiles}
          />
        </div>
      )}
    </div>
  )
}
