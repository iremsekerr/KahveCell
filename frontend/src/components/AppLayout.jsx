import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { apiRequest, clearAuthTokens } from '../api/client'

const customerNavigation = [
  ['/', 'Ana sayfa'],
  ['/shops', 'Dükkânlar'],
  ['/subscription', 'Abonelik'],
  ['/history', 'Sipariş geçmişi'],
]
const adminNavigation = [['/admin', 'Yönetim paneli']]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [currentUser, setCurrentUser] = useState(null)
  const [authResolved, setAuthResolved] = useState(false)
  const [roleError, setRoleError] = useState('')
  const [roleReloadKey, setRoleReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/auth/me', { signal: controller.signal })
      .then((user) => {
        if (!controller.signal.aborted) {
          setCurrentUser(user)
        }
      })
      .catch((requestError) => {
        if (
          controller.signal.aborted ||
          requestError.name === 'AbortError' ||
          requestError.status === 401
        ) {
          return
        }
        setRoleError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthResolved(true)
      })

    return () => controller.abort()
  }, [roleReloadKey])

  useEffect(() => {
    if (currentUser?.role === 'ADMIN' && location.pathname === '/') {
      navigate('/admin', { replace: true })
    }
  }, [currentUser, location.pathname, navigate])

  function signOut() {
    clearAuthTokens()
    setCurrentUser(null)
    navigate('/login')
  }

  function retryRoleCheck() {
    setRoleError('')
    setAuthResolved(false)
    setRoleReloadKey((current) => current + 1)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink
          className="brand"
          to={currentUser?.role === 'ADMIN' ? '/admin' : '/'}
        >
          KahveCell
        </NavLink>
        <nav className="main-nav" aria-label="Ana menü">
          {(currentUser?.role === 'ADMIN'
            ? adminNavigation
            : customerNavigation
          ).map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              {label}
            </NavLink>
          ))}
          {authResolved && !currentUser && (
            <>
              <NavLink
                className={({ isActive }) =>
                  isActive ? 'nav-link active' : 'nav-link'
                }
                to="/login"
              >
                Giriş
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  isActive ? 'nav-link active' : 'nav-link'
                }
                to="/register"
              >
                Kayıt
              </NavLink>
            </>
          )}
          {currentUser?.role === 'SHOP_OWNER' && (
            <NavLink
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
              to="/shop-owner"
            >
              Dükkân Siparişleri
            </NavLink>
          )}
          {currentUser && (
            <button className="button button-secondary" onClick={signOut}>
              Çıkış
            </button>
          )}
        </nav>
      </header>
      {roleError && (
        <div className="nav-auth-error" role="alert">
          <span>Kullanıcı yetkisi kontrol edilemedi: {roleError}</span>
          <button
            className="button button-secondary"
            onClick={retryRoleCheck}
            type="button"
          >
            Tekrar dene
          </button>
        </div>
      )}
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  )
}
