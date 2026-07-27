const leads = document.querySelector('#leads');
const status = { WAITING_PIX:'Aguardando Pix', WAITING_BRIEFING:'Aguardando briefing', GENERATING:'Gerando música', COMPLETED:'Concluído' };
async function loadLeads(){ const items=await (await fetch('/api/leads')).json(); leads.innerHTML=items.length?items.map(x=>`<article class="lead"><div><b>${x.name}</b><small>${x.phone} · ${x.source}</small></div><span class="state ${x.status}">${status[x.status]||x.status}</span></article>`).join(''):'<p class="empty">Nenhum atendimento ainda.</p>'; }
document.querySelector('#reload').onclick=loadLeads;
document.querySelector('#lead-form').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(f))});document.querySelector('#feedback').textContent=r.ok?'Mensagem inicial enviada.':(await r.json()).error;if(r.ok){e.target.reset();loadLeads();}};
loadLeads();
