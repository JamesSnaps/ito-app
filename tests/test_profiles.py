"""Player profiles: making one, the selfie, adding a device, and what stays private."""

import io
import json

from PIL import Image

from test_smoke import client


def jpeg(size=(640, 480), color=(200, 120, 60), exif=None):
    out = io.BytesIO()
    image = Image.new("RGB", size, color)
    if exif is not None:
        image.save(out, "JPEG", exif=exif)
    else:
        image.save(out, "JPEG")
    return out.getvalue()


def make(c, name="Ana"):
    res = c.post("/api/profiles", json={"name": name})
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    return body["profile"], {"X-Profile-Token": body["token"]}


def upload(c, headers, data, content_type="image/jpeg"):
    return c.post("/api/profiles/me/photo", data=data, headers={**headers, "Content-Type": content_type})


def test_a_profile_is_a_claimed_name_and_the_list_shows_no_secrets():
    c = client()
    profile, headers = make(c, "  Ana  ")
    assert profile == {"id": profile["id"], "name": "Ana", "photo": None, "kid": False}
    listed = c.get("/api/profiles").get_json()["profiles"]
    assert listed == [profile]
    assert "token" not in json.dumps(listed)
    assert c.get("/api/profiles/me", headers=headers).get_json()["profile"] == profile


def test_names_are_unique_ignoring_case_and_must_exist():
    c = client()
    make(c, "Ana")
    assert c.post("/api/profiles", json={"name": "ANA"}).status_code == 409
    for body in ({"name": ""}, {"name": "   "}, {"name": 7}, {}, ["Ana"]):
        assert c.post("/api/profiles", json=body).status_code == 400, body


def test_only_a_device_holding_the_profile_can_change_it():
    c = client()
    make(c)
    for headers in ({}, {"X-Profile-Token": "nope"}):
        assert c.get("/api/profiles/me", headers=headers).status_code == 403
        assert upload(c, headers, jpeg()).status_code == 403
        assert c.delete("/api/profiles/me", headers=headers).status_code == 403


def test_a_selfie_is_redrawn_square_and_stripped_of_metadata():
    c = client()
    _, headers = make(c)
    exif = Image.Exif()
    exif[0x010F] = "Phone Maker"          # Make
    exif[0x8825] = {2: (51.0, 30.0, 0.0)}  # GPS: where the selfie was taken
    res = upload(c, headers, jpeg((3000, 4000), exif=exif))
    assert res.status_code == 200, res.get_json()
    url = res.get_json()["profile"]["photo"]
    served = c.get(url)
    assert served.status_code == 200 and served.mimetype == "image/jpeg"
    assert "immutable" in served.headers["Cache-Control"]
    with Image.open(io.BytesIO(served.data)) as image:
        assert image.size == (320, 320)
        assert not image.getexif()
    assert c.get("/api/profiles").get_json()["profiles"][0]["photo"] == url


def test_png_and_multipart_uploads_work_too():
    c = client()
    _, headers = make(c)
    png = io.BytesIO()
    Image.new("RGBA", (500, 500), (0, 0, 255, 128)).save(png, "PNG")
    assert upload(c, headers, png.getvalue(), "image/png").status_code == 200
    res = c.post("/api/profiles/me/photo", headers=headers,
                 data={"photo": (io.BytesIO(jpeg()), "selfie.jpg")}, content_type="multipart/form-data")
    assert res.status_code == 200


def test_anything_that_isnt_a_photo_is_refused(monkeypatch):
    from core import profiles

    c = client()
    _, headers = make(c)
    for junk in (b"", b"not an image", b"<svg></svg>", jpeg()[:200]):
        assert upload(c, headers, junk).status_code == 400, junk[:20]
    monkeypatch.setattr(profiles, "MAX_UPLOAD", 1000)
    assert upload(c, headers, jpeg((1500, 1500), color=(1, 2, 3)) + b"x" * 2000).status_code == 413
    assert c.get("/api/profiles/me", headers=headers).get_json()["profile"]["photo"] is None


def test_a_new_photo_replaces_the_old_one_and_removing_it_deletes_the_file():
    c = client()
    _, headers = make(c)
    first = upload(c, headers, jpeg()).get_json()["profile"]["photo"]
    second = upload(c, headers, jpeg(color=(10, 200, 10))).get_json()["profile"]["photo"]
    assert first != second
    assert c.get(first).status_code == 404 and c.get(second).status_code == 200
    gone = c.delete("/api/profiles/me/photo", headers=headers).get_json()["profile"]
    assert gone["photo"] is None and c.get(second).status_code == 404


