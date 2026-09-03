# Efí Pix + Oracle Cloud + WhatsEntregavel

Documento operacional do pagamento Pix da Efí no WhatsEntregavel. Atualizado em 03/09/2026.

> Segurança: este arquivo **não contém** Client ID, Client Secret, chave Pix, certificado P12, senha do certificado, segredo do relay, token da Vercel ou chave SSH privada. Esses valores não devem ser enviados pelo WhatsApp, e-mail ou commitados no Git.

## Objetivo

Permitir que um card **Gerar Pix copia e cola** crie uma cobrança na Efí e que, quando o Pix for pago, o fluxo do WhatsApp continue automaticamente no card seguinte.

O webhook da Efí exige mTLS. Por esse motivo, a Efí não chama a Vercel diretamente: ela chama um relay HTTPS na Oracle Cloud, que valida o certificado de cliente da Efí e encaminha o evento já validado para o WhatsEntregavel.

## Arquitetura ativa

```text
Cliente no WhatsApp
        │
        ▼
Card "Gerar Pix copia e cola"
        │  OAuth mTLS + PUT /v2/cob/{txid}
        ▼
API Pix Efí
        │  POST mTLS /efi
        ▼
Oracle Cloud: Nginx :443
        │  valida certificado cliente Efí
        ▼
Relay Node local :3001
        │  X-Efi-Relay-Secret
        ▼
Vercel: /api/webhooks/efi
        │
        ▼
Supabase: efi_pix_charges + leads
        │
        ▼
Próximo card do fluxo / envio pelo WhatsApp
```

## Componentes e arquivos do projeto

| Componente | Função | Arquivo |
| --- | --- | --- |
| Card Pix | Cria cobrança, salva o `txid` e envia o copia e cola | `app/api/flow-engine.js` |
| Cadastro de credenciais | Salva as credenciais Efí criptografadas por conta | `app/api/account-credentials/route.js` |
| Ativação do webhook | Registra a URL da Oracle na API da Efí | `app/api/efi-webhook/route.js` |
| Recebimento final | Valida o relay, marca o Pix como pago e continua o fluxo | `app/api/webhooks/efi/route.js` |
| Proxy mTLS | Recebe a Efí por HTTPS e exige certificado cliente | `oracle/efi-relay/nginx.conf` |
| Relay local | Repassa o JSON validado à Vercel | `oracle/efi-relay/relay.js` |
| Instruções locais do relay | Variáveis do serviço Oracle | `oracle/efi-relay/README.md` |

## Oracle Cloud

### Papel da VM

A VM Oracle não cria Pix, não guarda os dados dos clientes e não conversa com a UazAPI. Ela serve exclusivamente como ponte mTLS para a Efí.

O Nginx expõe somente:

- `22/tcp`: SSH administrativo;
- `80/tcp`: desafio/redirect HTTP para HTTPS;
- `443/tcp`: endpoint público do webhook Efí.

O processo Node do relay escuta somente em `127.0.0.1:3001`; ele não fica acessível diretamente pela internet.

### Nginx e mTLS

O arquivo `oracle/efi-relay/nginx.conf` configura:

- certificado TLS público do domínio do relay, emitido pelo Let's Encrypt;
- cadeia pública de certificados da Efí em `/etc/nginx/efi/certificate-chain.crt`;
- `ssl_verify_client on`, ou seja, apenas a Efí com certificado válido consegue chamar o endpoint;
- aceitação apenas das rotas `/efi` e `/efi/pix`;
- encaminhamento interno para `http://127.0.0.1:3001`.

### Relay Node

O arquivo `oracle/efi-relay/relay.js`:

1. aceita somente `POST /efi` ou `POST /efi/pix`;
2. limita o corpo do pedido a 1 MB;
3. encaminha o JSON para a Vercel;
4. acrescenta o cabeçalho privado `X-Efi-Relay-Secret`;
5. retorna para a Efí o status da Vercel;
6. encerra a tentativa em caso de erro ou timeout de 15 segundos.

Variáveis necessárias no serviço da VM:

```env
MINIFLUX_EFI_WEBHOOK_URL=https://minifluxo.vercel.app/api/webhooks/efi
EFI_WEBHOOK_RELAY_SECRET=<segredo longo, igual ao cadastrado na Vercel>
PORT=3001
```

### Acesso administrativo preservado

O acesso SSH é por chave, nunca por senha:

```text
Chave privada: C:\Users\T-GAMER\.ssh\whatsentregavel-efi-oracle
Chave pública: C:\Users\T-GAMER\.ssh\whatsentregavel-efi-oracle.pub
Fingerprint: SHA256:CJf3ACVZAwkA282ecL4MpR4aG3hZwtsSOJA/sS+itg8
```

Não copie a chave privada para o repositório nem para esta documentação.

## Vercel

As variáveis globais necessárias para a parte de webhook são:

```env
EFI_WEBHOOK_RELAY_URL=https://<dominio-publico-da-oracle>
EFI_WEBHOOK_RELAY_SECRET=<mesmo valor usado no relay da Oracle>
```

`EFI_WEBHOOK_RELAY_URL` deve ser a base HTTPS, sem `/efi` no final. O código acrescenta `/efi` automaticamente quando registra o webhook na Efí.

Depois de mudar uma variável da Vercel, faça um novo deploy de produção.

## Credenciais cadastradas no painel

Cada conta do WhatsEntregavel cadastra na aba **APIs**:

- Client ID da Efí;
- Client Secret da Efí;
- certificado `.p12` da Efí;
- senha do certificado, quando existir;
- chave Pix que receberá a cobrança;
- ambiente: `production` ou `homologation`.

Esses valores são criptografados antes de serem salvos na tabela `account_credentials`. O frontend recebe apenas indicadores como “configurada”; ele não recebe as chaves de volta.

