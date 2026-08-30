# Делегированное ревью

Делегат проверяет назначенный срез и возвращает доказательства координатору. Он не отвечает за полноту всей ветки и не выносит глобальный вердикт. Имена полей и термины `packet`, `scope_status`, `finding`, `file_ref`, `code_ref`, `source_ref` и `search_scope_ref` являются частью контракта; пояснения остаются русскими.

## Канонические ссылки

Каждая ссылка на репозиторий использует `repository_id`, уникальный внутри packet.

```yaml
file_ref:
  repository_id: sdkjs
  path: packages/metrics/service.ts

code_ref:
  repository_id: sdkjs
  path: packages/metrics/service.ts
  start_line: 87        # optional
  end_line: 92          # optional
  symbol: calculate     # optional
```

`code_ref` ссылается только на существующий файл и существующую строку или symbol. Для доказательства отсутствующей реализации его не выдумывать.

Источник требования задаётся `source_ref` одного из видов:

```yaml
- kind: repository
  code_ref: { repository_id: sdkjs, path: docs/brief.md, start_line: 20 }
- kind: attachment
  source_id: S-002
  section: "4.1"
- kind: url
  url: https://example.test/spec
  section: API contract
- kind: task
  source_id: TASK
  section: Acceptance criteria
```

Проверенную область поиска отсутствующей реализации задаёт `search_scope_ref`:

```yaml
id: AS-001
repository_id: sdkjs
path_prefix: packages/metrics
component: MetricsService       # optional
symbols: [ApprovalTimeline]     # optional
queries: [approval_state]       # фактически выполненные запросы или patterns
```

`search_scope_ref` содержит `repository_id` и хотя бы одно из `path`, `path_prefix`, `component` или `symbols`. Он описывает фактически проверенную область, а не несуществующую строку кода.

Область проверки существующего поведения вне changed files задаёт `inspection_scope_ref`:

```yaml
id: IS-001
repository_id: sdkjs
path_prefix: packages/metrics
component: MetricsService     # optional
symbols: [calculateMetrics]   # optional
```

`inspection_scope_ref` содержит `repository_id` и хотя бы одно из `path`, `path_prefix`, `component` или `symbols`.

## Проверить review packet

Если доступен fast path и packet не содержит непустой `materialized_diff`, вызвать `validate-packet` из [правил автоматизации](automation.md) до семантического исследования. При успехе не повторять вручную schema, duplicate и dangling-ref checks. Локальную repository identity и snapshots проверить отдельно: для каждого repository вызвать `snapshot` с boundaries packet. Remote freshness не подтверждать.

Packet обязан содержать:

- уникальный `assignment_id`;
- непустой список repositories с уникальными `repository_id`, локальным path и sanitized canonical remote;
- для каждого repository полные `base_sha`, `head_sha`, `merge_base_sha`, `diff_from_sha`, `diff_to_sha` и однозначный `diff_semantics`, например `merge-base-to-head`;
- непустой список requirements с уникальными ID, criterion, constraints и `source_ref`;
- непустую область назначения хотя бы одного вида: `changed_files`, `inspection_scope` или `absence_search_scope`;
- semantic scope как необязательный routing hint;
- hard exclusions и permissions для исполняемой верификации.

`changed_files` содержит уникальные `file_ref`. `inspection_scope` содержит `inspection_scope_ref` с уникальными ID для проверки реализации вне diff, contracts, consumers или неприменимости. `absence_search_scope` содержит `search_scope_ref` с уникальными ID для доказательства отсутствующей реализации.

Если приложен materialized diff, он дополняет, а не заменяет immutable boundaries:

```yaml
materialized_diff:
  digest_algorithm: sha256
  digest: <digest>
  manifest_digest_algorithm: sha256
  manifest_digest: <digest>
```

Каждый `file_ref`, `code_ref`, `inspection_scope_ref` и `search_scope_ref` обязан ссылаться на `repository_id` из packet. Одинаковый path в разных repositories обозначает разные объекты. Duplicate repository IDs, Requirement IDs, exact `file_ref`, inspection scope IDs или search scope IDs делают packet невалидным.

Локально проверить repository identity, существование Git-объектов, границы diff и, если приложен materialized diff, его digest и manifest digest. Не подтверждать актуальность remote: за неё отвечает координатор.

Если обязательное поле отсутствует, все assignment scopes пусты, identity не совпадает, встречается неизвестный или повторный ID/ref, Git-объект недоступен либо digest не совпадает, вернуть `scope_status=blocked` с `missing`/`invalid`. Не выполнять remote query, fetch или fallback в полное ревью.

## Исследовать назначенный срез

`changed_files` — обязательное ядро, когда оно передано, но не граница read-only исследования. Разрешённая граница задаётся repositories и immutable snapshots из packet. Semantic scope является указателем маршрута, а не запретом.

Для каждого назначенного требования:

1. Исследовать назначенные изменения, inspection scope или absence search scope и фактическое поведение.
2. Проследить определения, callers, consumers и тесты до наблюдаемой точки.
3. Читать необходимые файлы внутри разрешённых repositories/snapshots; каждый выход за назначенную область фиксировать в `scope_expansions` с repository-qualified added scope, причиной и затронутыми Requirement IDs.
4. Установить статус требования и достаточность доказательств.
5. Выполнить только разрешённые targeted checks по правилам безопасной верификации.

Перед углублённым исследованием связать назначенные requirements с changed files/scopes и выбрать применимые риски. Consumer search начинать с непосредственных definitions/callers/tests, расширять при изменении публичного или межрепозиторного контракта либо передаче поведения дальше и останавливать на наблюдаемой границе. Идентичный отрицательный search scope выполнять один раз и связывать со всеми применимыми Requirement IDs.

