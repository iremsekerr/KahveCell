import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiRequest, saveAuthTokens } from '../api/client'
import { useToast } from '../components/useToast'

export default function RegisterPage() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [step, setStep] = useState('phone')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [profileToken, setProfileToken] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function requestOtp(event) {
    event.preventDefault()
    setLoading(true)
    try {
      await apiRequest('/auth/register', {
        method: 'POST',
        body: { phone_number: phoneNumber },
        token: null,
      })
      setStep('otp')
      showToast('success', 'Doğrulama kodu gönderildi. Test kodu: 1234.')
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp(event) {
    event.preventDefault()
    setLoading(true)
    try {
      const result = await apiRequest('/auth/verify-otp', {
        method: 'POST',
        body: { phone_number: phoneNumber, otp_code: otpCode },
        token: null,
      })
      if (!result.profile_token) {
        throw new Error('Kayıt için profil tamamlama tokenı alınamadı.')
      }
      setProfileToken(result.profile_token)
      setStep('profile')
      showToast('success', 'Telefon numaran doğrulandı.')
    } catch (requestError) {
      showToast('error', requestError.message)
    } finally {
      setLoading(false)
    }
  }

  async function completeProfile(event) {
    event.preventDefault()
    setLoading(true)
    try {
      const tokens = await apiRequest('/auth/complete-profile', {
        method: 'POST',
        token: profileToken,
        body: {
          first_name: firstName,
          last_name: lastName,
          email: email || null,
        },
      })
      saveAuthTokens(tokens)
      showToast('success', 'Kayıt tamamlandı.')
      navigate('/')
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
        <h1>Kayıt ol</h1>
        <p className="auth-description">
          {step === 'phone' && 'Telefon numaranla hesabını oluşturmaya başla.'}
          {step === 'otp' && 'Telefonuna gelen 4 haneli kodu gir.'}
          {step === 'profile' && 'Numaran doğrulandı. Profilini tamamla.'}
        </p>
        {step === 'phone' && (
          <form className="form-stack" onSubmit={requestOtp}>
            <label htmlFor="register-phone">GSM numarası</label>
            <input
              id="register-phone"
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
        )}
        {step === 'otp' && (
          <form className="form-stack" onSubmit={verifyOtp}>
            <label htmlFor="register-otp">4 haneli kod</label>
            <input
              id="register-otp"
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
              {loading ? 'Doğrulanıyor...' : 'Numarayı doğrula'}
            </button>
          </form>
        )}
        {step === 'profile' && (
          <form className="form-stack" onSubmit={completeProfile}>
            <label htmlFor="first-name">Ad</label>
            <input
              id="first-name"
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
            />
            <label htmlFor="last-name">Soyad</label>
            <input
              id="last-name"
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
            />
            <label htmlFor="email">E-posta (isteğe bağlı)</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button className="button auth-button" disabled={loading}>
              {loading ? 'Kaydediliyor...' : 'Kaydı tamamla'}
            </button>
          </form>
        )}
        <p className="form-footnote">
          Zaten hesabın var mı? <Link to="/login">Giriş yap</Link>
        </p>
      </section>
    </main>
  )
}
