import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Analytics
      beforeSend={(event: BeforeSendEvent) => {
        const url = new URL(event.url)
        url.search = ''
        return { ...event, url: url.toString() }
      }}
    />
  </StrictMode>,
)
