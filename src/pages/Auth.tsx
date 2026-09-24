import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../i18n";
import { Button } from "../components/ui/button";
export function Login() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = signup
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: location.origin + "/app" },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session) navigate("/app");
      else setMessage(t.checkEmail);
    } catch {
      setMessage(t.error);
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/app" },
    });
    if (error) {
      setMessage(t.error);
      setBusy(false);
    }
  }
  return (
    <div className="container page auth-page">
      <div className="panel">
        <LockKeyhole size={32} />
        <h1>{t.authTitle}</h1>
        <p className="muted">{t.authSub}</p>
        {!supabase && <p className="notice">{t.authDisabled}</p>}
        <Button variant="outline" disabled={!supabase || busy} onClick={google}>
          {t.google}
        </Button>
        <p className="auth-or">{t.or}</p>
        <form onSubmit={submit}>
          <label>
            {t.email}
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            {t.password}
            <input
              required
              minLength={8}
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button disabled={!supabase || busy} type="submit">
            {busy ? t.loading : signup ? t.signUp : t.signIn}
            <ArrowRight size={17} />
          </Button>
        </form>
        <p role="status">{message}</p>
        <button className="text-link" onClick={() => setSignup(!signup)}>
          {signup ? t.signIn : t.signUp}
        </button>
        {!supabase && (
          <Link className="text-link" to="/app">
            {t.demoEnter}
            <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </div>
  );
}
