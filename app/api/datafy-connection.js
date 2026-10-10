// A conexão só é considerada ativa depois que a própria Datafy confirma
// que o token pertence ao número configurado e que esse número está conectado.
export async function inspectDatafyConnection() {
  const token = String(process.env.DATAFY_API_TOKEN || '').trim();
  const phoneNumberId = String(process.env.DATAFY_PHONE_NUMBER_ID || '').trim();
  const baseUrl = String(process.env.DATAFY_API_BASE_URL || 'https://cloud.datafyapi.com.br/v1').replace(/\/+$/, '');
  if (!token || !phoneNumberId) return { connected: false, reason: 'missing_configuration' };

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const requestOptions = { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) };
  const accountResponse = await fetch(new URL('/me', baseUrl), requestOptions);
  if (!accountResponse.ok) return { connected: false, reason: `account_http_${accountResponse.status}` };
  const accountPayload = await accountResponse.json();
  const account = accountPayload?.data || accountPayload;
  if (String(account?.phone_number_id || '') !== phoneNumberId) {
    return { connected: false, reason: 'phone_number_id_mismatch' };
  }
  const wabaId = String(account?.waba_id || '').trim();
  if (!wabaId) return { connected: false, reason: 'waba_id_missing' };

  const numbersResponse = await fetch(`${baseUrl}/${encodeURIComponent(wabaId)}/phone_numbers`, requestOptions);
  if (!numbersResponse.ok) return { connected: false, reason: `phone_numbers_http_${numbersResponse.status}` };
  const numbersPayload = await numbersResponse.json();
  const numbers = Array.isArray(numbersPayload?.data) ? numbersPayload.data : [];
  const number = numbers.find((item) => String(item?.id || '') === phoneNumberId);
  if (!number) return { connected: false, reason: 'phone_number_not_found' };
  const phoneSuffix = String(number.display_phone_number || '').replace(/\D/g, '').slice(-4);
  if (String(number.status || '').toUpperCase() !== 'CONNECTED') {
    return { connected: false, reason: 'phone_number_not_connected', phoneSuffix };
  }
  return { connected: true, displayPhone: String(number.display_phone_number || '').trim() };
}
