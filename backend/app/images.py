"""Photo intake: validate, read GPS from EXIF, fix orientation, blur faces, strip metadata."""
import io

import cv2
import numpy as np
from PIL import ExifTags, Image, ImageFilter, ImageOps

MAX_INPUT_BYTES = 15 * 1024 * 1024
MAX_SIDE = 1600
_face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


class BadImage(ValueError):
    pass


def _gps(img: Image.Image) -> tuple[float, float] | None:
    try:
        gps = img.getexif().get_ifd(ExifTags.IFD.GPSInfo)
        if not gps:
            return None

        def deg(v, ref):
            d, m, s = (float(x) for x in v)
            out = d + m / 60 + s / 3600
            return -out if ref in ("S", "W") else out

        lat = deg(gps[2], gps[1])
        lng = deg(gps[4], gps[3])
        if lat == 0 and lng == 0:
            return None
        return lat, lng
    except Exception:
        return None


def _blur_faces(img: Image.Image) -> tuple[Image.Image, int]:
    arr = np.asarray(img.convert("L"))
    min_side = max(24, min(img.size) // 25)
    faces = _face.detectMultiScale(arr, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
    for (x, y, w, h) in faces:
        pad = int(0.15 * max(w, h))
        box = (max(0, x - pad), max(0, y - pad), min(img.width, x + w + pad), min(img.height, y + h + pad))
        region = img.crop(box).filter(ImageFilter.GaussianBlur(radius=max(12, w // 4)))
        img.paste(region, box)
    return img, len(faces)


def process(raw: bytes) -> dict:
    if len(raw) > MAX_INPUT_BYTES:
        raise BadImage("Photo is larger than 15 MB.")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise BadImage("That file is not a readable image. Use a JPEG, PNG or WebP photo.") from e
    gps = _gps(img)
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    img, faces = _blur_faces(img)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82, optimize=True)  # re-encoding drops all EXIF, including GPS
    return {"jpeg": out.getvalue(), "faces": faces, "gps": gps, "size": img.size}


def thumb(jpeg: bytes, side: int = 512) -> bytes:
    img = Image.open(io.BytesIO(jpeg))
    img.thumbnail((side, side))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=78)
    return out.getvalue()
