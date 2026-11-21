import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiRequest, saveAuthTokens } from '../api/client'
import { useToast } from '../components/useToast'

export default function LoginPage() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function submitPhone(event) {
    event.preventDefault()
    setLoading(true)
    try {
      const result = await apiRequest('/auth/login', {
        method: 'POST',
        body: { phone_number: phoneNumber },
        token: null,
      })
      setOtpSent(true)
      setMessage(result.message)
      showToast('success', result.message)
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setLoading(false)
    }
  }

  async function submitOtp(event) {
    event.preventDefault()
    setLoading(true)
    try {
      const tokens = await apiRequest('/auth/verify-otp', {
        method: 'POST',
        body: { phone_number: phoneNumber, otp_code: otpCode },
        token: null,
      })
      if (!tokens.access_token) {
        throw new Error('Bu numara için önce kayıt işlemini tamamla.')
      }
      saveAuthTokens(tokens)
      showToast('success', 'Giriş başarılı.')
      navigate(tokens.user?.role === 'ADMIN' ? '/admin' : '/')
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="auth-brand">KahveCell</p>
        <h1>Giriş yap</h1>
        <p className="auth-description">
          {otpSent
            ? 'Telefonuna gelen 4 haneli kodu gir.'
            : 'Telefon numaranla güvenli şekilde giriş yap.'}
        </p>
        {!otpSent ? (
          <form className="form-stack" onSubmit={submitPhone}>
            <label htmlFor="phone">GSM numarası</label>
            <input
              id="phone"
              autoComplete="tel"
              placeholder="+905551234567"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              required
            />
            <button className="button auth-button" disabled={loading}>
              {loading ? 'Gönderiliyor...' : 'Devam et'}
            </button>
          </form>
        ) : (
          <form className="form-stack" onSubmit={submitOtp}>
            {message && <p className="auth-description">{message}</p>}
            <label htmlFor="otp">4 haneli kod</label>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              pattern="[0-9]{4}"
              placeholder="1234"
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
              required
            />
            <p className="auth-hint">
              Simülasyon notu: test kodu her zaman <strong>1234</strong>.
            </p>
            <button className="button auth-button" disabled={loading}>
              {loading ? 'Kontrol ediliyor...' : 'Giriş yap'}
            </button>
          </form>
        )}
        <p className="form-footnote">
          Hesabın yok mu? <Link to="/register">Kayıt ol</Link>
        </p>
      </section>
    </main>
  )
}
