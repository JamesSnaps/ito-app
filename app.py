"""Game Night — a small hub for companion apps to physical party games.

Each game is a self-contained blueprint under games/, and the hub provides
what they all need: room codes, joining, persisted stats and QR links.
/ is the menu: ito (a topic randomiser), Flip 7 (a scorekeeper, or the
deck itself) and Fugitive (a two-player game played entirely on the app).
"""

import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, render_template, request, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from core.jsonfile import DataUnavailable
from core.qr import svg as qr_svg
from core.ratelimit import code_guesses
from core.rooms import rooms
from games.registry import get_game, playable_games

APP_NAME = "Game Night"

# Bump this in the same commit as any user-visible change, before pushing.
# Watchtower deploys `latest`, so this is the only way to tell from a phone
# which build the server is actually running. See CLAUDE.md.
APP_VERSION = "1.7.0"

# The iOS app (ios/project.yml): team C729B84RYG, the paid personal
# membership Dishes, Keepsake and Brief use. Named in the file Apple checks
# before letting the app open links to rooms (apple_app_site_association).
IOS_APP_ID = "C729B84RYG.uk.collco.gamenight"


def create_app():
    app = Flask(__name__)
    app.config["APP_NAME"] = APP_NAME
    # Templates are edited far more often than the app is restarted.
    app.config["TEMPLATES_AUTO_RELOAD"] = True

    # Behind Traefik, trust its X-Forwarded-* headers so request.host_url is
    # the real https://<domain>/ and not http://<container-ip>:5000/. The QR
    # codes are built from it, so without this they'd point at an internal IP
    # that no phone can reach.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

    # Pages are cheap to render and must never be stale: a cached copy of an
    # older page against newer CSS is a confusing, hard-to-report bug. Static
    # assets are cache-busted by ?v= instead (see `asset` below).
    @app.after_request
    def no_store_html(response):
        if response.mimetype == "text/html":
            response.headers["Cache-Control"] = "no-store, must-revalidate"
        return response

    # Version string for static URLs, so a changed file is always re-fetched.
    @app.template_global()
    def asset(filename):
        path = Path(app.static_folder) / filename
        stamp = int(path.stat().st_mtime) if path.exists() else 0
        return url_for("static", filename=filename, v=stamp)

    for game in playable_games():
        app.register_blueprint(game.blueprint)

    @app.context_processor
    def inject_globals():
        return {"app_name": APP_NAME, "app_version": APP_VERSION}

    @app.route("/healthz")
    def healthz():
        """For container health checks, and for confirming which build is
        live without opening a page."""
        return {"status": "ok", "version": APP_VERSION}

    @app.route("/manifest.webmanifest")
    def manifest():
        """What makes the site installable to a home screen. A route rather
        than a static file: Flask doesn't know the .webmanifest type, and the
        icon URLs want the same cache-busting as everything else."""
        icons = [
            {"src": asset("icons/icon-192.png"), "sizes": "192x192", "type": "image/png"},
            {"src": asset("icons/icon-512.png"), "sizes": "512x512", "type": "image/png"},
            # Full bleed with the drawing inside the safe zone, so the same
            # file can be cropped to whatever shape the launcher uses.
            {"src": asset("icons/icon-512.png"), "sizes": "512x512", "type": "image/png",
             "purpose": "maskable"},
            {"src": asset("icons/icon.svg"), "sizes": "any", "type": "image/svg+xml"},
        ]
        body = {
            "name": APP_NAME,
            "short_name": APP_NAME,
            "start_url": "/",
            "scope": "/",
            "display": "standalone",
            "background_color": "#14161b",
            "theme_color": "#14161b",
            "icons": icons,
        }
        return Response(json.dumps(body), mimetype="application/manifest+json")

    @app.route("/")
    def hub():
        """The menu. / used to short-circuit straight to ito, back when it
        was the only game."""
        return render_template("hub.html", games=playable_games())

    @app.route("/games")
    def hub_menu():
        """The full menu, still reachable when / short-circuits to one game."""
        return render_template("hub.html", games=playable_games())

    @app.route("/join")
    def join():
        """Enter a code from any game and land in the right room."""
        code = (request.args.get("code") or "").strip().upper()
        if not code:
            return render_template("join.html", error=None, code="")

        client = request.remote_addr or "unknown"
        room = rooms.get(code)
        if room is None:
            if code_guesses.record_failure(client):
                return render_template(
                    "join.html",
                    error="Too many incorrect codes from this device. Wait a few "
                          "minutes, then try again.",
                    code="",
                ), 429
            return (
                render_template(
                    "join.html",
                    error="No active room with that code. Check it with the host.",
                    code=code,
                ),
                404,
            )
        code_guesses.clear(client)

        game = get_game(room.game_id)
        if game is None:
            return render_template("join.html", error="That game is no longer available.", code=code), 404
        return redirect(url_for(game.player_endpoint, code=room.code))

    @app.route("/.well-known/apple-app-site-association")
    def apple_app_site_association():
        """Lets the iOS app open links to rooms — a QR scanned, a link in a
        message — instead of Safari. Apple fetches this from the domain (no
        redirect, no sign-in: it's on the public Traefik router) and checks
        it names the app. Only the pages a player is sent to are claimed;
        the hub, rules and settings stay in the browser, as do the host's
        pages behind Authelia."""
        body = {
            "applinks": {
                "details": [{
                    "appIDs": [IOS_APP_ID],
                    "components": [
                        {"/": "/flip7/play/*"},
                        {"/": "/flip7/watch/*"},
                        {"/": "/ito/play/*"},
                        {"/": "/join", "?": {"code": "?*"}},
                    ],
                }],
            },
        }
        return Response(json.dumps(body), mimetype="application/json")

    @app.route("/api/join/<code>")
    def api_join(code):
        """/join for an app: which game a code belongs to, and its web page.

        Throttled exactly like /join — a wrong code counts, a right one
        clears the client — so a native client is no better a scanner than
        the browser."""
        code = (code or "").strip().upper()
        client = request.remote_addr or "unknown"
        room = rooms.get(code)
        if room is None:
            if code_guesses.record_failure(client):
                return jsonify({"error": "Too many incorrect codes from this device. "
                                         "Wait a few minutes, then try again."}), 429
            return jsonify({"error": "No active room with that code. Check it with the host."}), 404
        code_guesses.clear(client)
        game = get_game(room.game_id)
        if game is None or not game.has_rooms:
            return jsonify({"error": "That game is no longer available."}), 404
        return jsonify({
            "code": room.code,
            "game": game.id,
            "path": url_for(game.player_endpoint, code=room.code),
        })

    @app.route("/qr.svg")
    def qr():
        """QR for a path on this host — used to get players into a room fast."""
        path = request.args.get("path", "/")
        if not path.startswith("/"):
            path = "/" + path
        return Response(qr_svg(request.host_url.rstrip("/") + path), mimetype="image/svg+xml")

    @app.errorhandler(404)
    def not_found(err):
        return render_template("error.html", message=getattr(err, "description", "Page not found.")), 404

    @app.errorhandler(429)
    def too_many(err):
        return render_template(
            "error.html", message=getattr(err, "description", "Too many attempts.")
        ), 429

    # A damaged data file is a 503 with a sentence saying which one, not a
    # bare 500 — and, for stats, never a quiet overwrite (see core/jsonfile).
    @app.errorhandler(DataUnavailable)
    def data_unavailable(err):
        app.logger.error("Data file unreadable: %s", err.__cause__ or err)
        if "/api/" in request.path:
            return jsonify({"error": str(err)}), 503
        return render_template("error.html", message=str(err)), 503

    @app.errorhandler(500)
    def server_error(err):
        # The default page is a bare "Internal Server Error" with no way back.
        app.logger.exception("Unhandled error")
        return render_template(
            "error.html",
            message="Something went wrong at our end. The room is probably still fine — try again.",
        ), 500

    return app


app = create_app()

if __name__ == "__main__":
    # PORT is overridable because macOS AirPlay squats on 5000.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
