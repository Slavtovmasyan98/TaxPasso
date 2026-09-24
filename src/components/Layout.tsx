import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, Menu, X, Moon, Sun } from "lucide-react";
import { useI18n } from "../i18n";
import { Button } from "./ui/button";
export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Taxpasso">
      <svg width="29" height="29" viewBox="0 0 29 29" fill="none">
        <path
          d="M3 24V15H12V6H25M16 3H26V13"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
      </svg>
      Taxpasso<span className="logo-dot">.</span>
    </Link>
  );
}
export function Layout() {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(
    localStorage.getItem("taxpasso-theme") === "dark",
  );
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
    if (location.hash) {
      requestAnimationFrame(() =>
        document.getElementById(location.hash.slice(1))?.scrollIntoView(),
      );
    } else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("taxpasso-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <Logo />
          <nav className={open ? "nav open" : "nav"}>
            <NavLink to="/llc">{t.nav[0]}</NavLink>
            <NavLink to="/pricing">{t.nav[1]}</NavLink>
            <Link to="/#how">{t.nav[2]}</Link>
            <NavLink to="/faq">{t.nav[3]}</NavLink>
          </nav>
          <div className="header-actions">
            <button
              className="language"
              onClick={() => setLang(lang === "ru" ? "en" : "ru")}
            >
              {lang.toUpperCase()} <span>⌄</span>
            </button>
            <button
              className="icon-button"
              aria-label={lang === "ru" ? "Сменить тему" : "Toggle theme"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="account-link"
            >
              <Link to="/app">
                {t.login}
                <ArrowUpRight size={16} />
              </Link>
            </Button>
            <button
              className="icon-button menu-toggle"
              aria-label="Menu"
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        <div className="container">
          <div className="footer-top">
            <div>
              <Logo />
              <p className="muted">{t.sub.split("\n")[0]}</p>
            </div>
            <div className="footer-links">
              <Link to="/llc">LLC</Link>
              <Link to="/itin">ITIN</Link>
              <Link to="/pricing">{t.nav[1]}</Link>
              <Link to="/faq">FAQ</Link>
            </div>
          </div>
          <p className="disclaimer">{t.footer}</p>
          <div className="footer-bottom">
            <span>
              © {new Date().getFullYear()} Taxpasso. {t.rights}
            </span>
            <div>
              {["terms", "privacy", "refund"].map((x, i) => (
                <Link key={x} to={"/" + x}>
                  {t.legal[i]}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
