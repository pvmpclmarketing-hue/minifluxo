'use client';

import { useEffect, useMemo, useState } from 'react';
import FlowCanvas from './flow-canvas';
import ConnectionsPanel, { ConnectionCreationModal } from './connections-panel';

const labels={waiting_pix:'Aguardando Pix',waiting_briefing:'Aguardando briefing',waiting_response:'Aguardando resposta',generating:'Gerando musica',completed:'Entregue',in_progress:'Em andamento'};
const contactSources={inbound:'Chamou primeiro',manual:'Chamado por disparo',site:'Chamado pelo site',payment:'Chamado apos pagamento'};
const contactSource=item=>contactSources[item.order_context?.contact_origin||item.source]||'Chamado por disparo';

export default function Dashboard({userEmail,initialLeads,initialConnections,initialFlows,initialDispatchConfigs}){
  const [tab,setTab]=useState('dashboard');
  const [leads,setLeads]=useState(initialLeads);
  const [connections,setConnections]=useState(initialConnections);
  const [flows,setFlows]=useState(initialFlows);
  const [configs,setConfigs]=useState(initialDispatchConfigs);
  const [selected,setSelected]=useState(initialFlows[0]||null);
  const [modal,setModal]=useState('');
  const [error,setError]=useState('');
  const [origin,setOrigin]=useState('https://minifluxo.vercel.app');
  useEffect(()=>setOrigin(window.location.origin),[]);

  const connected=connections.find(item=>item.status==='connected');
  const metrics=useMemo(()=>({total:leads.length,waiting:leads.filter(item=>item.status!=='completed').length,complete:leads.filter(item=>item.status==='completed').length}),[leads]);
  const titles={dashboard:'Dashboard',flows:'Fluxos',connections:'Conexoes',leads:'Atendimentos',contacts:'Historico de contatos',dispatches:'Disparos',webhooks:'Webhooks'};
  const title=tab==='flow'?selected?.name:titles[tab];
  const menu=[['dashboard','Dashboard'],['flows','Fluxos'],['connections','Conexoes'],['leads','Atendimentos'],['contacts','Historico de contatos'],['dispatches','Disparos'],['webhooks','Webhooks']];

  async function submit(url,event,done){
    event.preventDefault();setError('');
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});
    const data=await response.json();if(!response.ok)return setError(data.error);done(data);
  }
  const createFlow=event=>submit('/api/flows',event,item=>{setFlows([item,...flows]);setSelected(item);setModal('');setTab('flow');});
  const createLead=event=>submit('/api/leads',event,item=>{setLeads([item,...leads]);setModal('');});
  const createConnection=event=>submit('/api/connections',event,item=>{setConnections([...connections,item]);setModal('');});
  const saveConfig=event=>submit('/api/dispatch-config',event,item=>{setConfigs([...configs.filter(config=>config.connection_id!==item.connection_id),item]);setError('Configuracao salva.');});
  async function deleteContact(id){if(!window.confirm('Apagar este contato? Se ele chamar novamente, o fluxo sera iniciado do zero.'))return;setError('');const response=await fetch(`/api/leads/${id}`,{method:'DELETE'});if(!response.ok){const data=await response.json();return setError(data.error||'Nao foi possivel apagar o contato.');}setLeads(current=>current.filter(item=>item.id!==id));}

  return <div className="shell">
    <aside className="side">
      <div className="brand"><div className="mark">W</div><span>Whats<span>Entregavel</span></span></div>
      <nav>{menu.map(([id,text])=><button key={id} className={tab===id||tab==='flow'&&id==='flows'?'active':''} onClick={()=>setTab(id)}>{text}</button>)}</nav>
      <div className="side-foot"><div className={'dot '+(connected?'online':'')}/><small>{connected?`Conectado: ${connected.name}`:'WhatsApp desconectado'}</small></div>
    </aside>
    <main className="content">
      <header><div><p className="eyebrow">PAINEL OPERACIONAL</p><h1>{title}</h1></div><div className="head-actions"><span className="account">{userEmail}</span>{tab==='flows'&&<button className="primary" onClick={()=>setModal('flow')}>+ Novo fluxo</button>}{tab==='leads'&&<button className="primary" onClick={()=>setModal('lead')}>+ Novo contato</button>}{tab==='connections'&&<button className="primary" onClick={()=>setModal('connection')}>+ Nova conexao</button>}</div></header>
      {tab==='dashboard'&&<DashboardHome metrics={metrics} flows={flows} open={()=>setTab('flows')}/>}
      {tab==='flows'&&<Flows flows={flows} open={item=>{setSelected(item);setTab('flow');}} create={()=>setModal('flow')}/>}
      {tab==='flow'&&(selected?<FlowCanvas flow={selected}/>:<Empty text="Crie seu primeiro fluxo."/>)}
      {tab==='leads'&&<Leads leads={leads}/>}
      {tab==='contacts'&&<ContactsHistoryWithDelete leads={leads} remove={deleteContact}/>}
      {tab==='connections'&&<ConnectionsPanel items={connections} onConnectionsChange={setConnections}/>}
      {tab==='dispatches'&&<Dispatches connections={connections} flows={flows} configs={configs} save={saveConfig}/>}
      {tab==='webhooks'&&<Webhooks origin={origin} connections={connections}/>}
    </main>
    {modal==='flow'&&<Modal title="Novo fluxo" close={()=>setModal('')} error={error}><form onSubmit={createFlow}><label>Nome do fluxo<input name="name" required/></label><label>Descricao<input name="description"/></label><button className="primary">Criar fluxo</button></form></Modal>}
    {modal==='lead'&&<Modal title="Iniciar contato" close={()=>setModal('')} error={error}><form onSubmit={createLead}><label>Nome<input name="name" required/></label><label>WhatsApp com DDI<input name="phone" required/></label><button className="primary">Enviar mensagem</button></form></Modal>}
    {modal==='connection'&&<ConnectionCreationModal close={()=>setModal('')} create={createConnection} error={error}/>} {error&&!modal&&<div className="toast">{error}</div>}
  </div>;
}

