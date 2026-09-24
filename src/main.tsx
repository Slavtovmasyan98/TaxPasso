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
function NotFound() {
  const { t } = useI18n();
  return (
    <div className="container page">
      <h1>{t.notFound}</h1>
      <Link to="/">{t.home}</Link>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
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
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18n>
  </React.StrictMode>,
);
