// Демо-режим включается ТОЛЬКО явно: VITE_DEMO_MODE=true.
// Если демо выключено, а ключей Supabase нет — сайт показывает ошибку настройки,
// а не молча притворяется, что сохраняет заявки.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
export const SUPABASE_URL = url || "";
export const SUPABASE_ANON_KEY = key || "";
export const CONFIG_ERROR = !DEMO_MODE && !(url && key);

// Версии юридических документов. Меняйте при каждом обновлении текстов Terms / Refund Policy:
// версия сохраняется вместе с согласием клиента.
export const LEGAL_VERSIONS = {
  terms: "2026-09-draft",
  refund: "2026-09-draft",
} as const;
