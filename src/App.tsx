import { BrowserRouter, Routes, Route } from 'react-router-dom'
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
import { Payables } from './pages/Payables'
import { Receivables } from './pages/Receivables'
import { Settings }           from './pages/Settings'
import { ShipmentDocuments }  from './pages/ShipmentDocuments'


export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index                  element={<Dashboard />}      />
          <Route path="shipments"       element={<Shipments />}      />
          <Route path="shipments/:id"   element={<ShipmentDetail />} />
          <Route path="suppliers"       element={<Suppliers />}      />
          <Route path="products"        element={<Products />}       />
          <Route path="production"      element={<Production />}     />
          <Route path="inventory"       element={<Inventory />}      />
          <Route path="costs"          element={<CostEngine />}     />
          <Route path="payables"       element={<Payables />}       />
          <Route path="receivables"    element={<Receivables />}    />
          <Route path="reports"         element={<Reports />}        />
          <Route path="shipments/:id/finalize" element={<CostFinalization />} />
          <Route path="shipments/:id/documents" element={<ShipmentDocuments />} />
          <Route path="settings"                element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}