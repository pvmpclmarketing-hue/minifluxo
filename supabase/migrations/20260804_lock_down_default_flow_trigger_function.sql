-- A função é usada somente pelo trigger interno de auth.users, nunca via RPC.
revoke execute on function public.create_default_flows_for_user() from anon, authenticated;
