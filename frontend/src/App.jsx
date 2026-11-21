import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { ToastProvider } from './components/ToastProvider'
import AdminPage from './pages/AdminPage'
import HistoryPage from './pages/HistoryPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import OrderPage from './pages/OrderPage'
import QrPage from './pages/QrPage'
import RegisterPage from './pages/RegisterPage'
import ShopOwnerOrdersPage from './pages/ShopOwnerOrdersPage'
import ShopDetailPage from './pages/ShopDetailPage'
import SubscriptionPage from './pages/SubscriptionPage'
import './App.css'

function NotFoundPage() {
  return (
    <section className="panel">
      <h1>Sayfa bulunamadı</h1>
      <p>İstediğin sayfa bu uygulamada bulunmuyor.</p>
    </section>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="shops" element={<HomePage />} />
            <Route path="shops/:shopId" element={<ShopDetailPage />} />
            <Route path="orders/new" element={<OrderPage />} />
            <Route path="qr/:orderId" element={<QrPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="shop-owner" element={<ShopOwnerOrdersPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}
