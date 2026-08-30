-- Credenciais privadas da Efi para o bloco "Gerar PIX copia e cola".
-- Todos os valores abaixo são cifrados no backend antes de serem salvos.
alter table public.account_credentials
  add column if not exists efi_client_id_cipher text,
  add column if not exists efi_client_secret_cipher text,
  add column if not exists efi_certificate_p12_cipher text,
  add column if not exists efi_certificate_password_cipher text,
  add column if not exists efi_pix_key_cipher text,
  add column if not exists efi_environment text not null default 'production'
    check (efi_environment in ('production', 'homologation'));
