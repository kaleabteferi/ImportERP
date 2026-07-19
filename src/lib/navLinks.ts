// src/lib/navLinks.ts — single source of truth for "every page in the app,
// grouped, with who can see it." Shared by the desktop Sidebar and the
// mobile "More" menu so the two navigation surfaces can't drift apart —
// previously MobileNav only exposed 5 hardcoded tabs with no way to reach
// anything else (Suppliers, RFQs, Djibouti, Customers, Products, BOMs,
// Inventory, Finance pages, HR pages, Settings, ...) while in mobile mode.
import {
  LayoutDashboard, Ship, Building2,
  Wrench, Package, Calculator, BarChart3,
  Tag, Wallet, CreditCard, Banknote, Landmark, Receipt, CalendarDays, Users, Hammer, ListTree, Truck, Anchor,
  ShoppingCart, Sigma, FileSearch,
  UserCog, IdCard, Wallet as WalletIcon, BookOpen, FileQuestion,
  Settings as SettingsIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Role } from './roles'

export interface NavLinkDef { to: string; icon: LucideIcon; label: string; allow: Role[] }
export interface NavGroup { section: string; items: NavLinkDef[] }

// allow: [] means visible to every authenticated role (pure reporting/overview pages).
export const NAV_LINKS: NavGroup[] = [
  { section: 'Overview', items: [
    { to: '/',              icon: LayoutDashboard, label: 'Dashboard',      allow: [] },
    { to: '/daily-activity',icon: CalendarDays,    label: 'Daily Activity', allow: [] },
    { to: '/calculator',    icon: Sigma,            label: 'Calculator',     allow: [] },
    { to: '/documentation', icon: FileQuestion,     label: 'Documentation',  allow: [] },
  ]},
  { section: 'Import', items: [
    { to: '/shipments',  icon: Ship,       label: 'Shipments',  allow: ['operations_marketing'] },
    { to: '/rfqs',       icon: FileSearch, label: 'Supplier RFQs', allow: ['operations_marketing', 'accounting_finance'] },
    { to: '/djibouti',   icon: Anchor,     label: 'Djibouti Forwarder', allow: ['operations_marketing', 'accounting_finance'] },
    { to: '/suppliers',  icon: Building2,  label: 'Suppliers',  allow: ['operations_marketing'] },
    { to: '/customers',  icon: Users,      label: 'Customers',  allow: ['operations_marketing', 'manufacturing_sales'] },
    { to: '/products',   icon: Tag,        label: 'Products',   allow: ['operations_marketing', 'manufacturing_sales'] },
  ]},
  { section: 'Operations', items: [
    { to: '/production',  icon: Wrench,      label: 'Production', allow: ['manufacturing_sales'] },
    { to: '/assembly',    icon: Hammer,      label: 'Assembly',   allow: ['manufacturing_sales'] },
    { to: '/boms',        icon: ListTree,    label: 'BOMs',       allow: ['manufacturing_sales'] },
    { to: '/inventory',   icon: Package,     label: 'Inventory',  allow: ['manufacturing_sales', 'operations_marketing'] },
    { to: '/warehouse-transfers', icon: Truck, label: 'Warehouse Transfers', allow: ['manufacturing_sales', 'operations_marketing'] },
  ]},
  { section: 'Sales', items: [
    { to: '/sales', icon: ShoppingCart, label: 'Sales', allow: ['manufacturing_sales', 'accounting_finance'] },
  ]},
  { section: 'Finance', items: [
    { to: '/costs',          icon: Calculator,  label: 'Cost Engine',     allow: ['accounting_finance'] },
    { to: '/customs-estimator', icon: Calculator, label: 'Customs Estimator', allow: ['accounting_finance', 'operations_marketing'] },
    { to: '/payables',       icon: Wallet,      label: 'Payables',        allow: ['accounting_finance'] },
    { to: '/receivables',    icon: CreditCard,  label: 'Receivables',     allow: ['accounting_finance'] },
    { to: '/money-tracking', icon: Banknote,    label: 'Money Tracking',  allow: ['accounting_finance'] },
    { to: '/credit-accounts',icon: Landmark,    label: 'Credit Accounts', allow: ['accounting_finance'] },
    { to: '/expenses',       icon: Receipt,     label: 'Expenses',        allow: ['accounting_finance'] },
    { to: '/reports',        icon: BarChart3,   label: 'Reports',         allow: [] },
  ]},
  { section: 'HR', items: [
    { to: '/employees', icon: IdCard,      label: 'Employees',  allow: ['hr_system'] },
    { to: '/payroll',   icon: WalletIcon,  label: 'Payroll',    allow: ['hr_system'] },
    { to: '/hr-notes',  icon: BookOpen,    label: 'HR Notes',   allow: ['hr_system'] },
  ]},
  { section: 'System', items: [
    { to: '/users',    icon: UserCog,    label: 'Users & Roles', allow: ['hr_system'] },
    { to: '/settings', icon: SettingsIcon, label: 'Settings',    allow: ['hr_system'] },
  ]},
]
