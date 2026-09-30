async function connectedConnection(db, { id, ownerId, provider }) {
  if (!id || !ownerId) return null;
  let query = db.from('connections')
    .select('*')
    .eq('id', id)
    .eq('owner_id', ownerId)
    .eq('status', 'connected');
  if (provider) query = query.eq('provider', provider);
  const { data } = await query.maybeSingle();
  return ['meta', 'uazapi'].includes(data?.provider) ? data : null;
}

// The account's selected site channel is authoritative for every site version.
// Old checkouts may still pass a previous connection id, so it only identifies
// the owner when the stable integration key is unavailable.
export async function resolveSiteDispatchConnection(db, { integrationKey, connectionId, ownerId } = {}) {
  let resolvedOwnerId = ownerId || null;
  let preferredConnectionId = connectionId || null;
  let integration = null;

  if (integrationKey) {
    const { data } = await db.from('site_integrations')
      .select('owner_id,connection_id')
      .eq('integration_key', integrationKey)
      .maybeSingle();
    integration = data;
    if (integration) resolvedOwnerId = integration.owner_id;
  }

  if (!resolvedOwnerId && preferredConnectionId) {
    const { data: preferred } = await db.from('connections')
      .select('owner_id')
      .eq('id', preferredConnectionId)
      .maybeSingle();
    resolvedOwnerId = preferred?.owner_id || null;
  }

  if (!resolvedOwnerId) return null;
  if (!integration) {
    const { data } = await db.from('site_integrations')
      .select('connection_id').eq('owner_id', resolvedOwnerId).maybeSingle();
    integration = data;
  }

  // Never silently switch to another number when the operator explicitly
  // selected one. A disconnected selection must be visible as unavailable.
  if (integration?.connection_id) {
    return connectedConnection(db, { id: integration.connection_id, ownerId: resolvedOwnerId });
  }

  // Legacy accounts without a selection keep their existing single-UazAPI
  // behavior until the operator chooses a channel in the panel.
  if (preferredConnectionId) {
    const preferredUaz = await connectedConnection(db, {
      id: preferredConnectionId, ownerId: resolvedOwnerId, provider: 'uazapi',
    });
    if (preferredUaz) return preferredUaz;
  }

  const { data: uazConnections } = await db.from('connections').select('*')
    .eq('owner_id', resolvedOwnerId)
    .eq('provider', 'uazapi')
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(2);
  if (uazConnections?.length === 1) return uazConnections[0];
  if ((uazConnections?.length || 0) > 1) return null;

  // Accounts without UazAPI continue using their sole connected Meta channel.
  if (preferredConnectionId) {
    const preferredMeta = await connectedConnection(db, {
      id: preferredConnectionId,
      ownerId: resolvedOwnerId,
      provider: 'meta',
    });
    if (preferredMeta) return preferredMeta;
  }
  const { data: metaConnections } = await db.from('connections').select('*')
    .eq('owner_id', resolvedOwnerId)
    .eq('provider', 'meta')
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(2);
  return metaConnections?.length === 1 ? metaConnections[0] : null;
}

// Flow configuration is normally attached to the WhatsApp connection. During
// number rotation, however, the active UazAPI can be newer than the connection
// that owns the site's existing flow configuration. In that case, reuse the
// newest same-owner config that actually contains the requested flow.
export async function resolveSiteFlowConfig(db, { ownerId, connectionId, flowField } = {}) {
  if (!ownerId || !flowField) return null;
  if (connectionId) {
    const { data } = await db.from('connection_flow_configs').select('*')
      .eq('connection_id', connectionId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    // Once this channel has its own configuration, an empty field means the
    // operator deliberately disabled that trigger. Do not revive an old flow.
    if (data) return data;
  }
  const { data: configs } = await db.from('connection_flow_configs').select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })
    .limit(50);
  return (configs || []).find((item) => item?.[flowField]) || null;
}

// Retain the old export for non-site code that intentionally requires Meta.
export async function resolveOfficialSiteConnection(db, options = {}) {
  let ownerId = options.ownerId || null;
  let connectionId = options.connectionId || null;
  if (options.integrationKey) {
    const { data: integration } = await db.from('site_integrations').select('owner_id,connection_id')
      .eq('integration_key', options.integrationKey).maybeSingle();
    if (integration) {
      ownerId = integration.owner_id;
      connectionId = integration.connection_id || connectionId;
    }
  }
  if (!ownerId && connectionId) {
    const { data } = await db.from('connections').select('owner_id').eq('id', connectionId).maybeSingle();
    ownerId = data?.owner_id || null;
  }
  if (!ownerId) return null;
  if (connectionId) {
    const selected = await connectedConnection(db, { id: connectionId, ownerId, provider: 'meta' });
    if (selected) return selected;
  }
  const { data: integration } = await db.from('site_integrations').select('connection_id').eq('owner_id', ownerId).maybeSingle();
  return connectedConnection(db, { id: integration?.connection_id, ownerId, provider: 'meta' });
}