function DashboardHome({metrics,flows,open}){return <><section className="metrics"><Metric label="Atendimentos" value={metrics.total}/><Metric label="Em andamento" value={metrics.waiting}/><Metric label="Entregues" value={metrics.complete}/><Metric label="Fluxos" value={flows.length}/></section><section className="table-card"><div className="table-head"><h2>Seus fluxos</h2><button className="link" onClick={open}>Ver fluxos</button></div>{flows.length?<div className="lead-list">{flows.slice(0,3).map(item=><article className="lead-row" key={item.id}><div className="avatar">F</div><div><b>{item.name}</b><small>{item.description||'Fluxo de entrega'}</small></div></article>)}</div>:<Empty text="Crie seu primeiro fluxo."/>}</section></>}
function Flows({flows,open,create}){return <section className="flows-list">{flows.map(item=><button className="flow-card" key={item.id} onClick={()=>open(item)}><span className="flow-dot active"/><b>{item.name}</b><small>{item.description||'Fluxo de entrega musical'}</small><footer>{item.status==='active'?'ATIVO':'PAUSADO'} <i>{'>'}</i></footer></button>)}<button className="new-flow-card" onClick={create}><strong>+</strong><b>Novo fluxo</b><small>Crie uma automacao no canvas</small></button></section>}
function Dispatches({connections,flows,configs,save}){if(!connections.length)return <Empty text="Crie uma conexao WhatsApp antes de configurar disparos."/>;return <section className="dispatch-list">{connections.map(connection=>{const config=configs.find(item=>item.connection_id===connection.id)||{};return <form key={connection.id} className="dispatch-card" onSubmit={save}><input type="hidden" name="connection_id" value={connection.id}/><div className="dispatch-title"><div className="avatar">W</div><div><h2>{connection.name}</h2><small>{connection.provider} - configure os gatilhos deste numero</small></div></div><label>Fluxo para pagamento aprovado<select name="payment_flow_id" defaultValue={config.payment_flow_id||''}><option value="">Nao disparar</option>{flows.map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select><small>Inicia quando o gateway confirmar o pagamento.</small></label><label>Fluxo para novas conversas<select name="conversation_flow_id" defaultValue={config.conversation_flow_id||''}><option value="">Nao disparar</option>{flows.map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select><small>Inicia quando alguem enviar a primeira mensagem para este numero.</small></label><label>Fluxo para pedido vindo do site<select name="site_flow_id" defaultValue={config.site_flow_id||''}><option value="">Nao disparar</option>{flows.map(flow=><option key={flow.id} value={flow.id}>{flow.name}</option>)}</select><small>Inicia quando seu site enviar nome, numero e pedido musical.</small></label><button className="primary">Salvar disparos</button></form>;})}</section>}
function Webhooks({origin,connections}){const connectionId=connections[0]?.id||'ID_DA_CONEXAO';return <section className="webhook-grid"><article className="webhook-card"><p className="eyebrow">PAGAMENTO APROVADO</p><h2>Webhook de pagamento</h2><p>O fluxo sera escolhido na aba Disparos pelo numero/conexao. Para entregar a mesma prévia, o site deve enviar as duas URLs de áudio em <code>preview.audios</code>.</p><label>URL<input readOnly value={`${origin}/api/webhooks/payment`}/></label><label>Header<input readOnly value="x-payment-secret: seu PAYMENT_WEBHOOK_SECRET"/></label></article><article className="webhook-card"><p className="eyebrow">EXEMPLO COM PRÉVIA</p><pre>{JSON.stringify({event:'PAYMENT_APPROVED',connection_id:connectionId,order_id:'pedido_123',customer:{name:'Ana Martins',phone:'5511999999999'},preview:{task_id:'kie_task_123',audios:['https://arquivo.com/preview-1.mp3','https://arquivo.com/preview-2.mp3']}},null,2)}</pre></article></section>}
function Leads({leads}){return <section className="table-card"><div className="table-head"><h2>Ultimos atendimentos</h2></div>{leads.length?<div className="lead-list">{leads.map(item=><article key={item.id} className="lead-row"><div className="avatar">{(item.name||'C')[0]}</div><div><b>{item.name||'Cliente WhatsApp'}</b><small>+{item.phone} - {item.source}</small></div><span className={'status '+item.status}>{labels[item.status]||item.status}</span></article>)}</div>:<Empty text="Nenhum atendimento."/>}</section>}
function ContactsHistory({leads}){const formatDate=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'-';return <section className="table-card"><div className="table-head"><div><h2>Historico de contatos</h2><small>Pessoas que iniciaram conversa ou receberam um disparo.</small></div></div>{leads.length?<div className="lead-list">{leads.map(item=><article key={item.id} className="lead-row"><div className="avatar">{(item.name||'C')[0]}</div><div><b>{item.name||'Cliente WhatsApp'}</b><small>+{item.phone} · {contactSources[item.source]||'Chamado por disparo'} · {formatDate(item.created_at)}</small></div><span className={'status '+item.status}>{labels[item.status]||item.status}</span></article>)}</div>:<Empty text="Nenhum contato no historico."/>}</section>}
function Metric({label,value}){return <article className="metric"><small>{label}</small><b>{value}</b></article>}
function Empty({text}){return <div className="empty"><p>{text}</p></div>}
function Modal({title,close,error,children}){return <div className="modal-wrap"><div className="modal"><button className="close" onClick={close}>x</button><p className="eyebrow">WHATSENTREGAVEL</p><h2>{title}</h2>{error&&<p className="form-error">{error}</p>}{children}</div></div>}
function ContactsHistoryWithDelete({leads,remove}){const formatDate=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'-';return <section className="table-card"><div className="table-head"><div><h2>Historico de contatos</h2><small>Pessoas que iniciaram conversa ou receberam um disparo.</small></div></div>{leads.length?<div className="lead-list">{leads.map(item=><article key={item.id} className="lead-row"><div className="avatar">{(item.name||'C')[0]}</div><div><b>{item.name||'Cliente WhatsApp'}</b><small>+{item.phone} - {contactSource(item)} - {formatDate(item.created_at)}</small></div><span className={'status '+item.status}>{labels[item.status]||item.status}</span><button className="link" onClick={()=>remove(item.id)}>Apagar</button></article>)}</div>:<Empty text="Nenhum contato no historico."/>}</section>}
