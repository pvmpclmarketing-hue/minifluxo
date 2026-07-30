'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addEdge, Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import styles from './flow-canvas.module.css';

const blocks = {
  start: { label:'Entrada', icon:'1', tone:'violet', description:'Inicio do fluxo', config:{ trigger:'manual' } },
  message: { label:'Mensagem', icon:'M', tone:'blue', description:'Envia texto no WhatsApp', config:{ message:'Ola, recebi seu pedido. Envie o comprovante do Pix para continuar.' } },
  wait: { label:'Aguardar resposta', icon:'W', tone:'orange', description:'So continua quando o cliente responder', config:{ field:'comprovante', preMessage:'' } },
  delay: { label:'Delay estrategico', icon:'T', tone:'orange', description:'Espera um tempo e segue automaticamente', config:{ duration:5, unit:'minutos' } },
  ai: { label:'Bloco de IA', icon:'IA', tone:'green', description:'Analisa dados e comprovantes', config:{ model:'gpt-4.1-mini', prompt:'Responda ao cliente com clareza e cordialidade.', saveTo:'ai.response', autoSend:true, understandImage:true, understandPdf:true, identifyReceipt:true } },
  kie: { label:'Gerar musica', icon:'K', tone:'pink', description:'Envia pedido para Kie.ai', config:{ model:'Suno V5', style:'', instrumental:false, credential:'Chave do fluxo' } },
  condition: { label:'Condicional', icon:'?', tone:'cyan', description:'Direciona conforme uma regra', config:{ field:'pix.validado', operator:'igual a', value:'true', match:'all' } },
  deliver: { label:'Entrega gerada', icon:'OK', tone:'teal', description:'Envia as 2 musicas geradas no fluxo', config:{ intro:'Sua musica esta pronta! Vou enviar as duas faixas em audio.', tracks:2 } },
  previewDeliver: { label:'Enviar musica da previa', icon:'PV', tone:'teal', description:'Entrega a musica que o cliente ouviu no site', config:{ intro:'Sua musica esta pronta! Vou enviar as duas faixas da sua previa em audio.', tracks:2 } }
};

const initialNodes = [
  ['entry','start',40,170], ['message','message',320,170], ['check','ai',610,170], ['music','kie',900,170], ['deliver','deliver',1190,170]
].map(([id,kind,x,y]) => makeNode(kind,{x,y},id));
const initialEdges = [['entry','message'],['message','check'],['check','music'],['music','deliver']].map(([source,target]) => edge(source,target));

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
    {data.kind==='condition'?<><label className={`${styles.branch} ${styles.branchYes}`}>SIM</label><Handle id="true" type="source" position={Position.Right} style={{top:'42%'}}/><label className={`${styles.branch} ${styles.branchNo}`}>NAO</label><Handle id="false" type="source" position={Position.Right} style={{top:'72%'}}/></>:<Handle type="source" position={Position.Right}/>}
  </div>;
}
function summary(data) {
  const c=data.config || {};
  if(data.kind==='message') return c.message || data.description;
  if(data.kind==='deliver') return `Entrega ${c.tracks || 2} faixas MP3 como audio`;
  if(data.kind==='previewDeliver') return 'Envia as duas faixas da previa do site';
  if(data.kind==='ai') return `Modelo: ${c.model || 'GPT'}${c.identifyReceipt ? ' | confere Pix' : ''}`;
  if(data.kind==='kie') return `Modelo: ${c.model || 'Suno'} | briefing do site`;
  if(data.kind==='wait') return `Espera resposta | salva: ${c.field || '-'}`;
  if(data.kind==='delay') return `Segue apos ${c.duration || 5} ${c.unit || 'minutos'}`;
  if(data.kind==='condition') return `${c.field || 'campo'} ${c.operator || '='} ${c.value || ''}`;
  return c.message || data.description;
}
const nodeTypes = { builderNode: FlowNode };

function Toggle({label, checked, onChange, hint}) { return <label className={styles.toggle}><span><b>{label}</b>{hint && <small>{hint}</small>}</span><input type="checkbox" checked={!!checked} onChange={e=>onChange(e.target.checked)}/><i/></label>; }
function Field({label, children}) { return <label className={styles.field}><b>{label}</b>{children}</label>; }

