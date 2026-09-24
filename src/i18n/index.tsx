import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import ru from "./ru";
import en from "./en";
const Context = createContext({
  t: ru,
  lang: "ru",
  setLang: (_v: string) => {},
});
export function I18n({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState(
    localStorage.getItem("taxpasso-language") || "ru",
  );
  useEffect(() => {
    localStorage.setItem("taxpasso-language", lang);
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <Context.Provider value={{ t: lang === "en" ? en : ru, lang, setLang }}>
      {children}
    </Context.Provider>
  );
}
export const useI18n = () => useContext(Context);
