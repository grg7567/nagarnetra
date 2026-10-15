import time

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal, User

COOKIE = "nn_session"
TTL = 7 * 24 * 3600


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def check_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def set_session(resp: Response, request: Request, user: User) -> None:
    token = jwt.encode({"sub": str(user.id), "exp": int(time.time()) + TTL}, settings.secret_key, algorithm="HS256")
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    if settings.cookie_secure in ("true", "false"):
        secure = settings.cookie_secure == "true"
    resp.set_cookie(COOKIE, token, max_age=TTL, httponly=True, samesite="lax", secure=secure, path="/")


def clear_session(resp: Response) -> None:
    resp.delete_cookie(COOKIE, path="/")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Sign in to continue.")
    try:
        uid = int(jwt.decode(token, settings.secret_key, algorithms=["HS256"])["sub"])
    except Exception:
        raise HTTPException(401, "Your session has expired. Sign in again.")
    user = db.get(User, uid)
    if not user or not user.active:
        raise HTTPException(401, "This account is disabled.")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only administrators can do this.")
    return user
