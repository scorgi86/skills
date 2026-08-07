#!/usr/bin/env python3
"""Persist and validate the mechanical state of a requirements review."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

STATE_FILE = "case.json"
SCHEMA_VERSION = 1
SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SCOPES = {"IN_SCOPE", "OUT_OF_SCOPE_BY_MODE", "OUT_OF_SCOPE_BY_CONTENT"}
AVAILABILITY = {"AVAILABLE", "NOT_PROVIDED_TO_AGENT", "TECHNICALLY_UNREADABLE", "CONFIRMED_ABSENT_FROM_REQUIREMENTS_PACKAGE"}
FINAL_RESOLUTIONS = {"REVIEWED", "EXCLUDED_WITH_REASON", "BLOCKING_FINDING_CREATED"}
EVIDENCE_KINDS = {"PACKAGE_INVENTORY", "USER_EVENT"}
AUTHOR_PLACEHOLDER = "<фамилия и имя или полное ФИО>"


class StateError(Exception):
    pass


def now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def text_hash(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def file_hash(path: Path) -> str:
    if not path.is_file():
        raise StateError(f"Файл не найден: {path}")
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def safe_id(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return result or "case-" + text_hash(value).removeprefix("sha256:")[:12]


def state_file(state_dir: str) -> Path:
    return Path(state_dir).resolve() / STATE_FILE


def load(state_dir: str) -> tuple[Path, dict[str, Any]]:
    path = state_file(state_dir)
    if not path.is_file():
        raise StateError(f"Состояние не инициализировано: {path}")
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise StateError(f"Некорректный JSON состояния: {error}") from error
    if state.get("schemaVersion") != SCHEMA_VERSION:
        raise StateError("Неподдерживаемая версия схемы состояния.")
    return path, state


def save(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def observation_hash(source: dict[str, Any]) -> str:
    return text_hash("\n".join([source["sourceId"], source["scope"], source["availability"], source.get("reason", ""), source.get("discoveryRef", "")]))


def expected_resolution(source: dict[str, Any]) -> str:
    if source["scope"].startswith("OUT_OF_SCOPE_"):
        return "EXCLUDED_WITH_REASON"
    if source["availability"] == "AVAILABLE":
        return "PENDING_REVIEW"
    if source["availability"] in {"NOT_PROVIDED_TO_AGENT", "TECHNICALLY_UNREADABLE"}:
        return "INPUT_REQUIRED"
    return "BLOCKING_FINDING_CREATED"


def source_by_id(state: dict[str, Any], source_id: str) -> dict[str, Any]:
    for source in state["sources"]:
        if source["sourceId"] == source_id:
            return source
    raise StateError(f"Источник не найден: {source_id}")


def stale_current(state: dict[str, Any], reason: str) -> bool:
    current = state.get("currentArtifactId")
    if not current:
        return False
    artifact = next((item for item in state["artifacts"] if item["artifactId"] == current), None)
    if not artifact:
        raise StateError("Текущий artifact отсутствует в журнале.")
    artifact["status"] = "STALE"
    artifact["staleReason"] = reason
    state["currentArtifactId"] = None
    return True


def next_run(state: dict[str, Any]) -> None:
    state["runNumber"] += 1
    state["currentRunId"] = f"run-{state['runNumber']}"


def policy_errors(snapshot: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for policy in snapshot.get("policyRevisions", []):
        path = Path(policy["path"])
        if not path.is_file():
            errors.append(f"Policy-файл недоступен: {path}")
        elif file_hash(path) != policy["revision"]:
            errors.append(f"Policy-файл изменился: {path}")
    return errors


def evidence_revision(kind: str, statement: str, active: bool) -> str:
    return text_hash("\n".join([kind, statement, str(active).lower()]))


def parse_evidence_ref(value: str) -> tuple[str, str]:
    artifact_id, separator, revision = value.partition("@")
    if not separator or not artifact_id or not SHA256_RE.fullmatch(revision):
        raise StateError("evidenceRef должен иметь формат <evidenceArtifactId>@sha256:<64 hex>.")
    return artifact_id, revision


def evidence_ref_errors(state: dict[str, Any], values: list[str], expected_kind: str | None = None) -> list[str]:
    errors: list[str] = []
    artifacts = {item["evidenceArtifactId"]: item for item in state.get("evidenceArtifacts", [])}
    for value in values:
        try:
            artifact_id, revision = parse_evidence_ref(value)
        except StateError as error:
            errors.append(str(error))
            continue
        artifact = artifacts.get(artifact_id)
        if not artifact or not artifact.get("active") or artifact.get("revision") != revision:
            errors.append(f"Недействительное доказательное событие: {value}")
        elif expected_kind and artifact.get("kind") != expected_kind:
            errors.append(f"Доказательство {value} имеет недопустимый kind.")
    return errors


def validate_map(state: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not state["sources"]:
        errors.append("Реестр источников пуст.")
    ids = [source.get("sourceId") for source in state["sources"]]
    if len(set(ids)) != len(ids):
        errors.append("sourceId должны быть уникальны.")
    known_ids = set(ids)
    for source in state["sources"]:
        label = source.get("sourceId", "<без sourceId>")
        if source.get("scope") not in SCOPES or source.get("availability") not in AVAILABILITY:
            errors.append(f"{label}: некорректные scope или availability.")
            continue
        if source.get("observationRevision") != observation_hash(source):
            errors.append(f"{label}: observationRevision не соответствует источнику.")
        revision = source.get("contentRevision")
        if source["availability"] == "AVAILABLE":
            if not revision or not SHA256_RE.fullmatch(revision):
                errors.append(f"{label}: AVAILABLE требует корректный contentRevision.")
            if source.get("contentPath"):
                path = Path(source["contentPath"])
                if not path.is_file():
                    errors.append(f"{label}: файл больше недоступен; выполните invalidate.")
                elif file_hash(path) != revision:
                    errors.append(f"{label}: файл изменился; выполните invalidate.")
        elif revision:
            errors.append(f"{label}: недоступный источник не должен иметь contentRevision.")
        resolution = source.get("resolution")
        if resolution not in {expected_resolution(source), "REVIEWED"}:
            errors.append(f"{label}: resolution несовместим с состоянием источника.")
        if resolution == "REVIEWED":
            evidence = source.get("reviewEvidence") or {}
            if source["scope"] != "IN_SCOPE" or source["availability"] != "AVAILABLE":
                errors.append(f"{label}: REVIEWED допустим только для IN_SCOPE + AVAILABLE.")
            if evidence.get("contentRevision") != revision or not evidence.get("processedParts"):
                errors.append(f"{label}: REVIEWED требует актуальный reviewEvidence с обработанными частями.")
            if evidence.get("method") not in {"MAIN_READ", "DELEGATED_EXTRACTION_VERIFIED"}:
                errors.append(f"{label}: неизвестный способ разбора.")
            if evidence.get("method") == "DELEGATED_EXTRACTION_VERIFIED" and not evidence.get("verifiedByMainAgent"):
                errors.append(f"{label}: результат субагента не подтверждён основным агентом.")
            for found in evidence.get("discoveredSourceIds", []):
                if found not in known_ids:
                    errors.append(f"{label}: обнаруженная ссылка {found!r} не зарегистрирована.")
        if source["availability"] == "CONFIRMED_ABSENT_FROM_REQUIREMENTS_PACKAGE":
            if not source.get("evidenceRef"):
                errors.append(f"{label}: подтверждённое отсутствие требует evidenceRef.")
            else:
                errors.extend(f"{label}: {error}" for error in evidence_ref_errors(state, [source["evidenceRef"]]))
        if source.get("url") and source.get("requiredMockup") and resolution == "REVIEWED" and not source.get("contentPath"):
            errors.append(f"{label}: обязательный макет по URL требует доступный срез содержимого.")
    return errors


def init_case(args: argparse.Namespace) -> dict[str, Any]:
    path = state_file(args.state_dir)
    if path.exists():
        raise StateError(f"Состояние уже существует: {path}")
    state = {"schemaVersion": SCHEMA_VERSION, "reviewCaseId": safe_id(args.case_id or args.title), "title": args.title, "createdAt": now(), "runNumber": 1, "currentRunId": "run-1", "sources": [], "evidenceArtifacts": [], "snapshots": [], "artifacts": [], "currentArtifactId": None}
    save(path, state)
    return {"reviewCaseId": state["reviewCaseId"], "runId": state["currentRunId"], "stateFile": str(path)}


def add_source(args: argparse.Namespace) -> dict[str, Any]:
    path, state = load(args.state_dir)
    source_id = safe_id(args.source_id)
    if any(item["sourceId"] == source_id for item in state["sources"]):
        raise StateError(f"Источник уже зарегистрирован: {source_id}")
    selected_file = args.file or args.content_file
    if args.availability == "AVAILABLE" and not selected_file:
        raise StateError("Для AVAILABLE источника укажите --file или --content-file.")
    if args.availability != "AVAILABLE" and selected_file:
        raise StateError("Файл содержимого допустим только для AVAILABLE источника.")
    content_path = str(Path(selected_file).resolve()) if selected_file else None
    source = {"sourceId": source_id, "displayName": args.display_name or source_id, "discoveryRef": args.discovery_ref or "", "scope": args.scope, "availability": args.availability, "reason": args.reason or "", "evidenceRef": args.evidence_ref, "url": args.url, "requiredMockup": args.required_mockup, "contentPath": content_path, "contentRevision": file_hash(Path(content_path)) if content_path else None, "resolution": "", "reviewEvidence": None}
    source["observationRevision"] = observation_hash(source)
    source["resolution"] = expected_resolution(source)
    state["sources"].append(source)
    if stale_current(state, f"Добавлен источник {source_id}."):
        next_run(state)
    save(path, state)
    return {"sourceId": source_id, "contentRevision": source["contentRevision"], "resolution": source["resolution"], "runId": state["currentRunId"]}


def update_source(args: argparse.Namespace) -> dict[str, Any]:
    path, state = load(args.state_dir)
    source = source_by_id(state, args.source_id)
    before = copy.deepcopy(source)
    availability = args.availability or source["availability"]
    scope = args.scope or source["scope"]
    selected_file = args.file or args.content_file
    if args.file and args.content_file:
        raise StateError("Укажите только один из --file или --content-file.")
    if availability == "AVAILABLE":
        content_path = str(Path(selected_file).resolve()) if selected_file else source.get("contentPath")
        if not content_path:
            raise StateError("Для AVAILABLE источника укажите --file или --content-file.")
        content_revision = file_hash(Path(content_path))
    else:
        if selected_file:
            raise StateError("Файл содержимого допустим только для AVAILABLE источника.")
        content_path = None
        content_revision = None
    source["scope"] = scope
    source["availability"] = availability
    source["displayName"] = args.display_name if args.display_name is not None else source["displayName"]
    source["discoveryRef"] = args.discovery_ref if args.discovery_ref is not None else source["discoveryRef"]
    source["reason"] = args.reason if args.reason is not None else source["reason"]
    source["evidenceRef"] = args.evidence_ref if args.evidence_ref is not None else source.get("evidenceRef")
    source["url"] = args.url if args.url is not None else source.get("url")
    source["requiredMockup"] = args.required_mockup if args.required_mockup is not None else source.get("requiredMockup", False)
    source["contentPath"] = content_path
    source["contentRevision"] = content_revision
    source["reviewEvidence"] = None
    source["resolution"] = expected_resolution(source)
    source["observationRevision"] = observation_hash(source)
    if source != before and stale_current(state, f"Обновлён источник {source['sourceId']}."):
        next_run(state)
    save(path, state)
    return {"sourceId": source["sourceId"], "contentRevision": source["contentRevision"], "resolution": source["resolution"], "runId": state["currentRunId"]}


def add_evidence(args: argparse.Namespace) -> dict[str, Any]:
    path, state = load(args.state_dir)
    artifact_id = safe_id(args.evidence_id)
    active = not args.inactive
    evidence = {"evidenceArtifactId": artifact_id, "kind": args.kind, "statement": args.statement, "active": active, "revision": evidence_revision(args.kind, args.statement, active)}
    previous = next((item for item in state["evidenceArtifacts"] if item["evidenceArtifactId"] == artifact_id), None)
    if previous:
        state["evidenceArtifacts"].remove(previous)
    state["evidenceArtifacts"].append(evidence)
    if stale_current(state, f"Обновлено доказательное событие {artifact_id}."):
        next_run(state)
    save(path, state)
    return evidence


def mark_reviewed(args: argparse.Namespace) -> dict[str, Any]:
    path, state = load(args.state_dir)
    source = source_by_id(state, args.source_id)
    if source["scope"] != "IN_SCOPE" or source["availability"] != "AVAILABLE":
        raise StateError("REVIEWED допустим только для IN_SCOPE + AVAILABLE.")
    if not args.part:
        raise StateError("Укажите хотя бы одну обработанную часть через --part.")
    known = {item["sourceId"] for item in state["sources"]}
    missing = [item for item in args.discovered_source_id if item not in known]
    if missing:
        raise StateError("Сначала зарегистрируйте обнаруженные источники: " + ", ".join(missing))
    source["reviewEvidence"] = {"contentRevision": source["contentRevision"], "processedParts": args.part, "discoveredSourceIds": args.discovered_source_id, "method": args.method, "verifiedByMainAgent": True, "statement": args.evidence, "recordedAt": now()}
    source["resolution"] = "REVIEWED"
    if stale_current(state, f"Обновлён reviewEvidence источника {source['sourceId']}."):
        next_run(state)
    save(path, state)
    return {"sourceId": source["sourceId"], "resolution": "REVIEWED", "runId": state["currentRunId"]}


def validate_map_command(args: argparse.Namespace) -> dict[str, Any]:
    _, state = load(args.state_dir)
    errors = validate_map(state)
    unresolved = [
        f"{source['sourceId']}: source gate открыт ({source['resolution']})."
        for source in state["sources"]
        if source["resolution"] not in FINAL_RESOLUTIONS
    ]
    errors.extend(unresolved)
    return {"valid": not errors, "sourceGate": "CLOSED" if not errors else "OPEN", "errors": errors}


def snapshot(args: argparse.Namespace) -> dict[str, Any]:
    path, state = load(args.state_dir)
    errors = validate_map(state)
    if errors or not all(source["resolution"] in FINAL_RESOLUTIONS for source in state["sources"]):
        details = errors or ["source gate открыт."]
        raise StateError("Нельзя создать snapshot:\n- " + "\n- ".join(details))
    if not args.policy_file:
        raise StateError("Укажите хотя бы один --policy-file для snapshot.")
    evidence_errors = evidence_ref_errors(state, args.evidence_ref)
    if evidence_errors:
        raise StateError("Нельзя создать snapshot:\n- " + "\n- ".join(evidence_errors))
    author = args.author or AUTHOR_PLACEHOLDER
    if args.author_event_ref:
        author_errors = evidence_ref_errors(state, [args.author_event_ref], "USER_EVENT")
        if author_errors:
            raise StateError("Нельзя создать snapshot:\n- " + "\n- ".join(author_errors))
    assumptions: dict[str, dict[str, str | None]] = {}
    for value in args.assumption_revision:
        assumption_id, revision = parse_evidence_ref(value)
        assumptions[assumption_id] = {"revision": revision, "confirmationEvidenceRef": None}
    for value in args.assumption_confirmation:
        assumption_id, separator, evidence_ref = value.partition("=")
        if not separator or assumption_id not in assumptions:
            raise StateError("assumption-confirmation должен иметь формат <assumptionId>=<evidenceRef>.")
        confirmation_errors = evidence_ref_errors(state, [evidence_ref], "USER_EVENT")
        if confirmation_errors:
            raise StateError("Нельзя создать snapshot:\n- " + "\n- ".join(confirmation_errors))
        evidence_id, _ = parse_evidence_ref(evidence_ref)
        evidence = next(item for item in state["evidenceArtifacts"] if item["evidenceArtifactId"] == evidence_id)
        if assumptions[assumption_id]["revision"] not in evidence["statement"]:
            raise StateError("Подтверждение допущения должно явно содержать его текущую revision.")
        assumptions[assumption_id]["confirmationEvidenceRef"] = evidence_ref
    snapshot_id = f"snapshot-{state['currentRunId']}"
    if any(item["runSnapshotId"] == snapshot_id for item in state["snapshots"]):
        raise StateError(f"Snapshot уже существует: {snapshot_id}")
    policies = [{"path": str(Path(item).resolve()), "revision": file_hash(Path(item).resolve())} for item in args.policy_file]
    state["snapshots"].append({"runSnapshotId": snapshot_id, "runId": state["currentRunId"], "createdAt": now(), "mode": args.mode, "requirementSources": copy.deepcopy(state["sources"]), "evidenceArtifacts": args.evidence_ref, "assumptions": assumptions, "author": {"valueHash": text_hash(author), "isPlaceholder": author == AUTHOR_PLACEHOLDER, "authorEventRef": args.author_event_ref}, "policyRevisions": policies})
    save(path, state)
    return {"runSnapshotId": snapshot_id, "runId": state["currentRunId"], "sourceGate": "CLOSED"}


def issue_artifact(args: argparse.Namespace) -> dict[str, Any]:
    path, state = load(args.state_dir)
    errors = validate_map(state)
    unresolved = [source["sourceId"] for source in state["sources"] if source["resolution"] not in FINAL_RESOLUTIONS]
    if errors or unresolved:
        raise StateError("Нельзя выпустить artifact: состояние источников изменилось или source gate открыт.")
    selected = next((item for item in state["snapshots"] if item["runSnapshotId"] == args.snapshot_id), None)
    if not selected or selected["runId"] != state["currentRunId"]:
        raise StateError("Snapshot не найден или относится к другому run.")
    if policy_errors(selected):
        raise StateError("Нельзя выпустить artifact: policy-файлы изменились или недоступны.")
    integrity_errors = evidence_ref_errors(state, selected.get("evidenceArtifacts", []))
    author_event = selected.get("author", {}).get("authorEventRef")
    if author_event:
        integrity_errors.extend(evidence_ref_errors(state, [author_event], "USER_EVENT"))
    for assumption in selected.get("assumptions", {}).values():
        confirmation = assumption.get("confirmationEvidenceRef")
        if confirmation:
            integrity_errors.extend(evidence_ref_errors(state, [confirmation], "USER_EVENT"))
    if integrity_errors:
        raise StateError("Нельзя выпустить artifact: доказательные события изменились или недоступны.")
    if args.artifact_type == "CARD_OFFICIAL":
        if selected.get("author", {}).get("isPlaceholder"):
            raise StateError("CARD_OFFICIAL требует заполненное поле автора.")
        if any(not item.get("confirmationEvidenceRef") for item in selected.get("assumptions", {}).values()):
            raise StateError("CARD_OFFICIAL требует подтверждения каждого допущения.")
    previous = state.get("currentArtifactId")
    if previous:
        stale_current(state, "Заменён новым artifact.")
    artifact = {"artifactId": f"artifact-{len(state['artifacts']) + 1}", "runId": state["currentRunId"], "runSnapshotId": args.snapshot_id, "artifactType": args.artifact_type, "supersedesArtifactId": previous, "status": "CURRENT", "issuedAt": now()}
    state["artifacts"].append(artifact)
    state["currentArtifactId"] = artifact["artifactId"]
    save(path, state)
    return artifact


def invalidate(args: argparse.Namespace) -> dict[str, Any]:
    path, state = load(args.state_dir)
    changed = []
    for source in state["sources"]:
        content_path = source.get("contentPath")
        if source.get("availability") != "AVAILABLE" or not content_path:
            continue
        path_to_source = Path(content_path)
        if not path_to_source.is_file():
            source["availability"] = "TECHNICALLY_UNREADABLE"
            source["reason"] = "Файл, использованный для текущей revision, больше недоступен."
            source["contentRevision"] = None
            source["reviewEvidence"] = None
            source["observationRevision"] = observation_hash(source)
            source["resolution"] = "INPUT_REQUIRED"
            changed.append(source["sourceId"])
            continue
        revision = file_hash(path_to_source)
        if revision != source["contentRevision"]:
            source["contentRevision"] = revision
            source["reviewEvidence"] = None
            source["resolution"] = "PENDING_REVIEW" if source["scope"] == "IN_SCOPE" else "EXCLUDED_WITH_REASON"
            changed.append(source["sourceId"])
    current_id = state.get("currentArtifactId")
    if current_id:
        artifact = next(item for item in state["artifacts"] if item["artifactId"] == current_id)
        snapshot_for_artifact = next(item for item in state["snapshots"] if item["runSnapshotId"] == artifact["runSnapshotId"])
        changed.extend("policy:" + error for error in policy_errors(snapshot_for_artifact))
    if changed:
        stale_current(state, "Изменились revisions: " + ", ".join(changed))
        next_run(state)
        save(path, state)
    return {"changedSources": changed, "runId": state["currentRunId"], "currentArtifactId": state.get("currentArtifactId")}


def show(args: argparse.Namespace) -> dict[str, Any]:
    _, state = load(args.state_dir)
    return {"reviewCaseId": state["reviewCaseId"], "title": state["title"], "currentRunId": state["currentRunId"], "currentArtifactId": state["currentArtifactId"], "sources": [{"sourceId": item["sourceId"], "resolution": item["resolution"], "contentRevision": item.get("contentRevision")} for item in state["sources"]], "snapshots": [item["runSnapshotId"] for item in state["snapshots"]], "artifacts": state["artifacts"]}


def add_state_dir(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--state-dir", required=True, help="Явно выбранный каталог для case.json.")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init-case"); add_state_dir(init); init.add_argument("--title", required=True); init.add_argument("--case-id"); init.set_defaults(handler=init_case)
    add = commands.add_parser("add-source"); add_state_dir(add); add.add_argument("--source-id", required=True); add.add_argument("--display-name"); add.add_argument("--file"); add.add_argument("--url"); add.add_argument("--content-file"); add.add_argument("--discovery-ref"); add.add_argument("--scope", required=True, choices=sorted(SCOPES)); add.add_argument("--availability", required=True, choices=sorted(AVAILABILITY)); add.add_argument("--reason"); add.add_argument("--evidence-ref"); add.add_argument("--required-mockup", action="store_true"); add.set_defaults(handler=add_source)
    evidence = commands.add_parser("add-evidence"); add_state_dir(evidence); evidence.add_argument("--evidence-id", required=True); evidence.add_argument("--kind", required=True, choices=sorted(EVIDENCE_KINDS)); evidence.add_argument("--statement", required=True); evidence.add_argument("--inactive", action="store_true"); evidence.set_defaults(handler=add_evidence)
    update = commands.add_parser("update-source"); add_state_dir(update); update.add_argument("--source-id", required=True); update.add_argument("--display-name"); update.add_argument("--file"); update.add_argument("--url"); update.add_argument("--content-file"); update.add_argument("--discovery-ref"); update.add_argument("--scope", choices=sorted(SCOPES)); update.add_argument("--availability", choices=sorted(AVAILABILITY)); update.add_argument("--reason"); update.add_argument("--evidence-ref"); mockup = update.add_mutually_exclusive_group(); mockup.add_argument("--required-mockup", dest="required_mockup", action="store_true"); mockup.add_argument("--not-required-mockup", dest="required_mockup", action="store_false"); update.set_defaults(handler=update_source, required_mockup=None)
    reviewed = commands.add_parser("mark-reviewed"); add_state_dir(reviewed); reviewed.add_argument("--source-id", required=True); reviewed.add_argument("--part", action="append", default=[]); reviewed.add_argument("--discovered-source-id", action="append", default=[]); reviewed.add_argument("--method", choices=["MAIN_READ", "DELEGATED_EXTRACTION_VERIFIED"], default="MAIN_READ"); reviewed.add_argument("--evidence", required=True); reviewed.set_defaults(handler=mark_reviewed)
    validate = commands.add_parser("validate-map"); add_state_dir(validate); validate.set_defaults(handler=validate_map_command)
    snap = commands.add_parser("snapshot"); add_state_dir(snap); snap.add_argument("--mode", required=True, choices=["standard", "full"]); snap.add_argument("--policy-file", action="append", default=[]); snap.add_argument("--evidence-ref", action="append", default=[]); snap.add_argument("--author"); snap.add_argument("--author-event-ref"); snap.add_argument("--assumption-revision", action="append", default=[]); snap.add_argument("--assumption-confirmation", action="append", default=[]); snap.set_defaults(handler=snapshot)
    artifact = commands.add_parser("issue-artifact"); add_state_dir(artifact); artifact.add_argument("--snapshot-id", required=True); artifact.add_argument("--artifact-type", required=True, choices=["CARD_DRAFT", "CARD_OFFICIAL"]); artifact.set_defaults(handler=issue_artifact)
    invalid = commands.add_parser("invalidate"); add_state_dir(invalid); invalid.set_defaults(handler=invalidate)
    state = commands.add_parser("show"); add_state_dir(state); state.set_defaults(handler=show)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        result = args.handler(args)
    except StateError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if args.command == "validate-map" and not result["valid"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
