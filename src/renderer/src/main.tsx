import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// No StrictMode: its doubled effects in development would run every review (gh + Jev requests) twice.
createRoot(document.getElementById('root')!).render(<App />)
