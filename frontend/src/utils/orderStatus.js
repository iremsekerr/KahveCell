const STATUS_INFO = {
  PENDING: { label: 'Bekliyor', tone: 'pending' },
  ACCEPTED: { label: 'Kabul Edildi', tone: 'accepted' },
  PREPARING: { label: 'Hazırlanıyor', tone: 'preparing' },
  READY: { label: 'Hazır', tone: 'ready' },
  DELIVERED: { label: 'Teslim Edildi', tone: 'delivered' },
  CANCELLED: { label: 'İptal Edildi', tone: 'cancelled' },
}

export function getOrderStatusInfo(status, fallbackLabel) {
  return (
    STATUS_INFO[status] ?? {
      label: fallbackLabel ?? 'Durum bilinmiyor',
      tone: 'unknown',
    }
  )
}
