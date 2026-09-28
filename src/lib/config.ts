// Демо-режим включается ТОЛЬКО явно: VITE_DEMO_MODE=true.
// Если демо выключено, а ключей Supabase нет — сайт показывает ошибку настройки,
// а не молча притворяется, что сохраняет заявки.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
export const SUPABASE_URL = url || "";
export const SUPABASE_ANON_KEY = key || "";
export const CONFIG_ERROR = !DEMO_MODE && !(url && key);

// Кнопка «Продолжить с Google» показывается только после настройки провайдера в Supabase:
// VITE_GOOGLE_AUTH=true в переменных Vercel.
export const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH === "true";

// Консультация специалиста (миграции 016–017) и доп. услуги (018) включаются ТОЛЬКО после того,
// как эти миграции применены к базе окружения: VITE_SPECIALIST_CONSULT=true, VITE_ADDONS=true.
// Пока флаг выключен, сайт работает по-старому и не обращается к новым функциям базы.
export const SPECIALIST_CONSULT_ENABLED = import.meta.env.VITE_SPECIALIST_CONSULT === "true";
export const ADDONS_ENABLED = import.meta.env.VITE_ADDONS === "true";

// Версии юридических документов. Меняйте при каждом обновлении текстов Terms / Refund Policy:
// версия сохраняется вместе с согласием клиента.
export const LEGAL_VERSIONS = {
  terms: "2026-09-draft",
  refund: "2026-09-27-draft-013-015",
} as const;
