'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addEdge, Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import styles from './flow-canvas.module.css';

const blocks = {
  start: { label:'Entrada', icon:'1', tone:'violet', description:'Inicio do fluxo', config:{ trigger:'manual' } },
  message: { label:'Mensagem', icon:'M', tone:'blue', description:'Envia texto no WhatsApp', config:{ message:'Ola, recebi seu pedido. Envie o comprovante do Pix para continuar.', delay:0 } },
  wait: { label:'Aguarda resposta', icon:'W', tone:'orange', description:'Espera uma resposta', config:{ duration:1, unit:'dias', field:'comprovante', preMessage:'' } },
  ai: { label:'Bloco de IA', icon:'IA', tone:'green', description:'Analisa dados e comprovantes', config:{ model:'gpt-4.1-mini', prompt:'Analise a mensagem e confirme se o comprovante de Pix e valido.', saveTo:'pix.validado', autoSend:false, understandImage:true, understandPdf:true, identifyReceipt:true } },
  pix: { label:'Botao PIX', icon:'$', tone:'emerald', description:'Solicita pagamento via Pix', config:{ keyType:'CPF', key:'', recipient:'', amount:'' } },
  kie: { label:'Gerar musica', icon:'K', tone:'pink', description:'Envia pedido para Kie.ai', config:{ model:'Suno V5', prompt:'{briefing_musica}', style:'', instrumental:false, credential:'KIE_API_KEY' } },
  condition: { label:'Condicional', icon:'?', tone:'cyan', description:'Direciona conforme uma regra', config:{ field:'pix.validado', operator:'igual a', value:'true', match:'all' } },
  api: { label:'Chamar API', icon:'API', tone:'purple', description:'Envia dados a uma integracao', config:{ method:'POST', url:'', headers:'', body:'{}', saveTo:'api.response' } },
  notification: { label:'Notificacao', icon:'!', tone:'yellow', description:'Registra ou avisa a equipe', config:{ title:'Novo pedido', message:'Pedido em andamento' } },
  deliver: { label:'Entrega', icon:'OK', tone:'teal', description:'Envia a musica ao cliente', config:{ message:'Sua musica esta pronta: {kie.audio_url}' } }
};

const initialNodes = [
  ['entry','start',40,170], ['pix','message',320,170], ['check','ai',610,170], ['music','kie',900,170], ['deliver','deliver',1190,170]
].map(([id,kind,x,y]) => makeNode(kind,{x,y},id));
const initialEdges = [['entry','pix'],['pix','check'],['check','music'],['music','deliver']].map(([source,target]) => edge(source,target));

function edge(source,target) { return { id:`${source}-${target}-${Date.now()}`, source, target, type:'smoothstep', animated:true, markerEnd:{type:MarkerType.ArrowClosed}, style:{stroke:'#8470d9',strokeWidth:2} }; }
function makeNode(kind, position, id=`${kind}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`) {
  const block=blocks[kind] || blocks.message;
  return { id, type:'builderNode', position, data:{ kind, title:block.label, icon:block.icon, tone:block.tone, description:block.description, config:{...block.config} } };
}

function FlowNode({ data }) {
  return <div className={`${styles.node} ${styles[data.tone] || ''}`}>
    <Handle type="target" position={Position.Left}/>
    <div className={styles.nodeTop}>
      <span>{data.icon}</span><em>{data.kind === 'start' ? 'INICIO' : 'ETAPA'}</em>
      <div className={styles.actions}>
        <button className="nodrag" title="Editar" onClick={(e)=>{e.stopPropagation();data.onEdit?.();}}>Edit</button>
        <button className="nodrag" title="Clonar" onClick={(e)=>{e.stopPropagation();data.onClone?.();}}>Clone</button>
        <button className="nodrag" title="Excluir" onClick={(e)=>{e.stopPropagation();data.onDelete?.();}}>X</button>
      </div>
    </div>
    <b>{data.title}</b><small>{summary(data)}</small>
    <Handle type="source" position={Position.Right}/>
  </div>;
}
function summary(data) {
  const c=data.config || {};
  if(data.kind==='message' || data.kind==='deliver') return c.message || data.description;
  if(data.kind==='ai') return `Modelo: ${c.model || 'GPT'}${c.identifyReceipt ? ' | confere Pix' : ''}`;
  if(data.kind==='kie') return `Modelo: ${c.model || 'Suno'} | ${c.prompt || 'sem prompt'}`;
  if(data.kind==='wait') return `Espera ${c.duration || 1} ${c.unit || 'dias'} | salva: ${c.field || '-'}`;
  if(data.kind==='pix') return c.amount ? `Valor: R$ ${c.amount}` : 'Configure chave e valor';
  if(data.kind==='condition') return `${c.field || 'campo'} ${c.operator || '='} ${c.value || ''}`;
  if(data.kind==='api') return `${c.method || 'POST'} ${c.url || 'URL nao configurada'}`;
  return c.message || data.description;
}
const nodeTypes = { builderNode: FlowNode };

