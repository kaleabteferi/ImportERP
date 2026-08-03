import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { loadCommandCenter, markNotificationRead, type AppNotification } from '../api/operationalCore'
import { supabase } from '../lib/supabase'

export function NotificationMenu(){
 const [items,setItems]=useState<AppNotification[]>([]);const[open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null)
 useEffect(()=>{loadCommandCenter().then(data=>setItems(data.notifications)).catch(()=>undefined);const channel=supabase.channel('layout-notifications').on('postgres_changes',{event:'*',schema:'public',table:'app_notifications'},()=>{loadCommandCenter().then(data=>setItems(data.notifications)).catch(()=>undefined)}).subscribe();return()=>{void supabase.removeChannel(channel)}},[])
 useEffect(()=>{const outside=(event:MouseEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false)};document.addEventListener('mousedown',outside);return()=>document.removeEventListener('mousedown',outside)},[])
 const unread=items.filter(item=>!item.read_at).length
 const read=async(item:AppNotification)=>{if(!item.read_at){await markNotificationRead(item.id).catch(()=>undefined);setItems(current=>current.map(value=>value.id===item.id?{...value,read_at:new Date().toISOString()}:value))}setOpen(false)}
 return <div className="notification-menu" ref={root}><button className="utility-icon" onClick={()=>setOpen(value=>!value)} aria-label={`${unread} unread notifications`} aria-expanded={open}><Bell/>{unread>0&&<b>{unread>9?'9+':unread}</b>}</button>{open&&<section><header><div><span>Work signals</span><strong>Notifications</strong></div><b>{unread} unread</b></header><div>{items.length?items.slice(0,8).map(item=><article key={item.id} className={`${item.read_at?'read':''} severity-${item.severity}`}><i/><div><strong>{item.title}</strong><p>{item.message||item.category}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>{item.action_url?<Link to={item.action_url} onClick={()=>void read(item)}>Open</Link>:<button onClick={()=>void read(item)}><CheckCheck/></button>}</article>):<p className="notification-empty">No active notifications.</p>}</div><footer><Link to="/work" onClick={()=>setOpen(false)}>Open My Work</Link></footer></section>}</div>
}
