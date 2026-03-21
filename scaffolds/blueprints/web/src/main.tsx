import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './i18n'
import './index.css'
// TODO monitoring-active: import { initAnalytics } from '@/lib/analytics/analytics'

// TODO monitoring-active: initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
