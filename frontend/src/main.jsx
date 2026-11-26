import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store/store'
import { restoreSession, sessionExpired } from './store/authSlice'
import { resetToDefaults } from './store/settingsSync'
import { setSessionExpiredHandler } from './services/api'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

const endSession = () => {
  if (store.getState().auth.status !== 'signedIn') return
  store.dispatch(sessionExpired())
  resetToDefaults(store.dispatch)
}
setSessionExpiredHandler(endSession)
// Signed out in another tab: follow it here too.
window.addEventListener('storage', (e) => {
  if (e.key === 'css.session' && !e.newValue) endSession()
})

// Outside React so StrictMode's double effects can't start two restores (and two token refreshes).
store.dispatch(restoreSession())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <App />
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>
)
