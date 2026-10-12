-- Read-only security report of the app schemas (public, app_private).
-- Same output on every database, so reports can be diffed (Ireland vs. the
-- local test copy, before vs. after the lockdown migration).
--   S/I/U/D = select/insert/update/delete, X = execute, U(seq) = usage

\echo '## tables: rls, policies, anon / authenticated / PUBLIC privileges'
select n.nspname || '.' || c.relname
       || ' rls=' || c.relrowsecurity
       || ' policies=' || (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname)
       || ' anon=' || coalesce(nullif(concat(
            case when has_table_privilege('anon', c.oid, 'select') then 'S' end,
            case when has_table_privilege('anon', c.oid, 'insert') then 'I' end,
            case when has_table_privilege('anon', c.oid, 'update') then 'U' end,
            case when has_table_privilege('anon', c.oid, 'delete') then 'D' end), ''), '-')
       || ' authenticated=' || coalesce(nullif(concat(
            case when has_table_privilege('authenticated', c.oid, 'select') then 'S' end,
            case when has_table_privilege('authenticated', c.oid, 'insert') then 'I' end,
            case when has_table_privilege('authenticated', c.oid, 'update') then 'U' end,
            case when has_table_privilege('authenticated', c.oid, 'delete') then 'D' end), ''), '-')
       || ' public_acl=' || coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
            from aclexplode(c.relacl) a where a.grantee = 0), '-')
       || ' owner=' || pg_get_userbyid(c.relowner)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') order by 1;

\echo '## views and materialized views'
select n.nspname || '.' || c.relname || ' kind=' || c.relkind::text
       || ' anon_select=' || has_table_privilege('anon', c.oid, 'select')
       || ' authenticated_select=' || has_table_privilege('authenticated', c.oid, 'select')
       || ' security_invoker=' || coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'app_private') and c.relkind in ('v', 'm') order by 1;

\echo '## column-level grants to anon / authenticated'
select table_schema || '.' || table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.column_privileges
 where table_schema in ('public', 'app_private') and grantee in ('anon', 'authenticated', 'PUBLIC')
   and (table_schema, table_name, grantee, privilege_type) not in (
     select table_schema, table_name, grantee, privilege_type from information_schema.table_privileges)
 order by 1;

\echo '## sequences'
select n.nspname || '.' || c.relname
       || ' anon=' || coalesce(nullif(concat(
            case when has_sequence_privilege('anon', c.oid, 'usage') then 'U' end,
            case when has_sequence_privilege('anon', c.oid, 'select') then 'S' end,
            case when has_sequence_privilege('anon', c.oid, 'update') then 'W' end), ''), '-')
       || ' authenticated=' || coalesce(nullif(concat(
            case when has_sequence_privilege('authenticated', c.oid, 'usage') then 'U' end,
            case when has_sequence_privilege('authenticated', c.oid, 'select') then 'S' end,
            case when has_sequence_privilege('authenticated', c.oid, 'update') then 'W' end), ''), '-')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'app_private') and c.relkind = 'S' order by 1;

\echo '## functions'
select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       || ' secdef=' || p.prosecdef
       || ' anon_x=' || has_function_privilege('anon', p.oid, 'execute')
       || ' authenticated_x=' || has_function_privilege('authenticated', p.oid, 'execute')
       || ' public_x=' || coalesce((select bool_or(a.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), false)
       || ' search_path=' || coalesce((select string_agg(cfg, ';') from unnest(p.proconfig) cfg where cfg like 'search_path=%'), 'unset')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'app_private') order by 1;

\echo '## schema privileges'
select s.nspname || ' ' || r.rolname || ' usage=' || has_schema_privilege(r.rolname, s.nspname, 'usage')
       || ' create=' || has_schema_privilege(r.rolname, s.nspname, 'create')
  from (values ('public'), ('app_private')) s(nspname)
  cross join (values ('anon'), ('authenticated')) r(rolname) order by 1;

\echo '## default privileges (public, app_private)'
select n.nspname || ' ' || pg_get_userbyid(d.defaclrole) || ' '
       || case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' else d.defaclobjtype::text end
       || ': ' || array_to_string(d.defaclacl, ' ')
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname in ('public', 'app_private') order by 1;

\echo '## policies'
select schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',')
  from pg_policies where schemaname in ('public', 'app_private') order by 1;
