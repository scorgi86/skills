# Architecture Report Template

Форма комплексного отчёта об устройстве механизма: как устроено, кем используется, какие сценарии, типовые пути движения значения. Применяйте её, когда запрос звучит как «комплексное представление», «как устроено и кем используется», «пути от действия до отрисовки» — то есть нужна архитектурная сводка по механизму, а не только решение о доработке.

Принцип неизменен: канонический источник фактов — модель Stage 7 (`inventory-report-model/2.0.0`); эта форма задаёт, какие коллекции модели наполнять и как их narration-ировать. Markdown — проекция; новые факты во время написания отчёта добавлять запрещено — только через ревизию этапов.

## Соответствие разделов коллекциям модели

| # | Раздел отчёта | Источник в модели | Что требуется авторить на Stage 7 |
|---|---|---|---|
| 1 | Резюме | executiveSummary, decisionStatus, coverage | краткое описание механизма и слоёв |
| 2 | Архитектурная карта по слоям | ownership, dictionary, canonicalEvidence | строки «слой → файл → роль»; для подсистем перечислить файлы явно |
| 3 | Модель данных и владение | ownership, ownershipGraph | цепочку владения порядками 0→N с якорями полей значения |
| 4 | Кто использует | recipientFamilies | семейства получателей; для каждого — подтверждённая или candidate-привязка к сценарию |
| 5 | Пользовательские и системные сценарии | scenarios | 1 строка на сценарий: entry, steps, result, evidenceRefs |
| 6 | Типовые пути движения значения | criticalPaths + scenarios + usages | путь как критический путь: statement + шаги-якоря; нейтральные usages по R1–R4 |
| 7 | Словарь имён между слоями | dictionary | подтверждённые термины каждого слоя |
| 8 | Пробелы, ограничения | gaps, checkedNoUsage, limitations, notApplicable | пробелы только с протоколом отсутствия; N/A только с reasonCode |
| 9 | Источники и воспроизведение | provenance, integrity, manifest Stage 8 | пути к моделям, манифестам, пакету |

## Чек-лист авторинга research-пакета

1. `coverageProfile.kind: "full-inventory"` с 13 requiredCapabilities и `requiredCollections: ["scenarios", "criticalPaths"]` — полнота обязательна, bounded не выбирать из-за нехватки доказательств.
2. Семена Stage 0 покрывают все имена словаря (формат файла, модель, API, defaults); valueFlow для полного профиля включается по умолчанию, явный `valueFlow: { enabled: false }` допустим, если структурная трассировка не нужна в этом отчёте.
3. Stage 5: целевые проверки с авторскими подтверждениями (id проверки = alias evidence) и absence-проверки (`absenceClaim: true`) для каждого аспекта, закрываемого отсутствием; строки `gaps`/`checkedNoUsage`/capability-строки обязаны повторять поля absence-evidence побайтно (repository, searchScope, reason, consequence, expectedNames, performedChecks, ordersChecked, linkingMethodsChecked).
4. Stage 7: capabilities по IDS (13/13 терминально), scenarios с entry/steps/result, implementationEntryPoints по слоям (существующие точки; ссылка на evidence + сценарий/capability), usages по правилам R1–R4 (`references/report-contract.md`), критические пути со statement.
5. Проверка соответствия пакету и ограничениям полей — `loadResearchPackage`/FORBIDDEN в `scripts/flows/full-flow/src/full_run.js`.

## Структура итогового документа

Разделы 1–9 в порядке таблицы выше. Требования к форме:

- Раздел 6 — ядро отчёта: каждый путь — нумерованная цепочка шагов `файл:строка — действие`, со статусом критического пути; путь без подтверждённого звена не публикуется как confirmed.
- Каждое утверждение любого раздела ведёт к якорю из `evidence.md`.
- Ограничения (раздел 8) формулируются честно: «готовность продукта не оценивалась», «reference не проводился», candidate-получатели отделяются от confirmed.
- Живой пример формы и наполнения: `inventory-artifacts/full-inventory-inner-shadows-20260923/comprehensive-report.md` (срезы сентября и июля, 7 usages, 13/13 capabilities).

## Эталонный пакет

`fixtures/research-package/full-inventory-inner-shadows-example.json` — работающий пакет полного исследования (inner shadows, полный цикл Stage 0–8 closed на обоих срезах source). Используйте его как образец структуры authored-строк: capabilities, scenarios, implementationEntryPoints, gaps с absence-протоколом, confirmedUsages. Пути репозиториев и якоря в примере привязаны к конкретному checkout — для новой цели их пересобирают под свой source, сохраняя форму строк.