Если обязательный consumer требует repository/snapshot вне packet или нарушает `hard_exclusion`, не исследовать его самостоятельно. Создать `scope_request` с `requested_scope_ref`, причиной и `requirement_ids`. Присвоить затронутым требованиям `невозможно подтвердить`. Если уже доказан defect или implementation gap, сохранить `scope_status=failed` и gap в `unresolved`; иначе использовать `scope_status=blocked`.

`requested_scope_ref` является единственным ref-типом, который может обозначать repository вне packet:

```yaml
requested_scope_ref:
  requested_repository_id: web-apps
  canonical_remote: <known sanitized remote>  # optional
  snapshot: <known immutable boundaries>       # optional
  path_prefixes: [packages/consumer]           # optional
  components: [ConsumerService]                # optional
  symbols: [readMetrics]                       # optional
  whole_repository: false                      # true для явного запроса всего repository
```

Он содержит известную repository identity и хотя бы одну запрошенную область либо `whole_repository: true`. Наличие `requested_scope_ref` не разрешает чтение или fetch; новый repository становится доступен только после нового packet координатора.

## Доказательства и локальные статусы

Статусы требований: `реализовано`, `частично реализовано`, `не реализовано`, `реализовано с отклонением`, `невозможно подтвердить`, `не применимо`. Достаточность: `достаточно`, `частично`, `недостаточно`.

Каждая запись requirement status содержит уникальный `id` из requirements packet. Findings и scope structures связываются с требованиями через `requirement_ids`; provenance каждого требования хранится только в его `source_ref` в packet. Утверждение о существующем коде содержит `evidence_refs` из `code_ref`. Утверждение об отсутствии реализации содержит проверенные `search_scope_refs` или ссылки на ID из `absence_search_scope`. Текстовое evidence объясняет вывод, но не заменяет структурированные ссылки.

Определить `scope_status`:

- `failed` — есть defect, implementation gap либо статус `частично реализовано`, `не реализовано` или `реализовано с отклонением`, даже при других gaps;
- `blocked` — finding не доказан, но хотя бы одно требование невозможно подтвердить из-за обязательного gap;
- `passed` — все требования имеют статус `реализовано` с достаточными доказательствами либо доказанно `не применимо`; обязательных gaps и findings нет.

`passed` запрещён при частичных или недостаточных доказательствах. Finding имеет приоритет над ограничениями.

## Findings

Дефект существующей реализации:

```yaml
- local_id: F-001
  kind: defect
  priority: P1
  requirement_ids: [R-004]
  contract_refs: []
  location: { repository_id: sdkjs, path: packages/metrics/service.ts, start_line: 87 }
  evidence_refs:
    - { repository_id: sdkjs, path: packages/metrics/service.ts, start_line: 87, end_line: 92 }
  reachable_scenario: Описание достижимого сценария
  impact: Наблюдаемое последствие
  evidence: Краткое объяснение доказательств
```

Пробел реализации:

```yaml
- local_id: F-002
  kind: implementation_gap
  priority: P1
  requirement_ids: [R-005]
  search_scope_refs: [AS-001]
  evidence_refs: []        # только существующая частичная реализация или эталонный путь
  absence_evidence: Где и по каким признакам искали, что найдено
  expected_owner:
    kind: repository       # repository | external | unknown
    repository_id: sdkjs
    component: MetricsService
  impact: Последствие пробела
```

Для `expected_owner.kind=external` использовать optional `identity`; для `unknown` не выдумывать repository. Устойчивый finding key равен `<assignment_id>:<local_id>`. Глобальные Finding IDs назначает координатор.

## Compact handoff

Вернуть только структурированный handoff. Все code-related элементы `reviewed_files`, `discovered_consumers`, `scope_expansions`, `unresolved`, `verification` и `limitations` используют `file_ref`, `code_ref`, `inspection_scope_ref`, `search_scope_ref` или `source_ref`, а не bare path в свободном тексте. Внешний `scope_request` использует `requested_scope_ref` и не считается разрешённой ссылкой packet.

```yaml
assignment_id: metrics-contract
scope_status: failed
snapshot_echo:
  repositories:
    - repository_id: sdkjs
      canonical_remote: <проверенная identity без заявления freshness>
      base_sha: <full SHA>
      head_sha: <full SHA>
      merge_base_sha: <full SHA>
      diff_from_sha: <full SHA>
      diff_to_sha: <full SHA>
      diff_semantics: merge-base-to-head
      materialized_diff: null   # либо проверенные digest metadata
requirement_statuses:
  - id: R-004
    status: реализовано
    evidence_sufficiency: достаточно
    evidence_refs:
      - { repository_id: sdkjs, path: packages/metrics/service.ts, start_line: 87 }
    search_scope_refs: []
    evidence: Краткое проверяемое основание
findings: []
reviewed_files: []
discovered_consumers: []
scope_expansions: []
scope_requests: []
unresolved: []
verification: []
limitations: []
```

В `snapshot_echo` возвращать только фактически проверенные identity, boundaries и digest; не заявлять remote freshness. Не выводить глобальные заголовки `ПРОХОДИТ ПРОВЕРКУ`, `НЕ ПРОХОДИТ ПРОВЕРКУ` или `ПРОВЕРКА НЕ ЗАВЕРШЕНА`.

Полное evidence записывать один раз в requirement status или finding; остальные элементы handoff связывать refs и кратким основанием, не повторяя рассуждение. Handoff формировать после закрытия назначенных requirements и scopes.
