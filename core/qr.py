"""QR codes for room links, so nobody has to type a URL off someone's phone."""

import io

import qrcode
import qrcode.image.svg


def svg(data):
    """Return an SVG QR code for `data` as bytes. SVG keeps this dependency
    pure-python — no Pillow, no image toolchain in the container."""
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()