def test_photo_urls_cannot_reach_outside_the_photo_folder():
    c = client()
    for name in ("../profiles.json", "x.jpg", "ABCDEF-12345678.jpg", "abcdef-12345678.png"):
        assert c.get(f"/profiles/photos/{name}").status_code == 404, name


def test_another_device_joins_with_a_one_time_link():
    c = client()
    profile, headers = make(c)
    link = c.post("/api/profiles/me/link", headers=headers).get_json()
    assert link["url"].endswith(f"/me/link/{link['code']}") and "<svg" in link["qr_svg"]

    phone = client()
    joined = phone.post(f"/api/profiles/link/{link['code']}").get_json()
    assert joined["profile"]["id"] == profile["id"]
    other = {"X-Profile-Token": joined["token"]}
    assert upload(phone, other, jpeg()).status_code == 200
    # Each code works once.
    assert phone.post(f"/api/profiles/link/{link['code']}").status_code == 404
    # The page the QR opens renders, and doesn't spend the code by itself.
    assert phone.get(f"/me/link/{link['code']}").status_code == 200


def test_wrong_link_codes_are_throttled_like_room_codes():
    c = client()
    for _ in range(20):
        last = c.post("/api/profiles/link/nope")
    assert last.status_code == 429


def test_forgetting_a_device_keeps_the_profile_and_deleting_removes_it():
    c = client()
    _, headers = make(c)
    link = c.post("/api/profiles/me/link", headers=headers).get_json()["code"]
    second = {"X-Profile-Token": c.post(f"/api/profiles/link/{link}").get_json()["token"]}

    res = c.post("/api/profiles/me/forget", headers=headers)
    assert res.status_code == 200 and res.get_json()["deleted"] is False
    assert c.get("/api/profiles/me", headers=headers).status_code == 403
    assert c.get("/api/profiles/me", headers=second).status_code == 200

    photo = upload(c, second, jpeg()).get_json()["profile"]["photo"]
    assert c.delete("/api/profiles/me", headers=second).status_code == 200
    assert c.get("/api/profiles").get_json()["profiles"] == []
    assert c.get(photo).status_code == 404
    # The name is free again.
    make(c, "Ana")


def test_the_last_device_out_deletes_the_profile_and_frees_the_name():
    # Otherwise no device could ever change or delete it, and nobody could
    # take the name again.
    c = client()
    _, headers = make(c)
    photo = upload(c, headers, jpeg()).get_json()["profile"]["photo"]
    res = c.post("/api/profiles/me/forget", headers=headers)
    assert res.status_code == 200 and res.get_json()["deleted"] is True
    assert c.get("/api/profiles").get_json()["profiles"] == []
    assert c.get(photo).status_code == 404
    make(c, "Ana")


def test_an_upload_without_a_length_is_refused_before_it_is_read():
    # The length is what caps the read; a chunked body has none.
    c = client()
    _, headers = make(c)
    res = c.post("/api/profiles/me/photo", input_stream=io.BytesIO(jpeg()),
                 headers={**headers, "Content-Type": "image/jpeg", "Transfer-Encoding": "chunked"},
                 environ_overrides={"wsgi.input_terminated": True})  # as gunicorn sets it
    assert res.status_code == 411
    assert c.get("/api/profiles/me", headers=headers).get_json()["profile"]["photo"] is None


def test_games_find_a_face_by_name():
    from app import app
    from core import profiles

    c = client()
    _, headers = make(c, "Ana")
    url = upload(c, headers, jpeg()).get_json()["profile"]["photo"]
    make(c, "Ben")
    with app.test_request_context():
        assert profiles.photo_for(" ana ") == url
        assert profiles.photo_for("Ben") is None and profiles.photo_for("Cat") is None
        assert profiles.photos_by_name() == {"ana": url}


