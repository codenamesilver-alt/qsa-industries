update auth.users
set instance_id = '00000000-0000-0000-0000-000000000000'
where instance_id is null;

update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  phone_change = coalesce(phone_change, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or phone_change is null;
