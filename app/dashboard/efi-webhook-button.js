'use client';

import { useState } from 'react';

export default function EfiWebhookButton() {
  const [state, setState] = useState('');
  async function activate() {
    setState('Ativando o webhook mTLS da Efi...');
    try {
      const response = await fetch('/api/efi-webhook', { method: 'POST' });
      const data = await response.json();
      setState(response.ok ? `Webhook Efi ativo: ${data.webhookUrl}` : (data.error || 'Não foi possível ativar o webhook.'));
    } catch (error) {
      setState(error.message || 'Não foi possível ativar o webhook.');
    }
  }
  return <section className="api-page"><article className="api-provider"><div className="api-provider-icon efi">✓</div><div><h3>Webhook de pagamento Efi</h3><p>Depois de cadastrar as credenciais, ative uma vez. A Efi avisará o fluxo automaticamente assim que cada Pix for pago.</p><small>O relay na Oracle valida o certificado mTLS da Efi; nenhum pagamento é aceito diretamente pelo navegador.</small></div><button type="button" className="primary" onClick={activate}>Ativar webhook Efi</button></article>{state&&<p className="api-notice">{state}</p>}</section>;
}
