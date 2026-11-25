import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Mail, UserCircle, X, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";

export function AccountDialog({ user, name, mode, onClose, onName, onMode, onSignOut }: { user: User | null; name: string; mode: "signin" | "profile" | "email"; onClose: () => void; onName: (name: string) => void; onMode: (mode: "email") => void; onSignOut: () => void }) {
  const [value, setValue] = useState(mode === "profile" ? name : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const redirect = window.location.origin + window.location.pathname;
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithOtp({ email: value.trim(), options: { shouldCreateUser: true, emailRedirectTo: redirect } });
        if (error) throw error;
        setMessage("Check your inbox for a secure sign-in link. Open it on this device. The same link flow works for new and returning users.");
      } else if (mode === "email") {
        const { error } = await supabase.auth.updateUser({ email: value.trim() }, { emailRedirectTo: redirect });
        if (error) throw error;
        setMessage("Check your new email for a verification link. Supabase may also require confirmation from your current email. Your registered email stays unchanged until verification finishes.");
      } else if (user) {
        const { error } = await supabase.from("profiles").update({ display_name: value.trim() }).eq("id", user.id);
        if (error) throw error;
        onName(value.trim()); setMessage("Profile saved.");
      }
      setSent(true);
    } catch {
      setMessage("Could not complete this request. Please wait a moment and try again.");
    } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="account-title" className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
      <div className="flex items-center justify-between mb-4"><UserCircle className="text-emerald-400 w-8 h-8" /><button onClick={onClose} aria-label="Close account dialog" className="p-2 text-slate-300 hover:text-white"><X size={20} /></button></div>
      <h2 id="account-title" className="text-xl font-semibold mb-2">{mode === "signin" ? "Sign Up" : mode === "email" ? "Change Email" : "My Profile"}</h2>
      <p className="text-sm text-slate-300 leading-relaxed mb-6">{mode === "signin" ? "Enter your email to create an account or return to your projects. No password needed." : mode === "email" ? "Verify your new email before it replaces your registered address." : user?.email}</p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">{mode === "profile" ? "Display name" : "Email address"}<input autoFocus required={mode !== "profile"} maxLength={mode === "profile" ? 80 : 254} type={mode === "profile" ? "text" : "email"} autoComplete={mode === "profile" ? "name" : "email"} value={value} onChange={e => { setValue(e.target.value); setSent(false); }} className="mt-2 w-full rounded-lg bg-slate-950 border border-slate-600 px-4 py-3 text-white focus:outline-none focus:border-emerald-400" /></label>
        <button disabled={busy || sent} className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 px-4 py-3 text-white font-medium">{busy ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}{mode === "profile" ? "Save Profile" : mode === "email" ? "Send Verification Link" : "Send Sign-in Link"}</button>
      </form>
      {mode === "profile" && <div className="mt-4 flex gap-4 text-sm text-slate-200"><button onClick={() => onMode("email")} className="hover:text-white">Change Email</button><button onClick={onSignOut} className="hover:text-white">Sign Out</button></div>}
      {message && <p role="status" className="mt-4 text-sm leading-relaxed text-slate-200">{message}</p>}
    </section>
  </div>;
}
