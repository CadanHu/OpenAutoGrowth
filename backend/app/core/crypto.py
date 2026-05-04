"""
Simple encryption utility for storing sensitive tokens in the database.
Uses Fernet (AES-128 in CBC mode with HMAC SHA256).
"""
import base64
from cryptography.fernet import Fernet
from app.config import settings

# In production, this should be a long, random 32-byte key from env
# If not provided, we derive it from app_secret_key (not ideal but works for dev)
_key = base64.urlsafe_b64encode(settings.app_secret_key.ljust(32)[:32].encode())
_fernet = Fernet(_key)

def encrypt(text: str) -> str:
    if not text:
        return ""
    return _fernet.encrypt(text.encode()).decode()

def decrypt(token: str) -> str:
    if not token:
        return ""
    return _fernet.decrypt(token.encode()).decode()
