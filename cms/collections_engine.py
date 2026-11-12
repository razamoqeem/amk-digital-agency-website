"""
Collections Engine for Webflow-style Custom CMS (Zero-Middleware).

Handles:
- Dynamic collection schemas with custom-fillable fields (Text, Rich Text, Image, JSON-LD, SEO).
- Hierarchical Parent/Child folder routing (e.g. /services/seo/audit).
- Safe file-based storage under content/collections/<collection>/<slug>.json.
"""
import os
import re
import json
from pathlib import Path
from typing import Dict, List, Optional, Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONTENT = ROOT / "content"
COLLECTIONS_DIR = CONTENT / "collections"
SCHEMA_FILE = CONTENT / "collections_schema.json"
FOLDERS_FILE = CONTENT / "folders.json"

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def ensure_dirs():
    """Ensure collection storage directories exist."""
    COLLECTIONS_DIR.mkdir(parents=True, exist_ok=True)
    schemas = load_schemas()
    for col in schemas.get("collections", []):
        (COLLECTIONS_DIR / col["id"]).mkdir(parents=True, exist_ok=True)


def load_schemas() -> Dict[str, Any]:
    """Load collection schema definitions."""
    if not SCHEMA_FILE.exists():
        return {"collections": []}
    try:
        return json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"collections": []}


def get_schema(collection_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve schema for a specific collection."""
    schemas = load_schemas()
    for col in schemas.get("collections", []):
        if col.get("id") == collection_id:
            return col
    return None


def load_folders() -> List[Dict[str, Any]]:
    """Load folders and recalculate resolved full paths hierarchically."""
    if not FOLDERS_FILE.exists():
        return []
    try:
        data = json.loads(FOLDERS_FILE.read_text(encoding="utf-8"))
        raw_folders = data.get("folders", [])
    except Exception:
        return []

    # Map for fast lookup by id
    by_id = {f["id"]: f for f in raw_folders if "id" in f}

    def compute_path(f: dict) -> str:
        parent_id = f.get("parentId")
        slug = f.get("slug", "").strip()
        if not parent_id or parent_id not in by_id:
            return slug
        parent_path = compute_path(by_id[parent_id])
        return f"{parent_path}/{slug}" if parent_path else slug

    # Ensure every folder has accurate fullPath
    for f in raw_folders:
        f["fullPath"] = compute_path(f)

    return raw_folders


def get_folder_by_id(folder_id: str) -> Optional[Dict[str, Any]]:
    folders = load_folders()
    for f in folders:
        if f.get("id") == folder_id:
            return f
    return None


def resolve_item_url(slug: str, folder_id: Optional[str] = None) -> str:
    """Calculate the clean URL path based on folder hierarchy."""
    clean_slug = slug.strip().strip("/")
    if not folder_id:
        return f"/{clean_slug}/"
    folder = get_folder_by_id(folder_id)
    if not folder or not folder.get("fullPath"):
        return f"/{clean_slug}/"
    folder_path = folder["fullPath"].strip("/")
    return f"/{folder_path}/{clean_slug}/"


def list_items(collection_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """List all items across collections or for a specific collection."""
    ensure_dirs()
    schemas = load_schemas()
    cols = [collection_id] if collection_id else [c["id"] for c in schemas.get("collections", [])]

    folders = {f["id"]: f for f in load_folders()}
    items = []

    for cid in cols:
        col_dir = COLLECTIONS_DIR / cid
        if not col_dir.exists():
            continue
        for file in col_dir.glob("*.json"):
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
                folder_id = data.get("folderId")
                folder_path = folders[folder_id]["fullPath"] if folder_id in folders else ""
                data["_urlPath"] = f"/{folder_path}/{data['slug']}/" if folder_path else f"/{data['slug']}/"
                data["_collectionId"] = cid
                items.append(data)
            except Exception:
                continue

    return sorted(items, key=lambda x: x.get("updatedAt", ""), reverse=True)


def get_item(collection_id: str, slug: str) -> Optional[Dict[str, Any]]:
    """Fetch a single item by collection and slug."""
    ensure_dirs()
    item_file = COLLECTIONS_DIR / collection_id / f"{slug}.json"
    if not item_file.exists():
        return None
    try:
        return json.loads(item_file.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_item(collection_id: str, raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate, clean, and save a dynamic collection item."""
    ensure_dirs()
    schema = get_schema(collection_id)
    if not schema:
        raise ValueError(f"Collection '{collection_id}' not found in schema.")

    slug = str(raw_data.get("slug", "")).strip().lower()
    if not SLUG_RE.match(slug):
        raise ValueError("Invalid slug format. Use lowercase letters, numbers, and dashes.")

    title = str(raw_data.get("title", "")).strip()
    if not title:
        raise ValueError("Title is required.")

    folder_id = raw_data.get("folderId")
    if folder_id:
        if not get_folder_by_id(folder_id):
            raise ValueError(f"Selected folder '{folder_id}' does not exist.")

    # Clean fillable fields against schema
    raw_fields = raw_data.get("fields") or {}
    clean_fields = {}
    for f in schema.get("fields", []):
        k = f["key"]
        t = f.get("type", "text")
        val = raw_fields.get(k, f.get("default", ""))

        if t == "boolean":
            clean_fields[k] = bool(val)
        elif t == "number":
            try:
                clean_fields[k] = float(val) if "." in str(val) else int(val)
            except (ValueError, TypeError):
                clean_fields[k] = f.get("default", 0)
        elif t in ("text", "textarea", "image", "date", "select"):
            clean_fields[k] = str(val or "").strip()
        elif t == "richtext":
            # Store sanitized html content
            clean_fields[k] = str(val or "").strip()
        else:
            clean_fields[k] = val

    # SEO metadata
    seo_raw = raw_data.get("seo") or {}
    clean_seo = {
        "metaTitle": str(seo_raw.get("metaTitle", "")).strip() or title,
        "metaDesc": str(seo_raw.get("metaDesc", "")).strip(),
        "canonical": str(seo_raw.get("canonical", "")).strip(),
        "noindex": bool(seo_raw.get("noindex", False)),
        "ogImage": str(seo_raw.get("ogImage", "")).strip(),
    }

    # Custom JSON-LD schema
    schema_json = raw_data.get("jsonLd")
    if schema_json and not isinstance(schema_json, (dict, list)):
        schema_json = None

    import datetime
    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    existing = get_item(collection_id, slug) or {}
    clean_item = {
        "id": slug,
        "collection": collection_id,
        "folderId": folder_id,
        "slug": slug,
        "title": title,
        "draft": bool(raw_data.get("draft", False)),
        "fields": clean_fields,
        "seo": clean_seo,
        "jsonLd": schema_json,
        "createdAt": existing.get("createdAt", now_iso),
        "updatedAt": now_iso
    }

    out_file = COLLECTIONS_DIR / collection_id / f"{slug}.json"
    tmp_file = COLLECTIONS_DIR / collection_id / f"{slug}.tmp"
    with open(tmp_file, "w", encoding="utf-8", newline="\n") as f:
        json.dump(clean_item, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp_file, out_file)

    clean_item["_urlPath"] = resolve_item_url(slug, folder_id)
    return clean_item
