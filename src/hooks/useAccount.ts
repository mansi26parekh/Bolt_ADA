import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export function useAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    const receive = (next: User | null) => {
      if (!alive) return;
      setUser(next);
      setLoading(false);
      setName("");
      if (next) {
        void supabase.from("profiles").select("display_name").eq("id", next.id).maybeSingle().then(({ data, error }) => {
          if (alive && !error) setName(data?.display_name ?? "");
        });
      }
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => receive(session?.user ?? null), 0);
    });
    const finish = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!alive) return;
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (params.get("error") || hash.get("error")) setNotice("That email link has expired or is invalid. Please request a new one.");
      if (code && !data.session) setNotice("That email link could not be verified. Request a new link on this device.");
      if (code || params.get("error") || hash.get("error")) {
        params.delete("code"); params.delete("error"); params.delete("error_code"); params.delete("error_description");
        window.history.replaceState({}, "", window.location.pathname + (params.size ? `?${params}` : ""));
      }
      if (error) setNotice("Could not restore your session. Please sign in again.");
      receive(data.session?.user ?? null);
    };
    void finish();
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);
  return { user, loading, name, setName, notice, setNotice };
}
