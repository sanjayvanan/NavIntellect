/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { Component } from 'react'

/**
 * Catches a crash anywhere below it and shows what went wrong with a Reload button, instead of
 * React removing the whole page (which left only the dark background: a "black screen").
 */
class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" style={styles.wrap}>
        <div style={styles.card}>
          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.text}>The app hit an error and could not show this screen.</p>
          <pre style={styles.detail}>{String(error?.message || error)}</pre>
          <button type="button" style={styles.button} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}

const styles = {
  wrap: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20, background: '#0b1f33', boxSizing: 'border-box' },
  card: { maxWidth: 420, width: '100%', padding: 24, borderRadius: 14, background: '#fff', color: '#1a1f27', fontFamily: 'system-ui, -apple-system, sans-serif' },
  title: { margin: '0 0 8px', fontSize: 20 },
  text: { margin: '0 0 12px', color: '#5b6470', fontSize: 15 },
  detail: { margin: '0 0 16px', padding: 10, borderRadius: 8, background: '#f1f4f8', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  button: { padding: '10px 18px', border: 'none', borderRadius: 8, background: '#1e88e5', color: '#fff', fontSize: 15, fontWeight: 600 },
}

export default ErrorBoundary
