import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { supabase } from "../lib/supabase";
import { GOOGLE_AUTH_ENABLED } from "../lib/config";
import { useI18n } from "../i18n";
import { Button } from "../components/ui/button";

// Переводит код ошибки Supabase Auth в понятное сообщение.
function authMessage(
  error: unknown,
  errors: Record<string, string>,
  fallback: string,
) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code || "")
      : "";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit")
    return errors.rate_limit;
  if (code === "email_exists") return errors.user_already_exists;
  return errors[code] || fallback;
}

export function Login() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get("next") || "/app";
  const target = new URL(requested.startsWith("/app") ? requested : "/app", location.origin);
  const destination = target.origin === location.origin && (target.pathname === "/app" || target.pathname.startsWith("/app/"))
    ? target.pathname + target.search : "/app";

  function switchMode(value: boolean) {
    setSignup(value);
    setMessage("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = signup
        ? await supabase.auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: { emailRedirectTo: location.origin + destination },
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          });
      if (error) throw error;
      if (data.session) navigate(destination);
      else setMessage(t.checkEmail);
    } catch (error) {
      setMessage(authMessage(error, t.authErrors, t.error));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + destination },
    });
    if (error) {
      setMessage(authMessage(error, t.authErrors, t.error));
      setBusy(false);
    }
  }

  return (
    <div className="container page auth-page">
      <div className="panel">
        <LockKeyhole size={32} />
        <h1>{signup ? t.signUp : t.authTitle}</h1>
        <p className="muted">{t.authSub}</p>
        {!supabase && <p className="notice">{t.authDisabled}</p>}

        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!signup}
            className={!signup ? "selected" : ""}
            onClick={() => switchMode(false)}
          >
            {t.signIn}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={signup}
            className={signup ? "selected" : ""}
            onClick={() => switchMode(true)}
          >
            {t.signUp}
          </button>
        </div>

        {GOOGLE_AUTH_ENABLED && (
          <>
            <Button
              variant="outline"
              disabled={!supabase || busy}
              onClick={google}
              style={{ marginTop: 20 }}
            >
              {t.google}
            </Button>
            <p className="auth-or">{t.or}</p>
          </>
        )}

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

        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}

        <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>
          {signup ? t.haveAccount : t.noAccountYet}{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => switchMode(!signup)}
          >
            {signup ? t.signIn : t.signUp}
          </button>
        </p>

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
