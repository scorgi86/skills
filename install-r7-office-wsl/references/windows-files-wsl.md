# Файлы Windows и R7 Office в WSL

WSL подключает готовые каталоги Windows `Editors/editors/sdkjs` и `Editors/editors/web-apps` через временные bind. Пакетные ресурсы сохраняются под монтированиями. Сборка файлов выполняется отдельно.

Основной вход — готовый `scripts/prepare-wsl.ps1`. `wsl-dev.ps1` используется для отдельных действий. Не создавай скрипты при выполнении навыка.

## Подключение

Для полного потока используй один дочерний процесс; без PackagePath пакет должен быть уже установлен:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$skill/scripts/prepare-wsl.ps1" -Distro $distro -LinuxUser $linuxUser -WorkspaceRoot $workspace -PackagePath $package
```

`Preflight` проверяет готовые Windows-файлы до установки пакета. `summary.json` содержит итог, пропуски, коды/время этапов и read-only снимок mount. Ошибка не скрывает ранее выполненные изменения. Повторный вызов восстанавливает полный поток с использованием идемпотентных действий. Установку пакета назад автоматически не откатывает.

Определи Windows-корень рабочего окружения с каталогом `Editors`, WSL-дистрибутив и обычного Linux-пользователя до установки. Этот раздел продолжает единый поток сразу после пакетной verification: `Alias → Enable → Verify`. Успех установки пакета не завершает поток.

В примерах `$skill` — абсолютный путь к навыку, `$workspace` — Windows-корень, `$distro` — выбранный дистрибутив, `$linuxUser` — пользователь приложения.

После установки добавь алиас запуска в `~/.bashrc` выбранного пользователя:

```powershell
& "$skill/scripts/wsl-dev.ps1" -Action Alias -WorkspaceRoot $workspace -Distro $distro -LinuxUser $linuxUser
```

Повторный вызов не дублирует запись. В новом Bash-терминале WSL запускай `dev-r7-office`; для текущего терминала сначала выполни `source ~/.bashrc`. Алиас запускает приложение с `--ascdesktop-support-debug-info`. Для работы с Windows-файлами сначала подключи каталоги:

```powershell
& "$skill/scripts/wsl-dev.ps1" -Action Inspect -WorkspaceRoot $workspace -Distro $distro -LinuxUser $linuxUser
& "$skill/scripts/wsl-dev.ps1" -Action Enable -WorkspaceRoot $workspace -Distro $distro -LinuxUser $linuxUser
& "$skill/scripts/wsl-dev.ps1" -Action Verify -WorkspaceRoot $workspace -Distro $distro -LinuxUser $linuxUser
```

`Enable` требует закрытого редактора и готовых файлов, проверяет конфликты, запускает keeper WSL и откатывает созданные монтирования при сбое. `Verify` проверяет пакет, библиотеки, доступ пользователя, соответствие источников и контрольные файлы. Если готовых файлов нет, сообщи, что их нужно подготовить отдельно.

Запусти приложение, если запуск входит в запрос:

```powershell
& "$skill/scripts/wsl-dev.ps1" -Action Launch -WorkspaceRoot $workspace -Distro $distro -LinuxUser $linuxUser
```

## Работа и отключение

После обновления файлов Windows полностью закрой R7 Office и повтори `Launch`. Скрипт не завершает приложение автоматически.

Перед пакетными изменениями закрой редактор и отключи окружение:

```powershell
& "$skill/scripts/wsl-dev.ps1" -Action Disable -WorkspaceRoot $workspace -Distro $distro -LinuxUser $linuxUser
```

После остановки WSL повтори `Enable` и `Verify`. Не используй принудительное отключение занятого mount. Состояние хранится в `%LOCALAPPDATA%/R7-Office/wsl-dev`; сохраняй его до `Disable`. При частичном отключении keeper сохраняется; устрани занятость каталога и повтори `Disable`.

Сообщи пути, дистрибутив, пользователя, результаты проверки и команду повторного запуска. Отдельно укажи результат GUI-проверки.

## Проверка скриптов при доработке навыка

Mock-тесты выполняй в отдельном процессе:

```powershell
powershell.exe -NoProfile -File "$skill/scripts/tests/self-test.ps1"
powershell.exe -NoProfile -File "$skill/scripts/tests/child-test.ps1"
powershell.exe -NoProfile -File "$skill/scripts/tests/prepare-test.ps1"
```

Для реальной проверки подключений используй `scripts/tests/deployment-test.ps1 -Distro $distro -LinuxUser $linuxUser`, когда запрос включает такую проверку. Он требует установленного R7, создаёт изолированные каталоги, проверяет bind и keeper, затем отключает и очищает их. Пакетные ресурсы и GUI не изменяет. При неудачном отключении сохраняет каталоги и состояние для восстановления.

`scripts/tests/alias-test.sh` проверяет алиас в временном HOME обычного пользователя через runuser, не изменяя профиль разработчика. Mock-тесты не доказывают live установку или GUI.
