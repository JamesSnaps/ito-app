"""Player profiles, shared by every game: a name and, if they want one, a selfie.

Until now a player was just a name typed at the table, and the records key
on it case-insensitively. A profile doesn't change that — it *is* that name,
claimed, with a photo — so every record ever kept lines up with it without a
migration, and a guest who never makes one carries on exactly as before.

Who may change a profile is the only real question, and there are no
accounts here (guests can't use Authelia). So a profile is held by devices:
making one hands this device a secret token, kept in the browser (or the
iOS app), and only a device holding one of the profile's tokens can change
its photo or delete it. Another device joins by scanning a QR the first one
shows — a one-time link code — and gets its own token. Tokens are stored
hashed; the server can check one but never hand it back.

Photos are re-drawn by the server (Pillow) as a 320px square JPEG before
they're kept. That proves it's an image, sizes it once for every screen,
and drops everything else the file carried — EXIF, including where the
selfie was taken. Each version gets a fresh random filename, so a photo can
be cached forever and a replaced one simply stops being linked.

The profile list is public, like the leaderboards: the hub's player routes
are, because guests join by QR. Anyone who knows the site can see the names
and photos on it. The /me page says so before a photo is taken.
"""

import hashlib
import io
import re
import secrets
import threading
import time
from datetime import datetime, timezone

from flask import Blueprint, abort, jsonify, render_template, request, send_from_directory, url_for

from core import jsonfile, paths
from core.jsonfile import DataUnavailable
from core.qr import svg as qr_svg

MAX_NAME = 20
MAX_PROFILES = 200
MAX_DEVICES = 10
PHOTO_SIZE = 320
MAX_UPLOAD = 12 * 1024 * 1024
LINK_TTL = 10 * 60
TOKEN_HEADER = "X-Profile-Token"
PHOTO_NAME = re.compile(r"[a-z0-9]{6,16}-[a-z0-9]{8,16}\.jpg")

_lock = threading.Lock()
# One-time codes for adding a device: code -> (profile id, expiry). In
# memory on purpose: a restart costs a code nobody has used in ten minutes.
_links = {}

bp = Blueprint("profiles", __name__)


# --- storage --------------------------------------------------------------

def profiles_path():
    """Looked up at call time, so tests can point DATA_DIR elsewhere."""
    return paths.DATA_DIR / "profiles.json"


def photo_dir():
    folder = paths.DATA_DIR / "profiles" / "photos"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _read():
    """All profiles. A missing file is no profiles; a damaged one is never
    written over — the backup is used for reading, and writes refuse."""
    path = profiles_path()
    try:
        # Valid JSON of the wrong shape is as damaged as invalid JSON.
        return _shape(jsonfile.read(path)), True
    except FileNotFoundError:
        return {"profiles": {}}, True
    except jsonfile.Unreadable:
        try:
            return _shape(jsonfile.read(jsonfile.backup_path(path))), False
        except (FileNotFoundError, jsonfile.Unreadable):
            return {"profiles": {}}, False


def _shape(data):
    if not isinstance(data, dict) or not isinstance(data.get("profiles"), dict):
        raise jsonfile.Unreadable("profiles.json isn't a profile list")
    return data


def _update(mutate):
    """Read-modify-write under the lock. `mutate(data)` returns the result."""
    with _lock:
        data, writable = _read()
        if not writable:
            raise DataUnavailable("The player profiles file is damaged — nothing can be saved "
                                  "until it's restored from profiles.json.bak.")
        result = mutate(data)
        jsonfile.write(profiles_path(), data)
        return result


def _all():
    with _lock:
        return _read()[0]["profiles"]


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash(token):
    return hashlib.sha256(token.encode("utf-8", "surrogateescape")).hexdigest()


def clean_name(value):
    """Trimmed and cut to MAX_NAME, as the games store names. Not a string → ''."""
    return " ".join(value.split())[:MAX_NAME] if isinstance(value, str) else ""


def public(profile):
    """What anyone may see: never the token hashes."""
    photo = profile.get("photo")
    return {
        "id": profile["id"],
        "name": profile["name"],
        "photo": url_for("profiles.photo", filename=photo) if photo else None,
    }


# --- profiles -------------------------------------------------------------

def list_public():
    return sorted((public(p) for p in _all().values()), key=lambda p: p["name"].casefold())


def photo_for(name):
    """The photo URL for a player name, or None. How games find a face."""
    key = clean_name(name).casefold()
    for profile in _all().values():
        if profile["name"].casefold() == key:
            return public(profile)["photo"]
    return None


def photos_by_name():
    """{casefolded name: photo URL} for every profile with a photo."""
    return {p["name"].casefold(): public(p)["photo"] for p in _all().values() if p.get("photo")}