## Geração da cobrança

Ao chegar no card **Gerar Pix copia e cola**, o motor do fluxo:

1. obtém token OAuth da Efí usando o certificado P12 via mTLS;
2. cria ou reutiliza a cobrança `PUT /v2/cob/{txid}`;
3. gera um `txid` determinístico por lead e card, evitando cobranças duplicadas;
4. registra a cobrança pendente em `efi_pix_charges`;
5. salva no contexto do lead o código copia e cola, valor, `txid` e expiração;
6. envia ao cliente o código Pix pelo WhatsApp;
7. deixa o lead em `waiting_pix` até o pagamento.

Na UazAPI, o código é enviado com ação de copiar. Em provedores sem suporte a esse recurso, o texto continua disponível como alternativa.

## Registro e ativação do webhook na Efí

No painel, na área de APIs/webhook Efí, o botão **Ativar webhook Efí** chama:

```text
POST /api/efi-webhook
```

O WhatsEntregavel autentica na Efí e registra:

```text
PUT /v2/webhook/{CHAVE_PIX}
{ "webhookUrl": "https://<dominio-oracle>/efi" }
```

Essa ativação deve ser refeita quando houver troca de:

- chave Pix;
- ambiente Efí;
- domínio/IP do relay Oracle;
- certificado ou infraestrutura do relay.

## Recebimento do pagamento

A Efí chama a Oracle com mTLS. O relay encaminha à Vercel:

```text
POST /api/webhooks/efi
X-Efi-Relay-Secret: <segredo privado>
Content-Type: application/json
```

O endpoint da Vercel:

1. compara o segredo com proteção contra comparação por tempo;
2. aceita eventos no formato `{ "pix": [...] }` ou um pagamento individual com `txid`;
3. procura apenas cobrança pendente com aquele `txid`;
4. altera a cobrança para `paid` de forma idempotente;
5. registra data e payload do pagamento;
6. marca o lead como pago;
7. executa o fluxo a partir do card que gerou a cobrança.

Se a Efí repetir uma notificação, a cobrança já não estará como `pending`; portanto, o fluxo não é executado duas vezes.

## Fluxo recomendado no canvas

```text
... → Menu (cliente escolhe Sim) → Mensagem Pix → Gerar Pix copia e cola
    → Pagamento confirmado → próximo card
```

O card **Pagamento confirmado** pausa a conversa até que o webhook da Efí confirme a cobrança correspondente. Não use um delay no lugar dele quando a intenção for aguardar pagamento.

## Banco de dados

### `account_credentials`

Guarda por usuário as credenciais cifradas da Efí, GPT e Kie. Nenhuma chave deve aparecer nas tabelas de interface ou em logs.

### `efi_pix_charges`

Guarda cada cobrança criada:

- `txid` único;
- dono da conta, lead, conexão, fluxo e card de origem;
- valor e expiração;
- status `pending` ou `paid`;
- data do pagamento e payload recebido.

### `leads`

Guarda o contexto de execução do cliente, incluindo `paid`, estado do fluxo, dados da cobrança e a posição em que o fluxo deve continuar.

## Teste seguro de ponta a ponta

1. Confirme que o WhatsApp da conta está conectado.
2. Na aba APIs, confira se as credenciais Efí estão completas e no ambiente desejado.
3. Ative o webhook Efí pelo painel; deve retornar sucesso.
4. Crie um fluxo de teste com `Gerar Pix copia e cola → Pagamento confirmado → Mensagem`.
5. Inicie o fluxo para um número válido no WhatsApp.
6. Copie o código Pix e pague em ambiente compatível com as credenciais configuradas.
7. Confirme que a cobrança ficou `paid`, o lead saiu de `waiting_pix` e a mensagem após o card de confirmação chegou.

## Diagnóstico e resolução de problemas

| Sintoma | Causa provável | Verificação / ação |
| --- | --- | --- |
| `mac verify failure` | Senha do P12 incorreta ou certificado incompatível | Reenvie o P12 e informe a senha correta; se não houver senha, deixe o campo vazio. |
| `A Efi demorou demais para responder` | Falha de rede/TLS entre Vercel e Efí | Confira ambiente, P12 e credenciais; a requisição tem timeout de 45 s. |
| `ECONNRESET` ao ativar webhook | Relay não aceitou/encaminhou a conexão | Confira Nginx, cadeia Efí, serviço Node, portas 80/443 e domínio do relay. |
| Webhook retorna 401 | Segredo da Oracle diferente do da Vercel | Atualize `EFI_WEBHOOK_RELAY_SECRET` nos dois lados com o mesmo valor e faça deploy na Vercel. |
| Pix gerado, mas fluxo não continua | Evento não chegou ou cobrança não corresponde | Verifique `efi_pix_charges` pelo `txid`, logs do relay e `/api/webhooks/efi`. |
| Cliente não recebe o Pix ou a música | Número não existe no WhatsApp | A UazAPI recusa o envio; valide o telefone antes de iniciar o pedido. |
| Evento repetido | Reenvio normal da Efí | O processamento é idempotente; a segunda chamada é ignorada. |

## Observações importantes

- O documento antigo `docs/ORACLE_EFI_RELAY_REBUILD.md` descreve uma tentativa anterior com Caddy. A implementação versionada atual é **Nginx + relay Node**, descrita neste arquivo.
- A Oracle deve permanecer restrita ao papel de relay. Não salve nela credenciais individuais dos usuários do WhatsEntregavel.
- O endpoint da Vercel não deve aceitar requisições externas sem o cabeçalho secreto do relay.
- Mudar credenciais na Efí não atualiza automaticamente o painel: é necessário cadastrar as novas credenciais na aba APIs e reativar o webhook.
