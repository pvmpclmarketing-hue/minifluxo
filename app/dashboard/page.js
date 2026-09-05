import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import Dashboard from './ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function DashboardPage({ searchParams }) {
  const query = await searchParams;
  const validTabs = new Set(['dashboard','flows','connections','leads','contacts','dispatches','videos','apis','webhooks']);
  const initialTab = validTabs.has(query?.tab) ? query.tab : 'dashboard';
  const jar = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => jar.getAll() } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: leads = [] } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(100);
  const { data: connections = [] } = await supabase.from('connections').select('*').order('created_at', { ascending: false });
  const { data: flows = [] } = await supabase.from('flows').select('*').order('created_at', { ascending: false });
  const { data: dispatchConfigs = [] } = await supabase.from('connection_flow_configs').select('*');
  const { data: videos = [] } = await supabase.from('video_orders').select('*').order('created_at', { ascending: false }).limit(50);
  return <Dashboard initialTab={initialTab} userEmail={user.email} initialLeads={leads || []} initialConnections={connections || []} initialFlows={flows || []} initialDispatchConfigs={dispatchConfigs || []} initialVideos={videos || []} />;
}
