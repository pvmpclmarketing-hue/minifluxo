-- Cada nova conta recebe os dois modelos prontos para os gatilhos de pagamento.
create or replace function public.create_default_flows_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.flows (owner_id, name, description, status, nodes, edges)
  values
    (
      new.id,
      'Fluxo Gerar Música KIE',
      'Use quando o pagamento aprovado chegar com letra, estilo e voz para gerar a música pela Kie.ai.',
      'active',
      jsonb_build_array(
        jsonb_build_object('id','entry','type','builderNode','position',jsonb_build_object('x',40,'y',170),'data',jsonb_build_object('kind','start','title','Entrada','icon','1','tone','violet','description','Início do fluxo','config',jsonb_build_object('trigger','payment'))),
        jsonb_build_object('id','message','type','builderNode','position',jsonb_build_object('x',320,'y',170),'data',jsonb_build_object('kind','message','title','Mensagem','icon','M','tone','blue','description','Envia texto no WhatsApp','config',jsonb_build_object('message','Seu pedido foi confirmado. Estamos finalizando a sua música e enviaremos aqui neste WhatsApp.'))),
        jsonb_build_object('id','music','type','builderNode','position',jsonb_build_object('x',610,'y',170),'data',jsonb_build_object('kind','kie','title','Gerar música','icon','K','tone','pink','description','Envia pedido para Kie.ai','config',jsonb_build_object('model','Suno V5','style','','instrumental',false,'credential','Chave do fluxo'))),
        jsonb_build_object('id','deliver','type','builderNode','position',jsonb_build_object('x',900,'y',170),'data',jsonb_build_object('kind','deliver','title','Entrega gerada','icon','OK','tone','teal','description','Envia as 2 músicas geradas no fluxo','config',jsonb_build_object('intro','Sua música está pronta! Vou enviar as duas faixas em áudio.','tracks',2)))
      ),
      jsonb_build_array(
        jsonb_build_object('id','entry-message','source','entry','target','message','type','smoothstep','animated',true),
        jsonb_build_object('id','message-music','source','message','target','music','type','smoothstep','animated',true),
        jsonb_build_object('id','music-deliver','source','music','target','deliver','type','smoothstep','animated',true)
      )
    ),
    (
      new.id,
      'Fluxo Prévia Pronta',
      'Use quando o pagamento aprovado chegar com as duas músicas da prévia já geradas pelo site.',
      'active',
      jsonb_build_array(
        jsonb_build_object('id','entry','type','builderNode','position',jsonb_build_object('x',40,'y',170),'data',jsonb_build_object('kind','start','title','Entrada','icon','1','tone','violet','description','Início do fluxo','config',jsonb_build_object('trigger','payment'))),
        jsonb_build_object('id','message','type','builderNode','position',jsonb_build_object('x',320,'y',170),'data',jsonb_build_object('kind','message','title','Mensagem','icon','M','tone','blue','description','Envia texto no WhatsApp','config',jsonb_build_object('message','Seu pagamento foi confirmado. Vou enviar agora a música que você aprovou.'))),
        jsonb_build_object('id','preview-deliver','type','builderNode','position',jsonb_build_object('x',610,'y',170),'data',jsonb_build_object('kind','previewDeliver','title','Enviar música da prévia','icon','PV','tone','teal','description','Entrega a música que o cliente ouviu no site','config',jsonb_build_object('intro','Sua música está pronta! Vou enviar as duas faixas da sua prévia em áudio.','tracks',2)))
      ),
      jsonb_build_array(
        jsonb_build_object('id','entry-message','source','entry','target','message','type','smoothstep','animated',true),
        jsonb_build_object('id','message-preview-deliver','source','message','target','preview-deliver','type','smoothstep','animated',true)
      )
    );
  return new;
end;
$$;

revoke all on function public.create_default_flows_for_user() from public;
revoke execute on function public.create_default_flows_for_user() from anon, authenticated;

drop trigger if exists on_auth_user_created_default_flows on auth.users;
create trigger on_auth_user_created_default_flows
  after insert on auth.users
  for each row execute procedure public.create_default_flows_for_user();
