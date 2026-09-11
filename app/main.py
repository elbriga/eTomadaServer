from datetime import datetime, timezone
from pathlib import Path
import sqlite3

import os
import tempfile

from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from fastapi.templating import Jinja2Templates
from fastapi import Request

from fastapi.staticfiles import StaticFiles

DNS_HOSTS_PATH = Path("/app/data/etomadas.hosts")
DNS_DOMAIN = "etomada"

DB_PATH = Path("/app/data/logs.db")

app = FastAPI(title="eTomada Log Server")

app.mount(
    "/static",
    StaticFiles(directory="/app/app/static"),
    name="static"
)

templates = Jinja2Templates(
    directory="/app/app/templates"
)

class LogEntry(BaseModel):
    deviceID: str
    level: int
    module: str = ""
    message: str
    uptime: int | None = None
    timestamp: int | None = None

class DNSRegister(BaseModel):
    deviceID: str
    hostname: str
    ip: str

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = get_db()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            device_id TEXT NOT NULL,
            ip TEXT,
            level INTEGER,
            module TEXT,
            message TEXT NOT NULL,
            uptime INTEGER
        )
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_device
        ON logs(device_id)
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp
        ON logs(timestamp)
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS level (
            id INTEGER,
            nome TEXT NOT NULL
        )
    """)

    conn.execute("""
        DELETE FROM level;
    """)
    conn.execute("""
        INSERT INTO level(id, nome) VALUES
            (  0, "!OFF!!"),
            (  1, "!CRIT!"),
            (  5, "AVISO!"),
            ( 10, "NORMAL"),
            ( 50, "DEBUG0"),
            ( 70, "DEBUG!"),
            (100, "TESTE!");
    """)

    conn.commit()
    conn.close()


@app.on_event("startup")
def startup():
    init_db()

def update_dns_host(device_id: str, hostname: str, ip: str):

    hostname = hostname.strip().lower()

    # Validação simples do hostname
    if not hostname:
        raise ValueError("hostname vazio")

    if "." in hostname:
        raise ValueError("hostname não deve conter domínio")

    if not all(c.isalnum() or c == "-" for c in hostname):
        raise ValueError("hostname contém caracteres inválidos")

    fqdn = f"{hostname}.{DNS_DOMAIN}"

    DNS_HOSTS_PATH.parent.mkdir(parents=True, exist_ok=True)

    entries = {}

    if DNS_HOSTS_PATH.exists():
        for line in DNS_HOSTS_PATH.read_text().splitlines():

            line = line.strip()

            if not line or line.startswith("#"):
                continue

            parts = line.split()

            if len(parts) >= 2:
                old_ip = parts[0]
                old_hostname = parts[1]

                entries[old_hostname] = (old_ip, old_hostname)

    # Remove qualquer entrada existente para este device/IP/hostname
    entries = {
        name: value
        for name, value in entries.items()
        if value[0] != ip and name != fqdn
    }

    entries[fqdn] = (ip, fqdn)

    content = "".join(
        f"{entry_ip} {entry_hostname}\n"
        for entry_ip, entry_hostname in entries.values()
    )

    fd, temp_path = tempfile.mkstemp(
        dir=DNS_HOSTS_PATH.parent,
        prefix=".etomadas-",
        text=True
    )

    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())

        # dnsmasq precisa conseguir ler o arquivo
        os.chmod(temp_path, 0o644)

        # Substituicaoo atomica
        os.replace(temp_path, DNS_HOSTS_PATH)

    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass

        raise

    return fqdn


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={}
    )


@app.post("/api/log")
def receive_log(log: LogEntry, request: Request):

    ip = request.client.host

    conn = get_db()

    cursor = conn.execute("""
        INSERT INTO logs (
            timestamp,
            device_id,
            ip,
            level,
            module,
            message,
            uptime
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        log.timestamp,
        log.deviceID,
        ip,
        log.level,
        log.module,
        log.message,
        log.uptime
    ))

    conn.commit()

    log_id = cursor.lastrowid

    conn.close()

    return {
        "ok": True,
        "id": log_id
    }


@app.get("/api/logs")
def get_logs(
    deviceID: str | None = None,
    level: str | None = None,
    module: str | None = None,
    search: str | None = None,
    limit: int = Query(250, ge=1, le=10000)
):

    conn = get_db()

    query = """
        SELECT
            l.id,
            l.timestamp,
            l.device_id,
            l.ip,
            lv.nome AS level,
            l.module,
            l.message,
            l.uptime
        FROM logs l
        JOIN level lv ON l.level = lv.id
        WHERE 1=1
    """

    params = []

    if deviceID:
        query += " AND l.device_id = ?"
        params.append(deviceID)

    if level:
        query += " AND lv.nome = ?"
        params.append(level)

    if module:
        query += " AND l.module = ?"
        params.append(module)

    if search:
        query += " AND l.message LIKE ?"
        params.append(f"%{search}%")

    query += " ORDER BY l.id DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(query, params).fetchall()

    conn.close()

    return [dict(row) for row in rows]


@app.get("/api/nodes")
def get_nodes():

    conn = get_db()

    rows = conn.execute("""
        SELECT
            device_id,
            MAX(timestamp) AS last_log,
            COUNT(*) AS total_logs
        FROM logs
        GROUP BY device_id
        ORDER BY device_id
    """).fetchall()

    conn.close()

    return [dict(row) for row in rows]

@app.post("/api/dns/register")
def register_dns(register: DNSRegister):

    try:
        fqdn = update_dns_host(
            register.deviceID,
            register.hostname,
            register.ip
        )

    except ValueError as e:
        return {
            "ok": False,
            "error": str(e)
        }

    return {
        "ok": True,
        "deviceID": register.deviceID,
        "hostname": fqdn,
        "ip": register.ip
    }
