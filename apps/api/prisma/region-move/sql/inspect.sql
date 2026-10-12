-- [region-move] Read-only report of one project, run by inspect.sh.
-- Same output format for every project, so two reports can be diffed
-- (Ireland before the copy vs. the new project after the restore).
-- psql variable :old_ref = project ref to look for in stored URLs.

select set_config('region_move.old_ref', :'old_ref', false) \g /dev/null

\echo '## versions'
select 'postgres major ' || current_setting('server_version_num')::int / 10000;
select 'auth migrations ' || count(*) || ' latest ' || max(version) from auth.schema_migrations;
select 'storage migrations ' || count(*) || ' latest ' || max(id) from storage.migrations;

\echo '## extensions'
select extname || ' ' || extversion || ' (' || n.nspname || ')' from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1;

\echo '## schemas'
select nspname || ' owner=' || pg_get_userbyid(nspowner) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' order by 1;

\echo '## custom roles'
select rolname || ' login=' || rolcanlogin || ' bypassrls=' || rolbypassrls from pg_roles
 where rolname !~ '^(pg_|supabase_|cli_login_|pgsodium_)'
   and rolname not in ('postgres','anon','authenticated','authenticator','service_role','dashboard_user','pgbouncer','pgtle_admin')
 order by 1;

\echo '## event triggers'
select evtname || ' owner=' || pg_get_userbyid(evtowner) from pg_event_trigger order by 1;

\echo '## publications'
select p.pubname || ': ' || coalesce(string_agg(pt.schemaname || '.' || pt.tablename, ', ' order by pt.tablename), '(no tables)')
  from pg_publication p left join pg_publication_tables pt on pt.pubname = p.pubname group by p.pubname order by 1;

\echo '## other objects the dump would miss'
select 'foreign servers: ' || count(*) from pg_foreign_server;
select 'vault secrets: ' || count(*) from vault.secrets;
select 'pg_cron installed: ' || exists(select 1 from pg_extension where extname = 'pg_cron');
select 'supabase_functions schema: ' || exists(select 1 from pg_namespace where nspname = 'supabase_functions');
select 'custom triggers on auth/storage: ' || count(*)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
 where not t.tgisinternal and n.nspname in ('auth', 'storage')
   and pg_get_userbyid(p.proowner) not in ('supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin');
select 'postgres-owned functions in auth/storage: ' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('auth', 'storage') and pg_get_userbyid(p.proowner) = 'postgres';
select 'policies outside public/app_private: ' || count(*) from pg_policies where schemaname not in ('public', 'app_private');

\echo '## tables: RLS, policies, anon/authenticated privileges (public, app_private)'
select n.nspname || '.' || c.relname
       || ' rls=' || c.relrowsecurity
       || ' policies=' || (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname)
       || ' anon=' || concat_ws('', case when has_table_privilege('anon', c.oid, 'select') then 'S' end,
                                     case when has_table_privilege('anon', c.oid, 'insert') then 'I' end,
                                     case when has_table_privilege('anon', c.oid, 'update') then 'U' end,
                                     case when has_table_privilege('anon', c.oid, 'delete') then 'D' end)
       || ' authenticated=' || concat_ws('', case when has_table_privilege('authenticated', c.oid, 'select') then 'S' end,
                                     case when has_table_privilege('authenticated', c.oid, 'insert') then 'I' end,
                                     case when has_table_privilege('authenticated', c.oid, 'update') then 'U' end,
                                     case when has_table_privilege('authenticated', c.oid, 'delete') then 'D' end)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') order by 1;

\echo '## policies'
select schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',')
  from pg_policies order by 1;

\echo '## functions (public, app_private)'
select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') secdef=' || p.prosecdef
       || ' anon_exec=' || has_function_privilege('anon', p.oid, 'execute')
       || ' authenticated_exec=' || has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app_private') order by 1;

\echo '## triggers (public)'
select c.relname || ' ' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname = 'public' order by 1;

\echo '## default privileges (public)'
select pg_get_userbyid(defaclrole) || ' ' || case defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' else defaclobjtype::text end
       || ': ' || array_to_string(defaclacl, ' ')
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' order by 1;

\echo '## auth'
select 'users ' || count(*) || ' confirmed ' || count(*) filter (where email_confirmed_at is not null)
       || ' with_password ' || count(*) filter (where encrypted_password <> '') from auth.users;
select 'identities ' || coalesce(string_agg(provider || '=' || n, ', ' order by provider), 'none')
  from (select provider, count(*) n from auth.identities group by 1) x;
select 'mfa factors ' || count(*) from auth.mfa_factors;
select 'sso providers ' || count(*) from auth.sso_providers;

\echo '## storage'
select 'bucket ' || b.id || ' public=' || b.public || ' size_limit=' || coalesce(b.file_size_limit::text, '-')
       || ' objects=' || count(o.id) || ' bytes=' || coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by b.id, b.public, b.file_size_limit order by 1;

\echo '## prisma migrations'
do $$ declare line text; begin
  if to_regclass('public._prisma_migrations') is null then raise notice 'no _prisma_migrations table'; return; end if;
  execute $q$select 'applied ' || count(*) filter (where finished_at is not null and rolled_back_at is null)
       || ' rolled_back ' || count(*) filter (where rolled_back_at is not null)
       || ' latest ' || max(migration_name) filter (where finished_at is not null and rolled_back_at is null)
  from public._prisma_migrations$q$ into line;
  raise notice '%', line;
end $$;

\echo '## row counts (public, auth, storage)'
do $$ declare r record; n bigint; begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('public', 'auth', 'storage') order by 1, 2 loop
    execute format('select count(*) from %I.%I', r.schemaname, r.tablename) into n;
    raise notice '%.%: %', r.schemaname, r.tablename, n;
  end loop; end $$;

\echo '## stored values containing the old project ref (text and json columns)'
do $$ declare r record; n bigint; ref text := current_setting('region_move.old_ref'); begin
  for r in select table_name, column_name, data_type from information_schema.columns
            where table_schema = 'public' and data_type in ('text', 'character varying', 'json', 'jsonb') order by 1, 2 loop
    execute format('select count(*) from public.%I where %I::text like %L', r.table_name, r.column_name, '%' || ref || '%') into n;
    if n > 0 then raise notice '%.%: % rows', r.table_name, r.column_name, n; end if;
  end loop; end $$;

\echo '## auth/storage columns'
select table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
  from information_schema.columns where table_schema in ('auth', 'storage') order by 1;
