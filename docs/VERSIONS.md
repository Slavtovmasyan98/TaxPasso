# Версии и откат

Каждый шаг доработки — отдельный коммит с тегом. К любому можно вернуться.

| Тег | Что внутри |
| --- | --- |
| `v0-chatgpt` | Исходная версия от ChatGPT (архив 23.09.2026) |
| `v1-step1-database` | Шаг 1: миграция 002 — оплата, согласие, владельцы, данные компании, типы документов, ручная проверка, хранение паспортов |

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
