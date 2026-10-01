import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
const C = createContext<{
  session: Session | null;
  loading: boolean;
  role: string;
}>({ session: null, loading: true, role: "client" });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  // Роль из profiles; null — ещё не загружена для текущего пользователя.
  const [role, setRole] = useState<{ uid: string; role: string } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  // Запрашиваем роль один раз на пользователя (не при каждом обновлении токена). Пока она не известна,
  // кабинет показывает «Загрузка», чтобы партнёр не увидел клиентский интерфейс даже на мгновение.
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid || !supabase) return;
    let active = true;
    supabase
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .single()
      .then(({ data }) => {
        // При ошибке — клиент: права всё равно проверяет база (партнёр не может создать заказ).
        if (active) setRole({ uid, role: data?.role || "client" });
      });
    return () => {
      active = false;
    };
  }, [uid]);
  const roleReady = !uid || role?.uid === uid;
  return (
    <C.Provider value={{ session, loading: loading || !roleReady, role: (roleReady && role?.role) || "client" }}>
      {children}
    </C.Provider>
  );
}
export const useAuth = () => useContext(C);
