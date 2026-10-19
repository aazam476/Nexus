import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import './styles.css'
import { StoreProvider } from './lib/store'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { TwoFactorPage } from './pages/TwoFactorPage'
import { MailPage } from './pages/MailPage'
import { ContactsPage } from './pages/ContactsPage'
import { SettingsPage } from './pages/settings/SettingsPage'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/login/2fa" element={<TwoFactorPage />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/mail/inbox" replace />} />
              <Route path="/mail/:folder/:messageId?" element={<MailPage />} />
              <Route path="/contacts/:contactId?" element={<ContactsPage />} />
              <Route path="/settings/:section?" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StoreProvider>
    </QueryClientProvider>
  </StrictMode>,
)
