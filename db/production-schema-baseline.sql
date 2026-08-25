--
-- Gesso — Production public-schema baseline (CAPTURED SNAPSHOT — DO NOT APPLY BLINDLY)
-- ============================================================================
-- Capture date (UTC):   2026-08-25T04:07:09Z
-- Project ref:          jmrpqmejupouqfergyyg  (project "gesso", region us-west-2)
-- Source schema:        public   (schema-only)
-- Global objects:       + RLS event trigger "ensure_rls" (catalog-derived, appended at end)
-- Server version:       PostgreSQL 17.6
-- Captured with:        pg_dump 18.6   (--schema=public --schema-only --no-owner)
-- Row data:             NONE — schema-only; zero rows exported (verified: no COPY/INSERT)
-- Ownership:            STRIPPED via --no-owner; GRANT/ACL privileges PRESERVED intentionally
-- psql nonce:           restore-guard meta-commands removed (capture-specific, non-semantic)
--
-- PURPOSE: point-in-time reference of production DDL to author PR 3 / PR 4
-- (device-ownership + account-erasure) and PR 8 (tracked base schema).
-- This is NOT a migration. Do NOT run it against production.
--
-- GLOBAL OBJECT: the RLS event trigger "ensure_rls" (fires public.rls_auto_enable()
-- on ddl_command_end) is a database-level object a public-only dump does not emit.
-- It was VERIFIED via read-only pg_catalog query and its sanitized CREATE EVENT
-- TRIGGER DDL is appended in the GLOBAL SECURITY OBJECTS section at the end of this
-- file. See db/production-schema-baseline.md for provenance, catalog evidence,
-- reconciliation, limitations, and this file's SHA-256.
-- ============================================================================

--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';

--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    device_id text NOT NULL,
    event text NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL
);

--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id text,
    user_id uuid,
    name text,
    color text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saves (
    device_id text NOT NULL,
    work_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    device_id text NOT NULL,
    date date NOT NULL,
    tier text NOT NULL,
    total integer NOT NULL,
    perfects integer DEFAULT 0,
    masterpieces integer DEFAULT 0,
    rounds jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    cold boolean DEFAULT false NOT NULL
);

--
-- Name: user_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_state (
    user_id uuid NOT NULL,
    streak jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    mastery jsonb,
    glossary jsonb,
    seen jsonb
);

--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

--
-- Name: profiles profiles_device_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_device_id_key UNIQUE (device_id);

--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

--
-- Name: saves saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saves
    ADD CONSTRAINT saves_pkey PRIMARY KEY (device_id, work_id);

--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (device_id, date, tier);

--
-- Name: user_state user_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_state
    ADD CONSTRAINT user_state_pkey PRIMARY KEY (user_id);

--
-- Name: events_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_device ON public.events USING btree (device_id);

--
-- Name: events_event_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_event_ts ON public.events USING btree (event, ts);

--
-- Name: saves_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saves_device_idx ON public.saves USING btree (device_id, created_at DESC);

--
-- Name: scores_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scores_board ON public.scores USING btree (date, tier, total DESC);

--
-- Name: scores_date_tier_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scores_date_tier_total ON public.scores USING btree (date, tier, total DESC);

--
-- Name: scores_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scores_device ON public.scores USING btree (device_id);

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: saves; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;

--
-- Name: scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

--
-- Name: user_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;

--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.events TO anon;
GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;

--
-- Name: SEQUENCE events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.events_id_seq TO service_role;

--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

--
-- Name: TABLE saves; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.saves TO anon;
GRANT ALL ON TABLE public.saves TO authenticated;
GRANT ALL ON TABLE public.saves TO service_role;

--
-- Name: TABLE scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scores TO anon;
GRANT ALL ON TABLE public.scores TO authenticated;
GRANT ALL ON TABLE public.scores TO service_role;

--
-- Name: TABLE user_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_state TO anon;
GRANT ALL ON TABLE public.user_state TO authenticated;
GRANT ALL ON TABLE public.user_state TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;

--
-- PostgreSQL database dump complete
--


--
-- ============================================================================
-- GLOBAL SECURITY OBJECTS (catalog-derived; NOT emitted by a --schema=public dump)
-- ----------------------------------------------------------------------------
-- Verified 2026-08-25T04:07:09Z via read-only pg_catalog query (pg_event_trigger).
-- This database-level object auto-enables RLS on newly created public tables and is
-- the enforcement mechanism behind the RLS-on-by-default posture. Reproduced here
-- from the catalog for completeness. Sanitized: no rows, no credentials.
-- State: ENABLED (pg_event_trigger.evtenabled = 'O'). The invoked function
-- public.rls_auto_enable() is SECURITY DEFINER with search_path pinned to pg_catalog
-- (see its definition above).
-- ============================================================================

CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    EXECUTE FUNCTION public.rls_auto_enable();
