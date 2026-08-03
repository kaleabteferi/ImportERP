import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, FilePlus2, Inbox, PackageSearch, ShoppingCart, Truck, X } from 'lucide-react'
import { GlobalSearchBar } from './GlobalSearchBar'

const QUICK = [
  { to:'/work',label:'Open my work',icon:Inbox },{to:'/documents',label:'Create or find a document',icon:FilePlus2},
  {to:'/warehouse-operations',label:'Warehouse operations',icon:Truck},{to:'/inventory',label:'Check inventory',icon:PackageSearch},
  {to:'/sales',label:'Create a sale',icon:ShoppingCart},{to:'/calculator',label:'Open calculator',icon:Calculator},
]
export function CommandPalette({open,onClose}:{open:boolean;onClose:()=>void}){
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(open)onClose()}if(event.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[open,onClose])
  if(!open)return null
  return <div className="command-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Search and commands"><header><div><span>Go anywhere</span><strong>Search the ERP</strong></div><button onClick={onClose} aria-label="Close command menu"><X/></button></header><GlobalSearchBar autoFocus placeholder="Product, SKU, document, container, transfer, employee…"/><div className="command-quick"><span>Quick actions</span>{QUICK.map(item=><Link key={item.to} to={item.to} onClick={onClose}><item.icon/><b>{item.label}</b><small>Open</small></Link>)}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd> browse</span><span><kbd>Esc</kbd> close</span></footer></section></div>
}
