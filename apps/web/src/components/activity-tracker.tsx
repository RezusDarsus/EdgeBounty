'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/app/providers';

const pages=new Set(['datasets','models','listings','bounties','orders','assistant','sell','storage','provider','providers','failure-bounties','pricing','dashboard']);
export function ActivityTracker() {
  const pathname=usePathname(), {account}=useSession();
  const visitor=useRef<string|null>(null), lastPage=useRef<string|null>(null);
  useEffect(()=>{
    if(navigator.doNotTrack==='1'||(navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl)return;
    try {
      visitor.current=localStorage.getItem('eb_analytics_visitor');
      if(!visitor.current || !/^[0-9a-f-]{36}$/i.test(visitor.current)) { visitor.current=crypto.randomUUID();localStorage.setItem('eb_analytics_visitor',visitor.current); }
    } catch { visitor.current??=crypto.randomUUID(); }
    const head=pathname.split('/')[1];
    const page=pathname==='/'?'home':pages.has(head)?head:'other';
    const beat=()=>{
      if(document.visibilityState!=='visible')return;
      const pageView=lastPage.current!==pathname;lastPage.current=pathname;
      void api('/analytics/heartbeat',{body:{visitorId:visitor.current,page,pageView}}).catch(()=>{});
    };
    beat();const timer=window.setInterval(beat,30000);
    document.addEventListener('visibilitychange',beat);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',beat);};
  },[pathname,account?.id]);
  return null;
}