def test_a_damaged_profiles_file_is_never_written_over():
    from core import paths, profiles

    c = client()
    make(c, "Ana")
    make(c, "Ben")   # the .bak now holds Ana
    profiles.profiles_path().write_text("{ not json")
    assert c.post("/api/profiles", json={"name": "Cat"}).status_code == 503
    assert profiles.profiles_path().read_text() == "{ not json"
    # Reads fall back to the last good copy.
    assert [p["name"] for p in c.get("/api/profiles").get_json()["profiles"]] == ["Ana"]
    assert paths.DATA_DIR in profiles.profiles_path().parents


def test_a_wrongly_shaped_profiles_file_counts_as_damaged():
    """Valid JSON that isn't a profile list falls back to the backup and
    refuses writes, like broken JSON — not a 500."""
    from core import profiles

    c = client()
    make(c, "Ana")
    make(c, "Ben")
    profiles.profiles_path().write_text('["not", "profiles"]')
    assert c.post("/api/profiles", json={"name": "Cat"}).status_code == 503
    assert [p["name"] for p in c.get("/api/profiles").get_json()["profiles"]] == ["Ana"]


def test_the_profile_page_renders_and_explains_photos_are_shared():
    body = client().get("/me").get_data(as_text=True)
    assert "selfie" in body.lower() and "anyone" in body.lower()


# --- the Family page: who's a child (v1.24.0) ---------------------------------

ADMIN = {"Remote-User": "james", "Remote-Groups": "admins,family"}


import pytest  # noqa: E402


@pytest.fixture
def family_on(monkeypatch):
    """The server's word that Authelia guards /family (the compose file sets it)."""
    monkeypatch.setenv("GAMENIGHT_FAMILY", "authelia")


def test_the_family_page_is_off_until_the_server_says_authelia_guards_it():
    """Before the docker rules route /family through forward-auth, Traefik
    passes a forged Remote-User straight through, so the headers alone
    prove nothing. Without the setting, even an admin's headers are refused."""
    c = client()
    profile, _ = make(c, "Louis")
    assert c.get("/family", headers=ADMIN).status_code == 403
    assert c.post(f"/api/family/{profile['id']}", json={"kid": True}, headers=ADMIN).status_code == 403
    assert c.post("/api/family/nobody", json={"kid": True}, headers=ADMIN).status_code == 403


def test_the_family_page_needs_an_admin_sign_in(family_on):
    c = client()
    page = c.get("/family")
    assert page.status_code == 403 and "Only a grown-up signed in" in page.get_data(as_text=True)
    profile, _ = make(c, "Louis")
    for headers in ({}, {"Remote-User": "louis"}, {"Remote-User": "louis", "Remote-Groups": "family"},
                    {"Remote-Groups": "admins"}):
        assert c.post(f"/api/family/{profile['id']}", json={"kid": True}, headers=headers).status_code == 403, headers
    assert c.get("/api/profiles").get_json()["profiles"][0]["kid"] is False


def test_an_admin_marks_a_childs_profile_and_everyone_can_see_it(family_on):
    c = client()
    profile, token = make(c, "Louis")
    body = c.get("/family", headers=ADMIN).get_data(as_text=True)
    assert "Louis" in body and "Signed in as james" in body
    res = c.post(f"/api/family/{profile['id']}", json={"kid": True}, headers=ADMIN)
    assert res.status_code == 200 and res.get_json()["profile"]["kid"] is True
    assert c.get("/api/profiles").get_json()["profiles"][0]["kid"] is True
    assert c.get("/api/profiles/me", headers=token).get_json()["profile"]["kid"] is True
    assert c.post(f"/api/family/{profile['id']}", json={"kid": "yes"}, headers=ADMIN).status_code == 400
    assert c.post("/api/family/nobody", json={"kid": True}, headers=ADMIN).status_code == 404
    c.post(f"/api/family/{profile['id']}", json={"kid": False}, headers=ADMIN)
    assert c.get("/api/profiles").get_json()["profiles"][0]["kid"] is False


def test_a_child_cant_mark_themself_a_grown_up_with_their_own_token(family_on):
    c = client()
    profile, token = make(c, "Louis")
    c.post(f"/api/family/{profile['id']}", json={"kid": True}, headers=ADMIN)
    assert c.post(f"/api/family/{profile['id']}", json={"kid": False}, headers=token).status_code == 403
    assert c.get("/api/profiles").get_json()["profiles"][0]["kid"] is True


def test_the_hub_links_to_the_family_page():
    assert 'href="/family"' in client().get("/").get_data(as_text=True)
