// Todos os checkouts apontam para os mesmos webhooks do Mini Fluxo. Manter a
// definição aqui evita que uma versão antiga do site use um idioma diferente
// do aprovado na Meta e deixe a entrega bloqueada antes da janela de 24h.
function template(nameVariable, fallbackName, languageVariable) {
  return {
    name: String(process.env[nameVariable] || fallbackName).trim() || fallbackName,
    // Os três modelos foram cadastrados como "English" na Meta, cujo código
    // efetivamente aprovado para este WABA é `en` (não `en_US`).
    language: String(process.env[languageVariable] || 'en').trim() || 'en',
  };
}

export function paymentTemplate() {
  return template('WHATSAPP_PAYMENT_TEMPLATE_NAME', 'flow', 'WHATSAPP_PAYMENT_TEMPLATE_LANGUAGE');
}

export function recoveryTemplate() {
  return template('WHATSAPP_RECOVERY_TEMPLATE_NAME', 'ajuste', 'WHATSAPP_RECOVERY_TEMPLATE_LANGUAGE');
}

export function remarketingTemplate() {
  return template('WHATSAPP_REMARKETING_TEMPLATE_NAME', 'remarketing', 'WHATSAPP_REMARKETING_TEMPLATE_LANGUAGE');
}
