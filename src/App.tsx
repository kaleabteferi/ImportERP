import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { PageStateProvider } from './lib/pageState'
import { RequireAuth } from './components/auth/RequireAuth'
import { RequireRole } from './components/auth/RequireRole'
import { Layout }         from './components/layout/Layout'
import { Dashboard }      from './pages/Dashboard'
import { Shipments }      from './pages/Shipments'
import { ShipmentDetail } from './pages/ShipmentDetail'
import { Suppliers }      from './pages/Suppliers'
import { Products }       from './pages/Products'
import { Production }     from './pages/Production'
import { Inventory }      from './pages/Inventory'
import { Reports }        from './pages/Reports'
import { CostFinalization } from './pages/CostFinalization'
import { CostEngine } from './pages/CostEngine'
import { CustomsEstimator } from './pages/CustomsEstimator'
import { Payables } from './pages/Payables'
import { Receivables } from './pages/Receivables'
import { MoneyTracking } from './pages/MoneyTracking'
import { CreditAccounts } from './pages/CreditAccounts'
import { Expenses } from './pages/Expenses'
import { DailyActivity } from './pages/DailyActivity'
import { Customers } from './pages/Customers'
import { Sales } from './pages/Sales'
import { Assembly } from './pages/Assembly'
import { Boms } from './pages/Boms'
import { WarehouseTransfers } from './pages/WarehouseTransfers'
import { DjiboutiForwarder } from './pages/DjiboutiForwarder'
import { Users } from './pages/Users'
import { Settings }           from './pages/Settings'
import { ShipmentDocuments }  from './pages/ShipmentDocuments'


export default function App() {
  return (
    <AuthProvider>
      <RequireAuth>
        <PageStateProvider>
          <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index                  element={<Dashboard />}      />
              <Route path="daily-activity"  element={<DailyActivity />}  />
              <Route path="reports"         element={<Reports />}        />

              <Route path="shipments" element={
                <RequireRole allow={['operations_marketing']}><Shipments /></RequireRole>
              } />
              <Route path="shipments/:id" element={
                <RequireRole allow={['operations_marketing']}><ShipmentDetail /></RequireRole>
              } />
              <Route path="shipments/:id/finalize" element={
                <RequireRole allow={['operations_marketing', 'accounting_finance']}><CostFinalization /></RequireRole>
              } />
              <Route path="shipments/:id/documents" element={
                <RequireRole allow={['operations_marketing', 'accounting_finance']}><ShipmentDocuments /></RequireRole>
              } />
              <Route path="suppliers" element={
                <RequireRole allow={['operations_marketing']}><Suppliers /></RequireRole>
              } />
              <Route path="customers" element={
                <RequireRole allow={['operations_marketing', 'manufacturing_sales']}><Customers /></RequireRole>
              } />
              <Route path="sales" element={
                <RequireRole allow={['manufacturing_sales', 'accounting_finance']}><Sales /></RequireRole>
              } />
              <Route path="products" element={
                <RequireRole allow={['operations_marketing', 'manufacturing_sales']}><Products /></RequireRole>
              } />

              <Route path="production" element={
                <RequireRole allow={['manufacturing_sales']}><Production /></RequireRole>
              } />
              <Route path="assembly" element={
                <RequireRole allow={['manufacturing_sales']}><Assembly /></RequireRole>
              } />
              <Route path="boms" element={
                <RequireRole allow={['manufacturing_sales']}><Boms /></RequireRole>
              } />
              <Route path="inventory" element={
                <RequireRole allow={['manufacturing_sales', 'operations_marketing']}><Inventory /></RequireRole>
              } />
              <Route path="warehouse-transfers" element={
                <RequireRole allow={['manufacturing_sales', 'operations_marketing']}><WarehouseTransfers /></RequireRole>
              } />
              <Route path="djibouti" element={
                <RequireRole allow={['operations_marketing', 'accounting_finance']}><DjiboutiForwarder /></RequireRole>
              } />

              <Route path="costs" element={
                <RequireRole allow={['accounting_finance']}><CostEngine /></RequireRole>
              } />
              <Route path="customs-estimator" element={
                <RequireRole allow={['accounting_finance', 'operations_marketing']}><CustomsEstimator /></RequireRole>
              } />
              <Route path="payables" element={
                <RequireRole allow={['accounting_finance']}><Payables /></RequireRole>
              } />
              <Route path="receivables" element={
                <RequireRole allow={['accounting_finance']}><Receivables /></RequireRole>
              } />
              <Route path="money-tracking" element={
                <RequireRole allow={['accounting_finance']}><MoneyTracking /></RequireRole>
              } />
              <Route path="credit-accounts" element={
                <RequireRole allow={['accounting_finance']}><CreditAccounts /></RequireRole>
              } />
              <Route path="expenses" element={
                <RequireRole allow={['accounting_finance']}><Expenses /></RequireRole>
              } />

              <Route path="users" element={
                <RequireRole allow={['hr_system']}><Users /></RequireRole>
              } />
              <Route path="settings" element={
                <RequireRole allow={['hr_system']}><Settings /></RequireRole>
              } />
            </Route>
          </Routes>
        </BrowserRouter>
        </PageStateProvider>
      </RequireAuth>
    </AuthProvider>
  )
}