import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/cyrillic-600.css";
import "./styles.css";
import { I18n, useI18n } from "./i18n";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Pricing } from "./pages/Pricing";
import { LLC, ITIN, FAQ, Legal } from "./pages/Services";
import { Login } from "./pages/Auth";
import { AppLayout, Dashboard, Documents, Deadlines } from "./pages/Dashboard";
import { Onboarding } from "./pages/Onboarding";
import { LlcOnboarding } from "./pages/LlcOnboarding";
import { ConsultOnboarding } from "./pages/Consult";
import { CONFIG_ERROR } from "./lib/config";
function NotFound() {
  const { t } = useI18n();
  return (
    <div className="container page">
      <h1>{t.notFound}</h1>
      <Link to="/">{t.home}</Link>
    </div>
  );
}
// Сайт без ключей Supabase и без явного демо-режима не должен принимать заявки.
function ConfigError() {
  return (
    <div className="container page">
      <h1>Сайт временно недоступен / Site temporarily unavailable</h1>
      <p>
        Идут технические работы. Пожалуйста, зайдите позже.
        <br />
        Maintenance in progress. Please come back later.
      </p>
    </div>
  );
}
if (CONFIG_ERROR) {
  console.error(
    "Taxpasso: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы, а VITE_DEMO_MODE не равен true.",
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  CONFIG_ERROR ? (
    <ConfigError />
  ) : (
  <React.StrictMode>
    <I18n>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="pricing" element={<Pricing />} />
              <Route path="llc" element={<LLC />} />
              <Route path="itin" element={<ITIN />} />
              <Route path="faq" element={<FAQ />} />
              <Route path="login" element={<Login />} />
              {(["terms", "privacy", "refund"] as const).map((k) => (
                <Route key={k} path={k} element={<Legal kind={k} />} />
              ))}
              <Route path="app" element={<AppLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="documents" element={<Documents />} />
                <Route path="deadlines" element={<Deadlines />} />
                <Route path="new" element={<Onboarding />} />
                <Route path="start" element={<LlcOnboarding />} />
                <Route path="consult" element={<ConsultOnboarding />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18n>
  </React.StrictMode>
  ),
);
