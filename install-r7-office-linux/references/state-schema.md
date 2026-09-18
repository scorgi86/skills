# Результаты скриптов

Обычная установка не использует состояние инспекции или базу approvals. Без `--state-dir` операция создаёт root-каталог `/var/tmp/r7-office.<random>` с правами 0700. Переданный каталог проверяется на владельца, симлинки и права; пользовательское состояние не использовать для root-операций.

`operation.json`: `run_id`, `stage`, `status`, `mode`, `backend`, `result`, `package` (name/version/architecture/format/sha256), `logs.operation`. SHA-256 заполнен только при заданном expected hash. `logs.operation` — абсолютный путь. Ошибки входа до получения метаданных могут завершиться без JSON; точный код и stderr обязательны.

`environment.json`, `package.json` дополнительного аудита и `verification.json` сохраняют существующий schema_version 1. Audit `required_approvals` описывает действия обнаруженных скриптов и доверие; эти данные не передаются обычной установке. Отдельная ручная configure-integration принимает только конкретные `--approved-action`.

| Код | Значение |
|---:|---|
| 0 | Успех |
| 10 | Требуется конкретное ручное действие/решение аудита |
| 20 | Не поддерживается формат, backend или окружение |
| 30 | Не выполнены предпосылки |
| 40 | Ошибка пакетного менеджера |
| 50 | Не пройдена проверка установки |
| 60 | Ошибка заданного хеша или подписи при аудите |
| 70 | Небезопасный каталог или lock |

WSL adapter возвращает код native этапа; stdout содержит JSON, stderr — диагностику и путь каталога. Вызывать в дочернем процессе из-за `exit`.

WSL coordinator возвращает 0/1 и пишет `summary.json`: итоговый Status, FailedStage/Error, цель и версия, PackageOperation, MountState, фактические Mounts, LinuxStateDirectory, Stages с Name/Status/ExitCode/Seconds/Stdout/Stderr. Skipped этапы имеют null code/time; реальное время содержит transport overhead. Mounts — read-only снимок ядра после потока; absent mount не является ошибкой снимка. ModelTokens/ModelInferenceSeconds остаются null. Логи хранят полный вывод отдельно от JSON.
