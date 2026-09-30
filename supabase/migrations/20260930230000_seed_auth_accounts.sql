-- Create auth accounts and memberships for employees seeded without a user_id
-- Password will be explicitly set to 'Aymakan@2026'

DO $$
DECLARE
    emp record;
    v_new_user_id uuid;
    v_email text;
    v_encrypted_pass text;
BEGIN
    -- Only do this if pgcrypto is available
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    v_encrypted_pass := crypt('Aymakan@2026', gen_salt('bf'));

    FOR emp IN 
        SELECT id, organization_id, employee_code, full_name, user_id 
        FROM public.employee_profiles 
        WHERE user_id IS NULL
    LOOP
        v_new_user_id := gen_random_uuid();
        v_email := lower(emp.employee_code) || '@geotrack.app';

        -- Insert into auth.users (simulate Supabase Auth creation)
        -- This will automatically trigger private.handle_new_auth_user() to insert into public.users
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password, 
            email_confirmed_at, raw_user_meta_data, created_at, updated_at
        ) VALUES (
            '00000000-0000-0000-0000-000000000000', v_new_user_id, 'authenticated', 'authenticated', v_email, v_encrypted_pass,
            now(), jsonb_build_object('display_name', emp.full_name), now(), now()
        );

        -- Link auth user to employee profile
        UPDATE public.employee_profiles 
        SET user_id = v_new_user_id 
        WHERE id = emp.id;

        -- Create organization membership so they can pass RLS and authenticate in the app
        INSERT INTO public.organization_memberships (organization_id, user_id, role_code, status)
        VALUES (emp.organization_id, v_new_user_id, 'employee', 'active')
        ON CONFLICT (organization_id, user_id) DO NOTHING;

    END LOOP;
END $$;