def create(name):
    """A new profile held by this device. Returns (profile, token)."""
    name = clean_name(name)
    if not name:
        raise ValueError("Your profile needs a name.")
    token = secrets.token_urlsafe(18)

    def mutate(data):
        profiles = data["profiles"]
        if any(p["name"].casefold() == name.casefold() for p in profiles.values()):
            raise ValueError(f"There's already a profile called {name}. If it's yours, add this "
                             "device from your other one.")
        if len(profiles) >= MAX_PROFILES:
            raise ValueError("Game Night has as many profiles as it takes.")
        pid = secrets.token_hex(5)
        profiles[pid] = {"id": pid, "name": name, "tokens": [_hash(token)], "photo": None,
                         "created": _now(), "updated": _now()}
        return dict(profiles[pid])

    return _update(mutate), token


def by_token(token):
    """The profile a device token belongs to, or None."""
    if not token:
        return None
    digest = _hash(token)
    for profile in _all().values():
        if any(secrets.compare_digest(digest, h) for h in profile.get("tokens", [])):
            return profile
    return None


def _change(pid, change):
    def mutate(data):
        profile = data["profiles"].get(pid)
        if profile is None:
            raise LookupError("That profile has gone.")
        change(data, profile)
        profile["updated"] = _now()
        return dict(profile)
    return _update(mutate)


def set_photo(pid, raw):
    """Re-draw an uploaded image as the profile's photo. Returns the profile."""
    jpeg = process_photo(raw)
    filename = f"{pid}-{secrets.token_hex(5)}.jpg"
    (photo_dir() / filename).write_bytes(jpeg)

    old = {}

    def change(data, profile):
        old["photo"] = profile.get("photo")
        profile["photo"] = filename

    try:
        profile = _change(pid, change)
    except Exception:
        (photo_dir() / filename).unlink(missing_ok=True)
        raise
    _remove_file(old.get("photo"))
    return profile


def remove_photo(pid):
    old = {}

    def change(data, profile):
        old["photo"] = profile.get("photo")
        profile["photo"] = None

    profile = _change(pid, change)
    _remove_file(old.get("photo"))
    return profile


def forget_device(pid, token):
    """This device lets go of the profile. The profile stays while another
    device holds it; the last one out deletes it, since a profile no device
    holds could never be changed or deleted, and its name would stay claimed
    for good. Returns True if that happened."""
    digest = _hash(token)
    gone = {}

    def mutate(data):
        profile = data["profiles"].get(pid)
        if profile is None:
            raise LookupError("That profile has gone.")
        tokens = [h for h in profile.get("tokens", []) if not secrets.compare_digest(h, digest)]
        if tokens:
            profile["tokens"] = tokens
            profile["updated"] = _now()
        else:
            gone["photo"] = data["profiles"].pop(pid).get("photo") or None
        return dict(profile)

    _update(mutate)
    if "photo" in gone:
        _remove_file(gone["photo"])
    return "photo" in gone


def delete(pid):
    gone = {}

    def mutate(data):
        profile = data["profiles"].pop(pid, None)
        gone["photo"] = profile and profile.get("photo")
        return profile

    profile = _update(mutate)
    _remove_file(gone.get("photo"))
    return profile


def _remove_file(filename):
    if filename and PHOTO_NAME.fullmatch(filename):
        (photo_dir() / filename).unlink(missing_ok=True)


# --- photos ---------------------------------------------------------------

def process_photo(raw):
    """Any reasonable image in, a square PHOTO_SIZE JPEG with no metadata out.
    Raises ValueError with a sentence for anything else."""
    from PIL import Image, ImageOps

    if not raw:
        raise ValueError("No photo arrived.")
    if len(raw) > MAX_UPLOAD:
        raise ValueError("That photo is too big — try a smaller one.")
    # A phone photo is ~12–48 megapixels; anything far past that is a
    # decompression bomb, not a selfie.
    Image.MAX_IMAGE_PIXELS = 60_000_000
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("JPEG", "MPO", "PNG", "WEBP", "GIF", "HEIF"):
                raise ValueError("That isn't a photo this can use — a JPEG or PNG works.")
            image = ImageOps.exif_transpose(image)
            image = image.convert("RGB")
            # Faces sit a little above centre in a selfie.
            image = ImageOps.fit(image, (PHOTO_SIZE, PHOTO_SIZE), Image.LANCZOS, centering=(0.5, 0.42))
            out = io.BytesIO()
            image.save(out, "JPEG", quality=84, optimize=True, progressive=True)
            return out.getvalue()
    except Image.DecompressionBombError as err:
        raise ValueError("That photo is far too big.") from err
    except (OSError, SyntaxError, Image.UnidentifiedImageError) as err:
        raise ValueError("That photo couldn't be read — try taking it again.") from err


# --- linking another device -------------------------------------------------

def make_link(pid):
    """A one-time code another device can redeem for its own token."""
    now = time.time()
    with _lock:
        for code in [c for c, (_, expires) in _links.items() if expires < now]:
            del _links[code]
        code = secrets.token_urlsafe(9)
        _links[code] = (pid, now + LINK_TTL)
    return code