function ConfigModal({ node, credentials, onClose, onSave }) {
  const [config,setConfig]=useState(node.data.config || {}); const [apiKey,setApiKey]=useState(''); const kind=node.data.kind;
  const set=(key,value)=>setConfig(old=>({...old,[key]:value}));
  return <div className={styles.backdrop} onMouseDown={onClose}><section className={styles.modal} onMouseDown={e=>e.stopPropagation()}><header><span className={styles[node.data.tone]}>{node.data.icon}</span><div><h3>Editar {node.data.title}</h3><p>Configure esta etapa do fluxo.</p></div><button onClick={onClose}>X</button></header><div className={styles.modalBody}>
    {kind==='message' && <Field label="Conteudo da mensagem"><textarea value={config.message||''} onChange={e=>set('message',e.target.value)} placeholder="Use variaveis como {nome} ou {kie.audio_url}"/></Field>}
    {kind==='deliver' && <><p className={styles.note}>A Kie.ai gera duas faixas. Esta etapa envia cada arquivo MP3 separadamente no formato <b>audio</b> do WhatsApp, e nao como documento.</p><Field label="Mensagem antes dos audios"><textarea value={config.intro||''} onChange={e=>set('intro',e.target.value)} placeholder="Sua musica esta pronta!"/></Field><Field label="Quantidade de faixas"><input value="2 faixas (fixo - retorno da Kie.ai)" disabled/></Field></>}
    {kind==='previewDeliver' && <><p className={styles.note}>Este bloco nao gera musica. Ele entrega exatamente as duas faixas que o cliente ouviu na previa do site, recebidas no webhook de pagamento em <code>preview.audios</code>.</p><Field label="Mensagem antes dos audios"><textarea value={config.intro||''} onChange={e=>set('intro',e.target.value)} placeholder="Sua musica esta pronta!"/></Field><Field label="Quantidade de faixas"><input value="2 faixas da previa (fixo)" disabled/></Field></>}
    {kind==='wait' && <><p className={styles.note}>O fluxo fica parado nesta etapa e so segue quando o cliente enviar uma nova resposta pelo WhatsApp.</p><Field label="Campo para salvar a resposta"><input value={config.field||''} onChange={e=>set('field',e.target.value)} placeholder="comprovante"/></Field><Field label="Mensagem antes de aguardar"><textarea value={config.preMessage||''} onChange={e=>set('preMessage',e.target.value)}/></Field></>}
    {kind==='delay' && <><p className={styles.note}>O fluxo prossegue sozinho depois do período escolhido. A execução pode ocorrer com até cerca de 1 minuto adicional.</p><div className={styles.two}><Field label="Tempo"><input type="number" min="1" value={config.duration||5} onChange={e=>set('duration',Number(e.target.value))}/></Field><Field label="Unidade"><select value={config.unit||'minutos'} onChange={e=>set('unit',e.target.value)}><option value="minutos">Minutos</option><option value="horas">Horas</option><option value="dias">Dias</option></select></Field></div></>}
    {kind==='ai' && <><div className={styles.two}><Field label="Modelo"><select value={config.model||'gpt-4.1-mini'} onChange={e=>set('model',e.target.value)}><option>gpt-4.1-mini</option><option>gpt-4.1</option><option>gpt-5-mini</option></select></Field><Field label="Credencial"><select value={config.credential||'Chave do fluxo'} onChange={e=>set('credential',e.target.value)}><option>Chave do fluxo</option><option>OPENAI_API_KEY global</option></select></Field></div><Field label={`Chave API GPT ${credentials.gptConfigured ? '(ja cadastrada - digite somente para trocar)' : ''}`}><input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={credentials.gptConfigured?'Nova chave opcional':'sk-...'} autoComplete="new-password"/></Field><p className={styles.note}>A chave e enviada criptografada para o servidor e nao aparece novamente no canvas.</p><Field label="Prompt / instrucao"><textarea value={config.prompt||''} onChange={e=>set('prompt',e.target.value)} placeholder="Explique o que a IA deve analisar"/></Field><Field label="Campo para salvar a resposta"><input value={config.saveTo||''} onChange={e=>set('saveTo',e.target.value)} placeholder="ai.response"/></Field><Toggle label="Enviar resposta automaticamente" checked={config.autoSend} onChange={v=>set('autoSend',v)}/><Toggle label="Entender imagem" checked={config.understandImage} onChange={v=>set('understandImage',v)} hint="Necessario para analisar comprovantes."/><Toggle label="Entender PDF" checked={config.understandPdf} onChange={v=>set('understandPdf',v)}/><Toggle label="Identificar comprovante Pix" checked={config.identifyReceipt} onChange={v=>set('identifyReceipt',v)} hint="Extrai dados do comprovante recebido."/></>}
    {kind==='kie' && <><Field label={`Chave API Kie.ai ${credentials.kieConfigured ? '(ja cadastrada - digite somente para trocar)' : ''}`}><input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={credentials.kieConfigured?'Nova chave opcional':'Cole sua chave da Kie.ai'} autoComplete="new-password"/></Field><p className={styles.note}>A chave e protegida no servidor. O prompt desta etapa e padrao: o sistema usa automaticamente o briefing recebido pelo site, por exemplo <code>{'{briefing_musica}'}</code>.</p><Field label="Modelo"><select value={config.model||'Suno V5'} onChange={e=>set('model',e.target.value)}><option>Suno V5</option><option>Suno V4.5</option></select></Field><Field label="Estilo padrao (opcional)"><input value={config.style||''} onChange={e=>set('style',e.target.value)} placeholder="Ex.: sertanejo romantico"/></Field><Toggle label="Modo instrumental" checked={config.instrumental} onChange={v=>set('instrumental',v)}/></>}
    {kind==='condition' && <><Field label="Regra logica"><select value={config.match||'all'} onChange={e=>set('match',e.target.value)}><option value="all">Todas as condicoes (E)</option><option value="any">Qualquer condicao (OU)</option></select></Field><Field label="Campo / variavel"><input value={config.field||''} onChange={e=>set('field',e.target.value)} placeholder="pix.validado"/></Field><div className={styles.two}><Field label="Operador"><select value={config.operator||'igual a'} onChange={e=>set('operator',e.target.value)}><option>igual a</option><option>contem</option><option>existe</option><option>maior que</option></select></Field><Field label="Valor"><input value={config.value||''} onChange={e=>set('value',e.target.value)} placeholder="true"/></Field></div></>}
    {kind==='start' && <Field label="Gatilho"><select value={config.trigger||'manual'} onChange={e=>set('trigger',e.target.value)}><option value="manual">Manual</option><option value="site">Pedido vindo do site</option><option value="payment">Pagamento aprovado</option></select></Field>}
  </div><div className={styles.modalFooter}><button className={styles.secondary} onClick={onClose}>Fechar</button><button className={styles.primary} onClick={()=>onSave(config,kind==='ai'?{gptKey:apiKey}:kind==='kie'?{kieKey:apiKey}:{})}>Salvar configuracao</button></div></section></div>;
}

