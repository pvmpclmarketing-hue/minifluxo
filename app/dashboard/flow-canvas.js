'use client';
import { useCallback, useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, MarkerType, MiniMap, Position, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import styles from './flow-canvas.module.css';

const initialNodes = [
  { id:'entry', type:'flowNode', position:{x:40,y:190}, data:{tone:'violet', icon:'1', title:'Entrada', description:'Lead do site ou contato manual'} },
  { id:'pix', type:'flowNode', position:{x:330,y:190}, data:{tone:'blue', icon:'2', title:'Solicita Pix', description:'Mensagem enviada ao cliente'} },
  { id:'check', type:'flowNode', position:{x:625,y:190}, data:{tone:'orange', icon:'3', title:'Valida comprovante', description:'OpenAI confere o Pix'} },
  { id:'music', type:'flowNode', position:{x:920,y:190}, data:{tone:'pink', icon:'4', title:'Gera musica', description:'Kie.ai cria a entrega'} },
  { id:'deliver', type:'flowNode', position:{x:1215,y:190}, data:{tone:'green', icon:'5', title:'Entrega', description:'Audio enviado no WhatsApp'} }
];
const initialEdges = [['entry','pix'],['pix','check'],['check','music'],['music','deliver']].map(([source,target]) => ({ id:`${source}-${target}`, source, target, type:'smoothstep', animated:true, markerEnd:{type:MarkerType.ArrowClosed}, style:{stroke:'#8470d9',strokeWidth:2} }));

function FlowNode({ data }) { return <div className={`${styles.node} ${styles[data.tone]}`}><Handle type="target" position={Position.Left}/><div className={styles.nodeTop}><span>{data.icon}</span><em>ETAPA</em></div><b>{data.title}</b><small>{data.description}</small><Handle type="source" position={Position.Right}/></div>; }
const nodeTypes = { flowNode: FlowNode };

export default function FlowCanvas({ flow }) {
  const [ready, setReady] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const storageKey = `whatsentregavel-flow-layout-${flow.id}`;
  useEffect(() => { const saved=localStorage.getItem(storageKey); if(saved) { try { setNodes(JSON.parse(saved)); } catch {} } setReady(true); }, [setNodes, storageKey]);
  const onNodeDragStop = useCallback((_event, _node, currentNodes) => localStorage.setItem(storageKey, JSON.stringify(currentNodes)), [storageKey]);
  const reset = () => { setNodes(initialNodes); localStorage.removeItem(storageKey); };
  if (!ready) return <div className={styles.loading}>Carregando canvas...</div>;
  return <section className={styles.canvasCard}><div className={styles.header}><div><h2>{flow.name}</h2><p>{flow.description || 'Arraste os blocos para organizar sua visao. A sequencia operacional permanece protegida.'}</p></div><div><span className={styles.pill}>{flow.status === 'paused' ? 'PAUSADO' : 'ATIVO'}</span><button onClick={reset}>Restaurar visao</button></div></div><div className={styles.canvas}><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeDragStop={onNodeDragStop} nodeTypes={nodeTypes} nodesConnectable={false} fitView fitViewOptions={{padding:0.16}} minZoom={0.35} maxZoom={1.7} proOptions={{hideAttribution:true}}><Background gap={22} size={1} color="#37415a"/><MiniMap nodeColor={node => ({violet:'#8b5cf6',blue:'#54a8f5',orange:'#f0a94a',pink:'#ec6ba8',green:'#4bd59b'}[node.data.tone])} maskColor="rgba(7,10,18,.68)"/><Controls showInteractive={false}/></ReactFlow></div></section>;
}