def redeem_link(code):
    """Swap a link code for (profile, token). Each code works once."""
    with _lock:
        found = _links.pop(code, None)
    if not found or found[1] < time.time():
        return None
    pid = found[0]
    token = secrets.token_urlsafe(18)

    def change(data, profile):
        profile["tokens"] = (profile.get("tokens", []) + [_hash(token)])[-MAX_DEVICES:]

    try:
        return _change(pid, change), token
    except LookupError:
        return None


# --- routes ---------------------------------------------------------------

def _me_or_403():
    profile = by_token(request.headers.get(TOKEN_HEADER, ""))
    if profile is None:
        refused = jsonify({"error": "This device isn't signed in as anyone."})
        refused.status_code = 403
        abort(refused)
    return profile


@bp.route("/me")
def me_page():
    """Make your profile, take a selfie, add another device."""
    return render_template("me.html", max_name=MAX_NAME, back=_back_link())


@bp.route("/me/link/<code>")
def me_link_page(code):
    """Where the add-a-device QR lands. Redeeming is a POST from the page,
    so a link preview fetching the URL can't use the code up."""
    return render_template("me.html", max_name=MAX_NAME, back="/", link_code=code)


def _back_link():
    back = request.args.get("back", "")
    if back.startswith("/") and "//" not in back and "\\" not in back:
        return back
    return "/"


@bp.route("/profiles/photos/<filename>")
def photo(filename):
    if not PHOTO_NAME.fullmatch(filename):
        abort(404)
    response = send_from_directory(photo_dir(), filename, mimetype="image/jpeg", max_age=31536000)
    # The filename changes with every new photo, so this one never will.
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@bp.route("/api/profiles")
def api_list():
    return jsonify({"profiles": list_public()})


@bp.route("/api/profiles", methods=["POST"])
def api_create():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "expected an object"}), 400
    try:
        profile, token = create(body.get("name"))
    except ValueError as err:
        return jsonify({"error": str(err)}), 409 if "already" in str(err) else 400
    return jsonify({"profile": public(profile), "token": token})


@bp.route("/api/profiles/me")
def api_me():
    return jsonify({"profile": public(_me_or_403())})


@bp.route("/api/profiles/me", methods=["DELETE"])
def api_delete_me():
    """Delete the profile everywhere. The records keep the name."""
    delete(_me_or_403()["id"])
    return jsonify({"deleted": True})


@bp.route("/api/profiles/me/forget", methods=["POST"])
def api_forget():
    """Sign this device out of the profile. The last device out deletes it."""
    profile = _me_or_403()
    deleted = forget_device(profile["id"], request.headers.get(TOKEN_HEADER, ""))
    return jsonify({"forgotten": True, "deleted": deleted})


@bp.route("/api/profiles/me/photo", methods=["POST"])
def api_set_photo():
    profile = _me_or_403()
    # The length is what caps the read: Werkzeug cuts the body off there. A
    # chunked body has none, and would be read to the end whatever its size.
    # (No length and not chunked is an empty body — Werkzeug reads nothing.)
    if request.content_length is None and request.environ.get("wsgi.input_terminated"):
        return jsonify({"error": "That photo didn't arrive whole — try again."}), 411
    if (request.content_length or 0) > MAX_UPLOAD:
        return jsonify({"error": "That photo is too big — try a smaller one."}), 413
    upload = request.files.get("photo")
    raw = upload.read(MAX_UPLOAD + 1) if upload else request.get_data(cache=False)
    try:
        updated = set_photo(profile["id"], raw)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    return jsonify({"profile": public(updated)})


@bp.route("/api/profiles/me/photo", methods=["DELETE"])
def api_remove_photo():
    return jsonify({"profile": public(remove_photo(_me_or_403()["id"]))})


@bp.route("/api/profiles/me/link", methods=["POST"])
def api_make_link():
    """A QR for adding another of your devices, good for ten minutes."""
    code = make_link(_me_or_403()["id"])
    url = request.host_url.rstrip("/") + url_for("profiles.me_link_page", code=code)
    return jsonify({"code": code, "url": url, "qr_svg": qr_svg(url).decode("utf-8"), "expires_in": LINK_TTL})


@bp.route("/api/profiles/link/<code>", methods=["POST"])
def api_redeem_link(code):
    """Redeemed by the new device. Wrong codes count against the same
    throttle as room codes, so this is no better for guessing."""
    from core import ratelimit

    client = request.remote_addr or "unknown"
    found = redeem_link(code)
    if found is None:
        if ratelimit.code_guesses.record_failure(client):
            return jsonify({"error": "Too many wrong links from this device. Wait a few minutes."}), 429
        return jsonify({"error": "That link has been used or has expired. Make a new one on your "
                                 "other device."}), 404
    ratelimit.code_guesses.clear(client)
    profile, token = found
    return jsonify({"profile": public(profile), "token": token})
