-- Seed script for Mailroom Employees
-- Applied automatically on deployment

DO $$
DECLARE
    v_org_id uuid;
    v_branch_id uuid;
    v_dept_id uuid;
BEGIN
    -- 1. Get or create a default organization
    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
    IF v_org_id IS NULL THEN
        INSERT INTO public.organizations (name, slug, timezone)
        VALUES ('Default Org', 'default-org', 'UTC')
        RETURNING id INTO v_org_id;
    END IF;

    -- 2. Get or create the 'Mailroom' branch
    SELECT id INTO v_branch_id FROM public.branches 
    WHERE organization_id = v_org_id AND name = 'Mailroom' LIMIT 1;
    
    IF v_branch_id IS NULL THEN
        INSERT INTO public.branches (organization_id, code, name, timezone)
        VALUES (v_org_id, 'MR', 'Mailroom', 'UTC')
        RETURNING id INTO v_branch_id;
    END IF;

    -- 3. Get or create a default department (Operations)
    SELECT id INTO v_dept_id FROM public.departments 
    WHERE organization_id = v_org_id AND name = 'Operations' LIMIT 1;
    
    IF v_dept_id IS NULL THEN
        INSERT INTO public.departments (organization_id, branch_id, code, name)
        VALUES (v_org_id, v_branch_id, 'OPS', 'Operations')
        RETURNING id INTO v_dept_id;
    END IF;

    -- 4. Seed the employees safely (avoiding duplicates by checking iqama_number)
    
    -- Md Ariful Islam
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2509133431') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, 'AY0314', '2509133431', 'Md Ariful Islam', v_branch_id, v_dept_id, 'Operation Assistant');
    END IF;

    -- P Sarker Md Ripon
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2559993973') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL0178', '2559993973', 'P Sarker Md Ripon', v_branch_id, v_dept_id, 'Labour');
    END IF;

    -- Tarek
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2546128634') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL0297', '2546128634', 'Tarek', v_branch_id, v_dept_id, 'Labour');
    END IF;

    -- Md Alal Hossain
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2561106515') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL0180', '2561106515', 'Md Alal Hossain', v_branch_id, v_dept_id, 'Labour');
    END IF;

    -- MD Rakib Hosain
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2581183908') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL0293', '2581183908', 'MD Rakib Hosain', v_branch_id, v_dept_id, 'Labour');
    END IF;

    -- Likhon
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2579273695') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL0295', '2579273695', 'Likhon', v_branch_id, v_dept_id, 'Labour');
    END IF;

    -- MD PALASH HOSSAIN
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2614619910') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL0575', '2614619910', 'MD PALASH HOSSAIN', v_branch_id, v_dept_id, 'Labour');
    END IF;

    -- RAFIUL ISLAM MAMIN
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2633783143') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL0983', '2633783143', 'RAFIUL ISLAM MAMIN', v_branch_id, v_dept_id, 'Labour');
    END IF;

    -- Abdullah Al Mamun
    IF NOT EXISTS (SELECT 1 FROM public.employee_profiles WHERE iqama_number = '2604470415') THEN
        INSERT INTO public.employee_profiles (organization_id, employee_code, iqama_number, full_name, branch_id, department_id, job_title)
        VALUES (v_org_id, '3PL1064', '2604470415', 'Abdullah Al Mamun', v_branch_id, v_dept_id, 'Labour');
    END IF;

END $$;