function Toggle({label, checked, onChange, hint}) { return <label className={styles.toggle}><span><b>{label}</b>{hint && <small>{hint}</small>}</span><input type="checkbox" checked={!!checked} onChange={e=>onChange(e.target.checked)}/><i/></label>; }
function Field({label, children}) { return <label className={styles.field}><b>{label}</b>{children}</label>; }

function ConfigModal({ node, onClose, onSave }) {
  const [config,setConfig]=useState(node.data.config || {}); const kind=node.data.kind;
  const set=(key,value)=>setConfig(old=>({...old,[key]:value}));
  const common = <div className={styles.modalFooter}><button className={styles.secondary} onClick={onClose}>Fechar</button><button className={styles.primary} onClick={()=>onSave(config)}>Salvar configuracao</button></div>;
  return <div className={styles.backdrop} onMouseDown={onClose}><section className={styles.modal} onMouseDown={e=>e.stopPropagation()}><header><span className={styles[node.data.tone]}>{node.data.icon}</span><div><h3>Editar {node.data.title}</h3><p>Configure esta etapa do fluxo.</p></div><button onClick={onClose}>X</button></header><div className={styles.modalBody}>
    {(kind==='message'||kind==='deliver') && <><Field label="Conteudo da mensagem"><textarea value={config.message||''} onChange={e=>set('message',e.target.value)} placeholder="Use variaveis como {nome} ou {kie.audio_url}"/></Field><Field label="Delay de digitacao (segundos)"><input type="number" min="0" value={config.delay||0} onChange={e=>set('delay',Number(e.target.value))}/></Field></>}
    {kind==='wait' && <><Toggle label="Aguardar indefinidamente" checked={config.indefinite} onChange={v=>set('indefinite',v)} hint="O fluxo so continua ao receber resposta."/><div className={styles.two}><Field label="Tempo"><input type="number" min="1" value={config.duration||1} onChange={e=>set('duration',Number(e.target.value))}/></Field><Field label="Unidade"><select value={config.unit||'dias'} onChange={e=>set('unit',e.target.value)}><option value="minutos">Minutos</option><option value="horas">Horas</option><option value="dias">Dias</option></select></Field></div><Field label="Campo para salvar a resposta"><input value={config.field||''} onChange={e=>set('field',e.target.value)} placeholder="comprovante"/></Field><Field label="Mensagem antes de aguardar"><textarea value={config.preMessage||''} onChange={e=>set('preMessage',e.target.value)}/></Field></>}
    {kind==='ai' && <><div className={styles.two}><Field label="Modelo"><select value={config.model||'gpt-4.1-mini'} onChange={e=>set('model',e.target.value)}><option>gpt-4.1-mini</option><option>gpt-4.1</option><option>gpt-5-mini</option></select></Field><Field label="Credencial"><select value={config.credential||'OPENAI_API_KEY'} onChange={e=>set('credential',e.target.value)}><option>OPENAI_API_KEY</option><option>Variavel personalizada</option></select></Field></div><Field label="Prompt / instrucao"><textarea value={config.prompt||''} onChange={e=>set('prompt',e.target.value)} placeholder="Explique o que a IA deve analisar"/></Field><Field label="Campo para salvar a resposta"><input value={config.saveTo||''} onChange={e=>set('saveTo',e.target.value)} placeholder="ai.response"/></Field><Toggle label="Enviar resposta automaticamente" checked={config.autoSend} onChange={v=>set('autoSend',v)}/><Toggle label="Entender imagem" checked={config.understandImage} onChange={v=>set('understandImage',v)} hint="Necessario para analisar comprovantes."/><Toggle label="Entender PDF" checked={config.understandPdf} onChange={v=>set('understandPdf',v)}/><Toggle label="Identificar comprovante Pix" checked={config.identifyReceipt} onChange={v=>set('identifyReceipt',v)} hint="Extrai dados do comprovante recebido."/></>}
    {kind==='kie' && <><p className={styles.note}>A chave fica protegida no servidor, usando a variavel <code>{config.credential||'KIE_API_KEY'}</code> da Vercel.</p><Field label="Modelo"><select value={config.model||'Suno V5'} onChange={e=>set('model',e.target.value)}><option>Suno V5</option><option>Suno V4.5</option></select></Field><Field label="Prompt da musica"><textarea value={config.prompt||''} onChange={e=>set('prompt',e.target.value)} placeholder="{briefing_musica}"/></Field><Field label="Estilo musical"><input value={config.style||''} onChange={e=>set('style',e.target.value)} placeholder="Ex.: sertanejo romantico"/></Field><Toggle label="Modo instrumental" checked={config.instrumental} onChange={v=>set('instrumental',v)}/></>}
    {kind==='pix' && <><Field label="Tipo da chave Pix"><select value={config.keyType||'CPF'} onChange={e=>set('keyType',e.target.value)}><option>CPF</option><option>CNPJ</option><option>E-mail</option><option>Telefone</option><option>Aleatoria</option></select></Field><Field label="Chave Pix"><input value={config.key||''} onChange={e=>set('key',e.target.value)}/></Field><Field label="Destinatario do pagamento"><input value={config.recipient||''} onChange={e=>set('recipient',e.target.value)} placeholder="Nome que aparecera ao cliente"/></Field><Field label="Valor (R$)"><input value={config.amount||''} onChange={e=>set('amount',e.target.value)} placeholder="49,90"/></Field></>}
    {kind==='condition' && <><Field label="Regra logica"><select value={config.match||'all'} onChange={e=>set('match',e.target.value)}><option value="all">Todas as condicoes (E)</option><option value="any">Qualquer condicao (OU)</option></select></Field><Field label="Campo / variavel"><input value={config.field||''} onChange={e=>set('field',e.target.value)} placeholder="pix.validado"/></Field><div className={styles.two}><Field label="Operador"><select value={config.operator||'igual a'} onChange={e=>set('operator',e.target.value)}><option>igual a</option><option>contem</option><option>existe</option><option>maior que</option></select></Field><Field label="Valor"><input value={config.value||''} onChange={e=>set('value',e.target.value)} placeholder="true"/></Field></div></>}
    {kind==='api' && <><div className={styles.two}><Field label="Metodo"><select value={config.method||'POST'} onChange={e=>set('method',e.target.value)}><option>POST</option><option>GET</option><option>PATCH</option></select></Field><Field label="Salvar resposta em"><input value={config.saveTo||''} onChange={e=>set('saveTo',e.target.value)} placeholder="api.response"/></Field></div><Field label="URL da API"><input value={config.url||''} onChange={e=>set('url',e.target.value)} placeholder="https://api.exemplo.com/eventos"/></Field><Field label="Headers (JSON)"><textarea value={config.headers||''} onChange={e=>set('headers',e.target.value)} placeholder='{"Authorization":"Bearer {token}"}'/></Field><Field label="Corpo / parametros (JSON)"><textarea value={config.body||''} onChange={e=>set('body',e.target.value)} placeholder='{"lead":"{phone}"}'/></Field></>}
    {kind==='notification' && <><Field label="Titulo"><input value={config.title||''} onChange={e=>set('title',e.target.value)}/></Field><Field label="Mensagem"><textarea value={config.message||''} onChange={e=>set('message',e.target.value)}/></Field></>}
    {kind==='start' && <Field label="Gatilho"><select value={config.trigger||'manual'} onChange={e=>set('trigger',e.target.value)}><option value="manual">Manual</option><option value="site">Pedido vindo do site</option><option value="payment">Pagamento aprovado</option></select></Field>}
  </div>{common}</section></div>;
}

