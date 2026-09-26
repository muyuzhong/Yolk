import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// No StrictMode: its doubled effects in development would run every review (gh + Jev requests) twice.
createRoot(document.getElementById('root')!).render(<App />)