export default function FlowCanvas({ flow }) {
  const savedNodes=Array.isArray(flow.nodes) && flow.nodes.length ? flow.nodes : initialNodes;
  const savedEdges=Array.isArray(flow.edges) && flow.edges.length ? flow.edges : initialEdges;
  const [nodes,setNodes,onNodesChange]=useNodesState(savedNodes);
  const [edges,setEdges,onEdgesChange]=useEdgesState(savedEdges);
  const [editing,setEditing]=useState(null); const [status,setStatus]=useState(''); const [paletteOpen,setPaletteOpen]=useState(true); const [credentials,setCredentials]=useState({gptConfigured:false,kieConfigured:false});
  useEffect(()=>{ setNodes(Array.isArray(flow.nodes)&&flow.nodes.length ? flow.nodes : initialNodes); setEdges(Array.isArray(flow.edges)&&flow.edges.length ? flow.edges : initialEdges); },[flow.id]);
  useEffect(()=>{fetch(`/api/flows/${flow.id}/credentials`).then(res=>res.ok?res.json():null).then(data=>data&&setCredentials(data)).catch(()=>{});},[flow.id]);
  const removeNode=useCallback((id)=>{setNodes(ns=>ns.filter(n=>n.id!==id));setEdges(es=>es.filter(e=>e.source!==id&&e.target!==id));},[setEdges,setNodes]);
  const cloneNode=useCallback((id)=>setNodes(ns=>{const old=ns.find(n=>n.id===id);return old?[...ns,{...old,id:`${old.data.kind}-${Date.now()}`,position:{x:old.position.x+45,y:old.position.y+45},data:{...old.data,config:{...old.data.config}}}]:ns;}),[setNodes]);
  const runtimeNodes=useMemo(()=>nodes.map(node=>({...node,data:{...node.data,onEdit:()=>setEditing(node.id),onClone:()=>cloneNode(node.id),onDelete:()=>removeNode(node.id)}})),[nodes,cloneNode,removeNode]);
  const addBlock=(kind)=>setNodes(ns=>[...ns,makeNode(kind,{x:250+(ns.length%4)*70,y:80+(ns.length%5)*85})]);
  const onConnect=useCallback(params=>setEdges(es=>addEdge({...params,...edge(params.source,params.target)},es)),[setEdges]);
  const saveConfig=async(config,secrets)=>{setNodes(ns=>ns.map(n=>n.id===editing?{...n,data:{...n.data,config}}:n));setEditing(null);if(secrets.gptKey||secrets.kieKey){setStatus('Protegendo chave...');try{const res=await fetch(`/api/flows/${flow.id}/credentials`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(secrets)});if(!res.ok)throw new Error();setCredentials(old=>({...old,gptConfigured:old.gptConfigured||!!secrets.gptKey,kieConfigured:old.kieConfigured||!!secrets.kieKey}));setStatus('Chave protegida e salva');setTimeout(()=>setStatus(''),2500);}catch{setStatus('Nao foi possivel salvar a chave');}}};
  const save=async()=>{setStatus('Salvando...');try{const cleanNodes=nodes.map(({data,...node})=>({...node,data:{kind:data.kind,title:data.title,icon:data.icon,tone:data.tone,description:data.description,config:data.config}}));const res=await fetch(`/api/flows/${flow.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:cleanNodes,edges})});if(!res.ok)throw new Error();setStatus('Fluxo salvo');setTimeout(()=>setStatus(''),2500);}catch{setStatus('Nao foi possivel salvar');}};
  const copyShareCode=async()=>{if(!flow.share_code)return setStatus('Código disponível após executar a atualização do Supabase.');try{await navigator.clipboard.writeText(flow.share_code);setStatus('Código do fluxo copiado');setTimeout(()=>setStatus(''),2500);}catch{setStatus(`Código: ${flow.share_code}`);}};
  const active=editing ? runtimeNodes.find(n=>n.id===editing) : null;
  return <section className={styles.canvasCard}><div className={styles.header}><div><h2>{flow.name}</h2><p>{flow.description || 'Monte o fluxo arrastando, conectando e configurando os blocos.'}</p></div><div><span className={styles.pill}>{flow.status === 'paused' ? 'PAUSADO' : 'ATIVO'}</span>{status&&<small className={styles.status}>{status}</small>}<button onClick={copyShareCode}>{flow.share_code?'Copiar código':'Código indisponível'}</button><button onClick={()=>setPaletteOpen(v=>!v)}>{paletteOpen?'Ocultar funcoes':'Adicionar funcao'}</button><button className={styles.save} onClick={save}>Salvar fluxo</button></div></div><div className={styles.canvas}>
    {paletteOpen&&<aside className={styles.palette}><div><b>Funcoes</b><button onClick={()=>setPaletteOpen(false)}>X</button></div><p>Escolha uma funcao para adicionar ao canvas.</p>{Object.entries(blocks).filter(([kind])=>kind!=='start').map(([kind,block])=><button key={kind} onClick={()=>addBlock(kind)}><i className={styles[block.tone]}>{block.icon}</i><span><b>{block.label}</b><small>{block.description}</small></span><strong>+</strong></button>)}</aside>}
    <ReactFlow nodes={runtimeNodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:0.16}} minZoom={0.3} maxZoom={1.7} proOptions={{hideAttribution:true}}><Background gap={22} size={1} color="#37415a"/><MiniMap nodeColor={node=>({violet:'#8b5cf6',blue:'#54a8f5',orange:'#f0a94a',pink:'#ec6ba8',green:'#4bd59b',emerald:'#34d399',cyan:'#22c5de',purple:'#a78bfa',yellow:'#f7c948',teal:'#2dd4bf'}[node.data.tone]||'#888')} maskColor="rgba(7,10,18,.68)"/><Controls showInteractive={false}/></ReactFlow>
  </div>{active&&<ConfigModal node={active} credentials={credentials} onClose={()=>setEditing(null)} onSave={saveConfig}/>}</section>;
}