export default function FlowCanvas({ flow }) {
  const savedNodes=Array.isArray(flow.nodes) && flow.nodes.length ? flow.nodes : initialNodes;
  const savedEdges=Array.isArray(flow.edges) && flow.edges.length ? flow.edges : initialEdges;
  const [nodes,setNodes,onNodesChange]=useNodesState(savedNodes);
  const [edges,setEdges,onEdgesChange]=useEdgesState(savedEdges);
  const [editing,setEditing]=useState(null); const [status,setStatus]=useState(''); const [paletteOpen,setPaletteOpen]=useState(true);
  useEffect(()=>{ setNodes(Array.isArray(flow.nodes)&&flow.nodes.length ? flow.nodes : initialNodes); setEdges(Array.isArray(flow.edges)&&flow.edges.length ? flow.edges : initialEdges); },[flow.id]);
  const removeNode=useCallback((id)=>{setNodes(ns=>ns.filter(n=>n.id!==id));setEdges(es=>es.filter(e=>e.source!==id&&e.target!==id));},[setEdges,setNodes]);
  const cloneNode=useCallback((id)=>setNodes(ns=>{const old=ns.find(n=>n.id===id);return old?[...ns,{...old,id:`${old.data.kind}-${Date.now()}`,position:{x:old.position.x+45,y:old.position.y+45},data:{...old.data,config:{...old.data.config}}}]:ns;}),[setNodes]);
  const runtimeNodes=useMemo(()=>nodes.map(node=>({...node,data:{...node.data,onEdit:()=>setEditing(node.id),onClone:()=>cloneNode(node.id),onDelete:()=>removeNode(node.id)}})),[nodes,cloneNode,removeNode]);
  const addBlock=(kind)=>setNodes(ns=>[...ns,makeNode(kind,{x:250+(ns.length%4)*70,y:80+(ns.length%5)*85})]);
  const onConnect=useCallback(params=>setEdges(es=>addEdge({...params,...edge(params.source,params.target)},es)),[setEdges]);
  const saveConfig=(config)=>{setNodes(ns=>ns.map(n=>n.id===editing?{...n,data:{...n.data,config}}:n));setEditing(null);};
  const save=async()=>{setStatus('Salvando...');try{const cleanNodes=nodes.map(({data,...node})=>({...node,data:{kind:data.kind,title:data.title,icon:data.icon,tone:data.tone,description:data.description,config:data.config}}));const res=await fetch(`/api/flows/${flow.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:cleanNodes,edges})});if(!res.ok)throw new Error();setStatus('Fluxo salvo');setTimeout(()=>setStatus(''),2500);}catch{setStatus('Nao foi possivel salvar');}};
  const active=editing ? runtimeNodes.find(n=>n.id===editing) : null;
  return <section className={styles.canvasCard}><div className={styles.header}><div><h2>{flow.name}</h2><p>{flow.description || 'Monte o fluxo arrastando, conectando e configurando os blocos.'}</p></div><div><span className={styles.pill}>{flow.status === 'paused' ? 'PAUSADO' : 'ATIVO'}</span>{status&&<small className={styles.status}>{status}</small>}<button onClick={()=>setPaletteOpen(v=>!v)}>{paletteOpen?'Ocultar funcoes':'Adicionar funcao'}</button><button className={styles.save} onClick={save}>Salvar fluxo</button></div></div><div className={styles.canvas}>
    {paletteOpen&&<aside className={styles.palette}><div><b>Funcoes</b><button onClick={()=>setPaletteOpen(false)}>X</button></div><p>Escolha uma funcao para adicionar ao canvas.</p>{Object.entries(blocks).filter(([kind])=>kind!=='start').map(([kind,block])=><button key={kind} onClick={()=>addBlock(kind)}><i className={styles[block.tone]}>{block.icon}</i><span><b>{block.label}</b><small>{block.description}</small></span><strong>+</strong></button>)}</aside>}
    <ReactFlow nodes={runtimeNodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:0.16}} minZoom={0.3} maxZoom={1.7} proOptions={{hideAttribution:true}}><Background gap={22} size={1} color="#37415a"/><MiniMap nodeColor={node=>({violet:'#8b5cf6',blue:'#54a8f5',orange:'#f0a94a',pink:'#ec6ba8',green:'#4bd59b',emerald:'#34d399',cyan:'#22c5de',purple:'#a78bfa',yellow:'#f7c948',teal:'#2dd4bf'}[node.data.tone]||'#888')} maskColor="rgba(7,10,18,.68)"/><Controls showInteractive={false}/></ReactFlow>
  </div>{active&&<ConfigModal node={active} onClose={()=>setEditing(null)} onSave={saveConfig}/>}</section>;
}
