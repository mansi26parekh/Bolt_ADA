/*
# Private accounts and read-only reports
1. Adds private profiles with display names, account ownership to projects and scans, and a server-only registry of shared report IDs.
2. Existing projects and scans remain stored with no owner until an administrator assigns them. Existing report URLs are registered for read-only access; no records are deleted.
3. Replaces public table policies with account-scoped access and limits editable columns. Scan outputs remain server-written. Profile creation follows verified Supabase accounts.
4. Project domains become unique per owner, allowing separate accounts to scan the same website. Public reports are served only through a restricted server path.
*/
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
DROP INDEX IF EXISTS public.projects_domain_unique;
CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_domain_unique ON public.projects(user_id,domain);
CREATE INDEX IF NOT EXISTS scans_owner_idx ON public.scans(user_id);
CREATE TABLE IF NOT EXISTS public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), display_name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.shared_reports(scan_id uuid PRIMARY KEY REFERENCES public.scans(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;
INSERT INTO public.shared_reports(scan_id) SELECT id FROM public.scans ON CONFLICT DO NOTHING;
GRANT ALL ON public.profiles,public.shared_reports TO service_role;
REVOKE ALL ON public.shared_reports FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.create_account_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN INSERT INTO public.profiles(id,display_name) VALUES(NEW.id,'') ON CONFLICT DO NOTHING; RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public.create_account_profile() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS create_account_profile ON auth.users;
CREATE TRIGGER create_account_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_account_profile();
INSERT INTO public.profiles(id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('projects','scans','scan_pages','scan_results','scheduled_scans','profiles','shared_reports') LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename); END LOOP; END $$;
REVOKE ALL ON public.projects,public.scans,public.scan_pages,public.scan_results,public.scheduled_scans,public.profiles FROM anon,authenticated;
GRANT SELECT,DELETE ON public.projects TO authenticated;
GRANT INSERT(name,domain,url), UPDATE(name,url,last_scan_id) ON public.projects TO authenticated;
GRANT SELECT ON public.scans,public.scan_pages,public.scan_results,public.profiles TO authenticated;
GRANT UPDATE(display_name) ON public.profiles TO authenticated;
GRANT SELECT,DELETE ON public.scheduled_scans TO authenticated;
GRANT INSERT(project_id,email,recurrence,next_scan_at),UPDATE(email,recurrence,next_scan_at,status,updated_at) ON public.scheduled_scans TO authenticated;
CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated USING(user_id=auth.uid());
CREATE POLICY scans_select ON public.scans FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY scans_insert ON public.scans FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY scans_update ON public.scans FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY scans_delete ON public.scans FOR DELETE TO authenticated USING(false);
CREATE POLICY pages_select ON public.scan_pages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.scans s WHERE s.id=scan_id AND s.user_id=auth.uid()));
CREATE POLICY pages_insert ON public.scan_pages FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY pages_update ON public.scan_pages FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY pages_delete ON public.scan_pages FOR DELETE TO authenticated USING(false);
CREATE POLICY results_select ON public.scan_results FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.scans s WHERE s.id=scan_id AND s.user_id=auth.uid()));
CREATE POLICY results_insert ON public.scan_results FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY results_update ON public.scan_results FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY results_delete ON public.scan_results FOR DELETE TO authenticated USING(false);
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING(id=auth.uid()) WITH CHECK(id=auth.uid() AND length(display_name)<=80);
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated USING(false);
CREATE POLICY schedules_select ON public.scheduled_scans FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.user_id=auth.uid()));
CREATE POLICY schedules_insert ON public.scheduled_scans FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.user_id=auth.uid()));
CREATE POLICY schedules_update ON public.scheduled_scans FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.user_id=auth.uid())) WITH CHECK(EXISTS(SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.user_id=auth.uid()));
CREATE POLICY schedules_delete ON public.scheduled_scans FOR DELETE TO authenticated USING(EXISTS(SELECT 1 FROM public.projects p WHERE p.id=project_id AND p.user_id=auth.uid()));
CREATE POLICY shares_select ON public.shared_reports FOR SELECT TO authenticated USING(false);
CREATE POLICY shares_insert ON public.shared_reports FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY shares_update ON public.shared_reports FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY shares_delete ON public.shared_reports FOR DELETE TO authenticated USING(false);
CREATE OR REPLACE FUNCTION public.share_report(p_scan uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.scans WHERE id=p_scan AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF; INSERT INTO public.shared_reports(scan_id) VALUES(p_scan) ON CONFLICT DO NOTHING; END $$;
REVOKE EXECUTE ON FUNCTION public.share_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.share_report(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.check_project_scan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NEW.last_scan_id IS DISTINCT FROM OLD.last_scan_id AND NEW.last_scan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.scans s WHERE s.id::text=NEW.last_scan_id AND s.user_id=NEW.user_id AND s.project_id=NEW.id) THEN RAISE EXCEPTION 'Not authorized'; END IF; RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public.check_project_scan() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS check_project_scan ON public.projects;
CREATE TRIGGER check_project_scan BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.check_project_scan();