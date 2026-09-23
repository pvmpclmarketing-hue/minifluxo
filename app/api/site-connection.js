// Resolve sempre o canal oficial atualmente escolhido para o site. Isso
// mantém versões antigas do checkout funcionando mesmo que ainda enviem o ID
// de uma instância UazAPI que já foi substituída.
export async function resolveOfficialSiteConnection(db,{integrationKey,connectionId}={}){
  let ownerId=null;
  if(integrationKey){
    const {data:integration}=await db.from('site_integrations').select('owner_id,connection_id').eq('integration_key',integrationKey).maybeSingle();
    if(integration){
      ownerId=integration.owner_id;
      if(integration.connection_id){
        const {data:connection}=await db.from('connections').select('*').eq('id',integration.connection_id).eq('owner_id',ownerId).eq('provider','meta').eq('status','connected').maybeSingle();
        if(connection)return connection;
      }
    }
  }
  // Fallback transitório para páginas antigas que ainda publicam
  // `connection_id`. Localizamos a conta dona do ID e usamos a integração
  // oficial ativa dela, nunca a instância antiga recebida pelo navegador.
  if(connectionId){
    const {data:legacy}=await db.from('connections').select('owner_id').eq('id',connectionId).maybeSingle();
    ownerId=ownerId||legacy?.owner_id||null;
  }
  if(!ownerId)return null;
  const {data:integration}=await db.from('site_integrations').select('connection_id').eq('owner_id',ownerId).maybeSingle();
  if(!integration?.connection_id)return null;
  const {data:connection}=await db.from('connections').select('*').eq('id',integration.connection_id).eq('owner_id',ownerId).eq('provider','meta').eq('status','connected').maybeSingle();
  return connection||null;
}
