export function LoadingState({ message = 'Yükleniyor...' }) {
  return (
    <div className="state-card loading-state" role="status">
      <span aria-hidden="true" className="loading-spinner" />
      <span>{message}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <section className="state-card error-state" role="alert">
      <div>
        <p className="eyebrow">Bir şeyler ters gitti</p>
        <p>{message}</p>
      </div>
      <button className="button" onClick={onRetry} type="button">
        Tekrar dene
      </button>
    </section>
  )
}

export function EmptyState({ title, description, action }) {
  return (
    <section className="state-card empty-state">
      <span aria-hidden="true" className="empty-state-icon">
        ☕
      </span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </section>
  )
}
