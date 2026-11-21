import { getOrderStatusInfo } from '../utils/orderStatus'

export default function OrderStatusBadge({ status, fallbackLabel }) {
  const { label, tone } = getOrderStatusInfo(status, fallbackLabel)

  return (
    <span className={`order-status-badge order-status-${tone}`}>
      {label}
    </span>
  )
}
