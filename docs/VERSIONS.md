# Версии и откат

Каждый шаг доработки — отдельный коммит с тегом. К любому можно вернуться.

| Тег | Что внутри |
| --- | --- |
| `v0-chatgpt` | Исходная версия от ChatGPT (архив 23.09.2026) |
| `v1-step1-database` | Шаг 1: миграция 002 — оплата, согласие, владельцы, данные компании, типы документов, ручная проверка, хранение паспортов |
| `v4-supabase` | Шаг 4: база развёрнута в Supabase (проект taxpasso, Франкфурт), миграция 004 по итогам советника безопасности |
| `v3-vercel` | Шаг 3: настройка Vercel (маршруты SPA, заголовки безопасности) |
| `v2-step2-fixes` | Шаг 2: явный демо-режим, экран ошибки настройки, сохранение согласия, выбор страны из списка, тип «паспорт» при загрузке, миграция 003 (лимит анкеты, отказ по ITIN с причиной) |

## Загрузить на GitHub (один раз)

1. На github.com нажмите **New repository**, назовите `taxpasso`, выберите **Private**, НЕ добавляйте README.
2. В папке проекта выполните:

```bash
git remote add origin https://github.com/<ваш-логин>/taxpasso.git
git push -u origin --all
git push origin --tags
```

## Откатить код

```bash
git log --oneline          # список версий
git checkout v0-chatgpt    # посмотреть старую версию
git checkout main          # вернуться к актуальной
```

Отменить шаг навсегда (с сохранением истории): `git revert <коммит>`.

## Откатить базу данных

У каждой миграции есть файл отката в `supabase/rollback/`.
Сначала сделайте бэкап базы (Supabase → Database → Backups), затем выполните файл отката в SQL Editor.
Откат удаляет данные новых таблиц.

| Миграция | Откат |
| --- | --- |
| `002_foundation.sql` | `rollback/002_foundation_down.sql` |
| `003_limits_eligibility.sql` | `rollback/003_limits_eligibility_down.sql` |
| `004_revoke_trigger_functions.sql` | `rollback/004_revoke_trigger_functions_down.sql` |

Откатывайте в обратном порядке: 004 → 003 → 002.

## Переменные окружения (с версии v2)

| Переменная | Значение |
| --- | --- |
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_ANON_KEY` | публичный anon key (НЕ service role) |
| `VITE_DEMO_MODE` | `true` — демо без базы, только для превью. В продакшене не указывать |

Если демо выключено, а ключей нет, сайт показывает «Технические работы» и не принимает заявки.

## Деплой на Vercel (с версии v3)

1. vercel.com → Add New → Project → импортировать репозиторий `taxpasso` с GitHub.
2. Framework: Vite (подхватится из `vercel.json`).
3. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `VITE_DEMO_MODE` не добавлять.
4. Deploy. Каждый `git push` в `main` будет автоматически публиковать новую версию.
5. В Supabase → Authentication → URL Configuration: Site URL = адрес сайта на Vercel, Redirect URLs = `https://<адрес>/**`.

## Supabase (с версии v4)

- Проект: `taxpasso`, ref `mhjxjxteorjwkvqbznfl`, регион eu-central-1 (Франкфурт), бесплатный тариф.
- URL: `https://mhjxjxteorjwkvqbznfl.supabase.co`
- Применены миграции 001–004.
- 27 сценариев безопасности пройдены на реальной базе (с откатом тестовых данных): роли, RLS, оплата, согласие, владельцы, ручная проверка, ITIN.
- Откат 003 → 002 проверен в транзакции: база возвращается к состоянию 001.
- Хранилище файлов (Storage) через API ещё не проверено — после деплоя загрузите тестовый файл.

## Vercel (с версии v5)

- Проект: `taxpasso` (prj_T41Ef7U3umv83ue5dzh7KcDSnT2n), команда taxpasso.
- Основной адрес: https://taxpasso-taxpasso.vercel.app
- Первый деплой сделан напрямую через Vercel API из версии `v4-supabase` (сборка прошла, статус READY).
- Переменные окружения заданы в проекте: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable key).
- Защита Vercel Authentication — только для preview-версий; production открыт.
- Установка зависимостей: `npm install` (package-lock.json в деплой не передавался).
- TODO: подключить GitHub-репозиторий в Vercel → Settings → Git, чтобы каждый push публиковался автоматически.
