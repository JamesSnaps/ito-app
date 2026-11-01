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


# --- pairing: a new device asks, a device that's you says yes (v1.36.0) -------

LAPTOP = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}


def ask(c, profile_id, headers=LAPTOP):
    res = c.post("/api/profiles/pair", json={"profile": profile_id}, headers=headers)
    return res, res.get_json()


def status(c, pair):
    return c.get(f"/api/profiles/pair/{pair['code']}", headers={"X-Pair-Secret": pair["secret"]})


def test_a_new_device_asks_and_a_device_thats_you_says_yes():
    c = client()
    profile, phone = make(c, "Mia")
    laptop = client()
    res, pair = ask(laptop, profile["id"])
    assert res.status_code == 200
    assert len(pair["code"]) == 6 and not set(pair["code"]) & set("IO01")
    assert pair["url"].endswith(f"/me/pair/{pair['code']}") and "<svg" in pair["qr_svg"]
    assert status(laptop, pair).get_json() == {"status": "waiting"}

    waiting = c.get("/api/profiles/me/pairs", headers=phone).get_json()["requests"]
    assert [(r["code"], r["device"]) for r in waiting] == [(pair["code"], "Chrome on a Mac")]
    assert "secret" not in json.dumps(waiting)

    assert c.post(f"/api/profiles/me/pairs/{pair['code']}", json={"approve": True}, headers=phone).status_code == 200
    done = status(laptop, pair).get_json()
    assert done["status"] == "approved" and done["profile"] == profile
    mine = {"X-Profile-Token": done["token"]}
    assert laptop.get("/api/profiles/me", headers=mine).get_json()["profile"]["id"] == profile["id"]
    # The token is handed over once, and the request is gone from the phone.
    assert status(laptop, pair).status_code == 404
    assert c.get("/api/profiles/me/pairs", headers=phone).get_json()["requests"] == []


def test_only_the_asking_device_collects_and_only_that_profile_answers():
    c = client()
    mia, mia_phone = make(c, "Mia")
    _, sam_phone = make(c, "Sam")
    _, pair = ask(client(), mia["id"])
    # The code is on screen for anyone to read; it isn't what collects the token.
    for secret in ("", "wrong"):
        res = c.get(f"/api/profiles/pair/{pair['code']}", headers={"X-Pair-Secret": secret})
        assert res.status_code == 404
    # Sam can't see or answer Mia's request; nobody signed out can either.
    assert c.get("/api/profiles/me/pairs", headers=sam_phone).get_json()["requests"] == []
    assert c.post(f"/api/profiles/me/pairs/{pair['code']}", json={"approve": True}, headers=sam_phone).status_code == 404
    assert c.post(f"/api/profiles/me/pairs/{pair['code']}", json={"approve": True}).status_code == 403
    assert c.post(f"/api/profiles/me/pairs/{pair['code']}", json={"approve": "yes"}, headers=mia_phone).status_code == 400
    assert status(c, pair).get_json() == {"status": "waiting"}


def test_saying_no_or_cancelling_signs_nothing_in():
    c = client()
    profile, phone = make(c, "Mia")
    laptop = client()
    _, pair = ask(laptop, profile["id"])
    assert c.post(f"/api/profiles/me/pairs/{pair['code']}", json={"approve": False}, headers=phone).status_code == 200
    assert status(laptop, pair).get_json() == {"status": "refused"}
    assert status(laptop, pair).status_code == 404

    _, pair = ask(laptop, profile["id"])
    assert laptop.delete(f"/api/profiles/pair/{pair['code']}", headers={"X-Pair-Secret": pair["secret"]}).status_code == 200
    assert c.get("/api/profiles/me/pairs", headers=phone).get_json()["requests"] == []
    assert c.post(f"/api/profiles/me/pairs/{pair['code']}", json={"approve": True}, headers=phone).status_code == 404


def test_requests_run_out_and_cant_pile_up(monkeypatch):
    from core import profiles

    c = client()
    profile, phone = make(c, "Mia")
    first = ask(c, profile["id"])[1]
    ask(c, profile["id"])
    res, _ = ask(c, profile["id"])
    assert res.status_code == 429 and "already" in res.get_json()["error"]

    later = profiles.time.time() + profiles.PAIR_TTL + 1
    monkeypatch.setattr(profiles.time, "time", lambda: later)
    assert status(c, first).status_code == 404
    assert c.get("/api/profiles/me/pairs", headers=phone).get_json()["requests"] == []
    assert c.post(f"/api/profiles/me/pairs/{first['code']}", json={"approve": True}, headers=phone).status_code == 404
    assert ask(c, profile["id"])[0].status_code == 200


def test_asking_is_throttled_per_device_and_needs_a_real_profile():
    c = client()
    assert ask(c, "nobody")[0].status_code == 404
    for body in ({}, {"profile": 7}, ["x"]):
        assert c.post("/api/profiles/pair", json=body).status_code == 400
    names = [make(c, f"P{i}")[0]["id"] for i in range(10)]
    codes = [ask(c, pid)[0].status_code for pid in names]
    assert codes[:9] == [200] * 9 and codes[-1] == 429


def test_the_pair_qr_page_renders_without_answering():
    c = client()
    profile, phone = make(c, "Mia")
    _, pair = ask(client(), profile["id"])
    body = c.get(f"/me/pair/{pair['code'].lower()}").get_data(as_text=True)
    assert f'"{pair["code"]}"' in body
    assert c.get("/api/profiles/me/pairs", headers=phone).get_json()["requests"][0]["code"] == pair["code"]


def test_devices_are_named_for_the_person_saying_yes():
    from core.profiles import device_label

    assert device_label(LAPTOP["User-Agent"]) == "Chrome on a Mac"
    assert device_label("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
                        "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1") == "Safari on an iPhone"
    assert device_label("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/130.0 Safari/537.36 Edg/130.0") == "Edge on a Windows PC"
    assert device_label("GameNight/202611012146 CFNetwork/3826.400.120 Darwin/25.0.0") == "The Game Night app"
    assert device_label("") == "A web browser"


def test_the_hub_asks_who_you_are_and_puts_previews_last():
    from games.registry import playable_games

    body = client().get("/").get_data(as_text=True)
    assert 'id="hub-intro"' in body and "GN.pairing.ask" in body
    assert 'action="/join"' in body and 'name="code"' in body
    previews = [g for g in playable_games() if g.preview]
    assert previews, "Final Vector is a preview"
    last = max(body.index(f'href="/{g.id}/"') for g in playable_games() if not g.preview)
    for game in previews:
        tile = body.index(f'href="/{game.id}/"')
        assert tile > last and "is-preview" in body[body.rindex("<a", 0, tile):tile]
